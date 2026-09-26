# 06 — Implementation Plan

> Build in this order. Don't start a phase until the previous phase's **Done** criteria are met, unless it's marked *parallel*.
> **The ordering rule:** unattended history can't be backfilled, so **the scraper, DB, Render and cron come before any UI.**

**Clock:** planning finished Fri 2026-09-25 ~22:00 IST. Deadline **Sun 2026-09-27 13:00 IST**. Code freeze at **Sun 11:00 IST**.
If cron is live by **Sat 06:00 IST**, that gives about 15 runs × 3+ items before the deadline.

| Phase | Goal | Target (IST) |
|---|---|---|
| 0 | Spike: prove Playwright can read price and stock correctly | Fri 23:59 |
| 1 | Repo setup | Sat 00:30 |
| 2 | Database | Sat 01:00 |
| 3 | Scraper core | Sat 04:00 |
| 4 | Minimal backend API + cron endpoint | Sat 05:00 |
| 5 | Deploy backend + go live with cron | **Sat 06:00** ⚑ |
| 6 | Frontend: dashboard, track flow, item page | Sat 14:00 |
| 7 | Export, runs page, honesty polish | Sat 17:00 |
| 8 | Hardening + bonuses | Sat 23:00 |
| 9 | Deliverables | Sun 11:00 |

---

## Phase 0: Spike (headed Playwright, throwaway script)

Goal: settle every unknown in [07-SCRAPER-SPEC.md §Unknowns](07-SCRAPER-SPEC.md#unknowns-to-settle-in-phase-0) before writing the real scraper.

- [x] Spike scripts in `backend/spike/` (`recon`, `reveal`, `extract2` + `normalize`, `handshake-exp`, `overlay`, `consent`).
- [x] Option selection: `button.opt-chip` (random default option!). Reveal: hover ≥ 8 moves / 600 ms → click (17.5% ignored) → handshake (≈50% 401) → quote.
- [x] Extraction via manifest `priceValue` + structural cross-check; visible text only; decoys identified.
- [x] 8 product/option pairs, headless: 7/8 valid on the first page load, 1/8 needed a second. Headed confirmed.
- [x] Failure modes recorded: handshake 401, quote 500 `upstream_error`, ignored clicks, consent dialog (1–3 clicks), stale "Refreshing prices", ~15 s slow loads, HTML error pages from the API.
- [x] Findings written into doc 07 (facts, not guesses) and `NOTES.md`.

**Status: DONE (2026-09-26 early IST).**

**Done:** the correct price and stock for 6 product/option pairs, headless and headed, with notes on selectors, the reveal interaction, currency and stock format.

## Phase 1: Setup (*parallel with Phase 0*)

- [x] Monorepo folders as in TRD. `backend/`: TypeScript 6, tsx, Express 4, zod 4, pino, @supabase/supabase-js, playwright **1.63.0** (exact pin), vitest, eslint + prettier. `frontend/`: Vite 8 react-ts, Tailwind v4, react-router v8, TanStack Query, Recharts.
- [x] `backend/.env.example`, `frontend/.env.example`; root `.gitignore` = the original Python template + appended Node rules.
- [x] `backend/Dockerfile` based on `mcr.microsoft.com/playwright:v1.63.0-noble`, `npm ci`, build, prune, runs as `pwuser`.
- [x] npm scripts. Backend: `dev`, `build`, `start`, `test`, `typecheck`, `lint`, `format`, `scrape`, `scrape:headed`. Frontend: `dev`, `build`, `preview`, `typecheck`, `lint`.
- [x] `.claude/launch.json` with `backend` (:3000) and `frontend` (:5173) dev servers.

**Status: DONE.** Backend typecheck, lint and 5 tests pass; the prod build serves `/healthz` and refuses to start without secrets; the frontend builds and shows "API online" against the local backend; no horizontal overflow at 375 px.

**Done:** `npm run dev` starts both apps locally; `GET /healthz` returns 200; typecheck passes.

## Phase 2: Database

- [ ] `supabase/migrations/0001_init.sql` exactly as in doc 05. Apply it through the Supabase SQL editor or CLI.
- [ ] `backend/src/db/supabase.ts` + repositories: `catalogRepo`, `trackedRepo`, `runsRepo`, `attemptsRepo`.
- [x] `npm run db:check`: every column present, search RPC works, 7 kinds of dishonest row rejected by the database, cron-slot idempotency, duplicate-tracking rejection (18/18 pass on the live project).
- [x] Migration `0002_run_plan.sql` adds `scrape_runs.planned_item_ids` (needed for honest crash recovery).

**Status: DONE** (0001 applied and verified 2026-09-25).

**Done:** the migration is applied in Supabase; the repositories can insert and read each table; the constraint check passes.

## Phase 3: Scraper core

In dependency order:
1. [ ] `errors.ts` (codes from doc 07), `retry.ts` (backoff with jitter; retryable vs fatal classification). Unit tests.
2. [ ] `normalize.ts`: invisible-character stripping, split-carrier joining, money and stock parsing. **Unit tests built from the real samples captured in Phase 0.**
3. [ ] `validate.ts`: zod schema + business rules (doc 07 §Validation). Unit tests.
4. [ ] `storeApi.ts`: listings (dedupe, all pages), item details. Timeouts, retries, host allow-list.
5. [ ] `browser.ts`: launch/relaunch, a new context per try, resource blocking (images, media, fonts), realistic viewport.
6. [ ] `manifest.ts` + `productPage.ts`: navigate, capture the manifest, select the option, reveal the price, extract raw values, and compute the page signature.
7. [ ] `runner.ts`: create or lock the run, recover stale runs, pick due items, group by product, attempt → tries → validate → **persist exactly one attempt row per item**, heartbeat, finalize counts and status, run budget.
8. [ ] `cli/scrape.ts`:
   - `npm run scrape -- --item <trackedId>` or `--product 2312 --option o3` or `--all`
   - flags `--headed`, `--slowmo 250`, `--save` (persist with `trigger='cli'`; **without it the CLI is a dry run**), `--simulate slow|fail` (demo only; can't be combined with `--save`)
   - pretty per-try logs

**Done:** `npm run scrape -- --all --save` against the live store writes correct attempts for 3 seeded items. Killing the process mid-run leaves a run that the next run marks `interrupted`, with `failed/RUN_INTERRUPTED` attempts. All unit tests pass.

**Status: DONE (2026-09-25 23:40 IST).**
- Saved run over 4 tracked items (3 products): 4/4 valid, stored rows match the reads (price, MRP, currency, stock status/qty/text, per-try diagnostics).
- Interruption test: killed the process after 2/4 attempts → recovery marked the run `interrupted` (1 success, 1 retried, 2 failed) and wrote `failed / RUN_INTERRUPTED` for the 2 unfinished items; a second pass was a no-op.
- Headed dry run with `--simulate fail`: the 503 is logged, the page retries, the valid read is confirmed.
- 80 unit tests, typecheck and lint pass.

## Phase 4: Minimal backend API

- [ ] `config.ts` (zod env), CORS allow-list, JSON errors, request logging.
- [ ] `GET /healthz`, `POST /api/cron/scrape` (secret check, slot idempotency, 202 + background run), `POST /api/tracked`, `GET /api/tracked`, `GET /api/catalog/search`, `GET /api/catalog/:productId`.

**Done:** locally, `curl -X POST /api/cron/scrape -H "X-Cron-Secret: …"` returns 202 and a run completes; a second call in the same slot returns `skipped`.

**Status: DONE (2026-09-25 ~23:55 IST).** All routes from the TRD API table are implemented: health (+ last run), cron, catalogue search / refresh / details, tracked list / create / get / untrack / history / attempts / scrape-now, runs (+ missed slots, schedule), CSV export. Live checks: 202 in 0.25 s → background cron run 4/4 in 57 s → same slot 200 `skipped`; `next_due_at` moved to the next slot; catalogue 960/960; CSV byte-exact (BOM, columns, ISO UTC, empty price/stock on failed rows); 401/404/409/422 paths correct. 95 unit tests pass.

## Phase 5: Deploy backend and go live ⚑ (most time-critical)

- [ ] Render: new Web Service from the repo, root `backend/`, Docker runtime, free plan, env vars from TRD, health check path `/healthz`.
- [ ] Seed **3 tracked items** from different products and categories, each with a non-default option (via `POST /api/tracked`).
- [ ] cron-job.org **job A**: `GET https://<render>/healthz` every 10 min.
- [ ] cron-job.org **job B**: `POST https://<render>/api/cron/scrape`, header `X-Cron-Secret`, schedule `0 */2 * * *` in **UTC**, timeout 30 s, failure notifications on.
- [ ] Watch the first scheduled run in the Render logs. If Chromium runs out of memory, switch to the GitHub Actions contingency (TRD §Scheduling) straight away.

**Done:** **two consecutive unattended cron runs** recorded in Supabase with correct data, and nobody touched anything in between.

**Status (2026-09-26 10:00 IST):** Render live (Docker, Singapore), Chromium fits (manual scrape 18 s). Slot 20:00 UTC ran unattended 4/4. Slots 22:00, 00:00 and 02:00 UTC were **missed**: cron-job.org got "output too large" from Render's edge, and the keep-warm job was auto-disabled. The GitHub Actions backup trigger was added (secret set). Waiting for two consecutive unattended slots.

## Phase 6: Frontend

**Status: DONE (2026-09-26).** Live at https://price-tracker-two-sigma.vercel.app (Vercel, root `frontend`, `VITE_API_BASE_URL` → Render; CORS set on Render). Checked on desktop and 375 px.

- [x] Design tokens and base layout (doc 04), API client with retry, react-query hooks.
- [ ] Dashboard (cards, status strip), `/track` (search → options → start), `/items/:id` (header, current state, chart, scrape log, price table, product info).
- [ ] Loading, empty and error states from doc 03. Cold-backend banner.
- [ ] Vercel: root `frontend/`, `VITE_API_BASE_URL`, SPA rewrite in `vercel.json`. Add the Vercel URL to Render's `CORS_ORIGIN`.

**Done:** journeys 1 and 2 of doc 03 work on the live Vercel URL, on desktop and on a 375px viewport.

## Phase 7: Export, runs page, honesty polish

- [x] `GET /api/export.csv` (streamed, RFC 4180, BOM, exact column order) + Export buttons (global and per item).
- [x] `GET /api/runs` with missed-slot detection + `/runs` page.
- [x] Chart shows failures as ✕ markers (the line breaks) and missed slots as shaded bands (the line breaks there too).

**Status: DONE (2026-09-26).** CSV verified byte-exact; the Runs page lists missed slots; item charts shade missed slots within the item's tracked period.

**Done:** the exported CSV opens in Excel and Sheets with the exact columns, failed rows have empty price and stock, and the row count equals the number of attempts in the DB.

## Phase 8: Hardening + bonuses (in this order; stop when time runs out)

1. [x] Multiple options of one product in one page load (runner grouping). *(Synthesizer o1 + o3 share a page load.)*
2. [x] Change detection: every run records the manifest-shape signatures it saw (`structure_signatures`); a never-seen signature raises a `structure_change` alert saying whether extraction still worked; layout-type extraction failures (`SELECTOR_CONFLICT`, `PRICE_PARSE_ERROR`, …) also alert (at most once per code per item per 6 h). Dashboard banner for the last 24 h.
3. [x] In-app alerts: price drop and back in stock, compared against the previous **valid** reading. Dashboard "Recent alerts" plus per-item alerts. `npm run alerts:backfill` derived 3 alerts from existing history (idempotent).
4. [x] GitHub Actions CI (`.github/workflows/ci.yml`): typecheck, lint, test and build for both packages.
5. [ ] Per-item frequency: **skipped** (changing the cron cadence this close to the deadline is risky; the schema supports it).
6. [ ] SendGrid email alerts: **skipped** (lowest priority).

**Status: DONE (2026-09-26).** Alerts and change detection can never break a run (errors are swallowed and logged).

## Phase 9: Deliverables

- [ ] `README.md`: overview, architecture diagram (text), local setup, env var tables, **the scraping schedule** (2 h at minute 0 UTC + 10 min keep-warm), headed-mode command, deploy steps, how to verify.
- [ ] `DESIGN_NOTE.md` (about 1–2 pages):
  - reliability techniques
  - fetch vs browser decision
  - free-tier scheduling
  - trade-offs
  - **what the AI tools got wrong first and how it was fixed**, taken from `NOTES.md`
- [ ] Headed recording, 2–4 min:
  - `npm run scrape:headed -- --all --slowmo 200`
  - narrate the challenge/hover, the manifest-driven selectors and the validation
  - show a real slow or failed response being retried (use `--simulate slow|fail` only if the store doesn't misbehave on camera, and **say on camera that it's simulated**)
- [ ] Final check: live link, ≥ 3 items, history from unattended runs, CSV, repo public, no secrets committed (`git log -p | grep -i key` sanity check).

**Done:** everything in the PRD deliverables checklist is ticked.

---

## Definition of finished

- All PRD Must-Haves (M1–M10) verified on the live URLs.
- ≥ 12 unattended cron runs in the history, with any failures shown honestly.
- No stored price that didn't pass validation (the DB constraints hold, and a spot check against the live store matches).
- README, design note and recording are done; the repo is public.
