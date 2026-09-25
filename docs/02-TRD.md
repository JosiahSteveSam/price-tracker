# 02 — TRD: Technical Requirements Document

> Locks in the stack, structure and constraints. Agents: **don't** add a framework, library or service that isn't listed here without updating this doc first.
> Scraper internals are specified separately in [07-SCRAPER-SPEC.md](07-SCRAPER-SPEC.md).

## Stack

| Layer | Choice |
|---|---|
| **Frontend** | React 19 + Vite 8 + TypeScript (strict), Tailwind CSS v4 (`@tailwindcss/vite`), React Router v8 (`createBrowserRouter`), TanStack Query v5, Recharts v3, oxlint (Vite template default) |
| **Backend** | Node.js 22 LTS (as shipped in the Playwright Docker image) + Express 4 + TypeScript (ESM). Dev with `tsx watch`; prod runs `node dist/index.js` after `tsc` |
| **Database** | Supabase PostgreSQL, accessed **only by the backend** with `@supabase/supabase-js` and the service-role key |
| **Auth** | No user auth (out of scope). Machine endpoints use shared secrets: `X-Cron-Secret` for the cron trigger, `X-Admin-Token` for destructive/admin actions |
| **Scraping** | **Hybrid.** Plain `fetch` (Node built-in) for the store's open JSON API (catalogue, product details, options). **Playwright (Chromium)** only for price and stock, which sit behind a browser-only challenge (see below) |
| **Scheduling** | cron-job.org → `POST /api/cron/scrape` every 2 h at minute 0 UTC, plus a keep-warm `GET /healthz` every 10 min |
| **Hosting** | Frontend on **Vercel**. Backend on **Render** (free web service, **Docker** runtime, based on `mcr.microsoft.com/playwright:v1.63.0-noble`; npm `playwright@1.63.0` pinned to match). DB on **Supabase** free tier |
| **Validation** | `zod` v4 for env, request bodies and scraper output |
| **Logging** | `pino` (JSON logs; readable with `pino-pretty` in dev and headed mode) |
| **Tests** | `vitest` (backend unit tests: normalize, validate, CSV, retry, slot key) |
| **CI (bonus)** | GitHub Actions: install, lint, typecheck, test for both packages |

### Why a hybrid scraper (the key judgment call)

Reconnaissance on 2026-09-25 found:

| Endpoint | Auth | Returns | Used for |
|---|---|---|---|
| `GET /api/v2/listings?page=N&limit=L` | none | `{page, perPage, totalPages, count, results:[{id, slug, name, brand, category, sku, description}]}`. Max 60 per page, **960 products**. **No search parameter** (`q` is ignored) and **the list is reshuffled on every request**, so it is sampled until complete. | Catalogue cache and search |
| `GET /api/v2/items/:id` | none | name, brand, category, sku, description, `specs{}`, `reviews[]`, `optionAxis` (e.g. `"Bundle"`), `options:[{id:"o1", label:"Instrument only"}, …]`. **No price, no stock.** | Product details and option picker |
| `GET /api/v2/ui/manifest` | none | `{revision, variant, validUntil, classes:{priceWrap, priceValue, mrp, sale, badge, rating, seller, delivery, stock}, order[], priceTag, priceCarrier, ratingAria, sellerTitle}`. **Class names and layout change** | Read by the scraper *from the page's own network traffic* to find elements |
| `GET/POST /api/v2/handshake` | — | Challenge (`salt, difficulty, csig, wasm`) → `{pass, ttlMs:30000}` or **401** (≈40–60% of attempts) | **Not called directly** (the page does it) |
| `GET /api/v2/items/:id/quote?opt=oN` | `Bearer <pass>` | `{itemId, option, ver, blob, ts}`, with an **encrypted** blob; 5xx `upstream_error` / 429 happen | **Not called directly**; we only watch its status and `opt` for validation |

The price flow in the store's JS bundle works like this:
1. Fetch a challenge (including a WebAssembly proof-of-work).
2. Build a fingerprint: canvas, WebGL, `hardwareConcurrency`, screen size, `requestAnimationFrame` timings.
3. Collect **trusted pointer moves and hover time over the price area** (the page shows "Hover over the price area to load the current price." and "Hold on — checking availability…").
4. POST the result and get a `pass` token.
5. Fetch the quote with `Authorization: Bearer <pass>` and decrypt it in the page.

Full observed behaviour (panel states, decoys, formats, consent dialog, failure rates) is in [07-SCRAPER-SPEC.md](07-SCRAPER-SPEC.md).

The DOM then renders the price **split across several elements**, with zero-width spaces (U+200B) and non-breaking spaces (U+00A0) mixed in.

**Decision:** recreating that challenge over HTTP would mean forging fingerprints and mouse data: brittle, and against the brief's "headless only where genuinely required". So we use HTTP for everything it can serve, and a real browser only for price and stock. This is the story for the design note.

## Repository layout (monorepo, no workspace tooling)

```
price-tracker/
├── CLAUDE.md                  # agent rules — read first
├── README.md                  # setup, schedule, env vars (deliverable)
├── NOTES.md                   # running log: AI mistakes + fixes, decisions (feeds the design note)
├── DESIGN_NOTE.md             # final design note (deliverable, written at the end)
├── docs/                      # 01–07 planning docs (source of truth)
├── supabase/
│   └── migrations/0001_init.sql
├── backend/
│   ├── Dockerfile             # FROM mcr.microsoft.com/playwright:v<same as npm playwright>-jammy
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts           # express app bootstrap
│   │   ├── config.ts          # zod-validated env
│   │   ├── logger.ts
│   │   ├── routes/            # health.ts, catalog.ts, tracked.ts, runs.ts, export.ts, cron.ts, alerts.ts
│   │   ├── services/          # catalogService.ts, trackedService.ts, exportService.ts, alertService.ts
│   │   ├── db/                # supabase.ts (client), repositories per table
│   │   ├── scraper/
│   │   │   ├── storeApi.ts    # HTTP client for listings/items (timeouts + retries)
│   │   │   ├── browser.ts     # launch/relaunch Chromium, contexts, resource blocking
│   │   │   ├── productPage.ts # navigate, select option, trigger price reveal, extract raw values
│   │   │   ├── manifest.ts    # capture manifest from page traffic, build selectors, schema signature
│   │   │   ├── normalize.ts   # strip U+200B/U+00A0, join split carriers, parse money/stock
│   │   │   ├── validate.ts    # zod + business rules; decides valid vs invalid
│   │   │   ├── retry.ts       # backoff with jitter, error classification
│   │   │   ├── errors.ts      # ScrapeError + error codes
│   │   │   └── runner.ts      # run orchestration: lock, group by product, attempts, persistence
│   │   └── cli/
│   │       └── scrape.ts      # `npm run scrape` / `scrape:headed`
│   └── test/
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── vercel.json            # SPA rewrite to index.html
    └── src/
        ├── main.tsx, App.tsx
        ├── api/               # typed fetch client + react-query hooks
        ├── pages/             # DashboardPage, TrackPage, ItemPage, RunsPage
        ├── components/        # OutcomeBadge, PriceChart, ScrapeLogTable, SearchBox, OptionPicker, ...
        └── lib/               # formatters (money, dates), types
```

### Naming conventions

- TypeScript `camelCase` for variables and functions, `PascalCase` for types and components, file names `camelCase.ts`, React components `PascalCase.tsx`.
- Database: `snake_case` tables and columns, plural table names.
- API JSON: `camelCase`. Map at the repository layer.
- Time: always store `timestamptz` in UTC. The API returns ISO 8601 with a `Z` suffix. The UI shows local time with a UTC tooltip.
- Money: `numeric(12,2)` in the DB, serialized as a string or number with 2 decimals. Never use floats for comparisons (compare cents as integers).

## Environment variables

### Backend (Render)

| Name | Example | Purpose |
|---|---|---|
| `PORT` | `10000` | Set by Render |
| `NODE_ENV` | `production` | |
| `STORE_BASE_URL` | `https://demo.inelabteamdev.com` | The **only** allowed scrape origin (enforced in code) |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only. Never sent to the frontend |
| `CRON_SECRET` | long random string | Required header `X-Cron-Secret` on `/api/cron/scrape` |
| `ADMIN_TOKEN` | long random string | Required header `X-Admin-Token` on admin routes |
| `CORS_ORIGIN` | `https://pricepulse.vercel.app` | Comma-separated allowed origins |
| `HEADLESS` | `true` | `false` only for local headed runs |
| `SCRAPE_MAX_TRIES` | `4` | Page loads per attempt (1 + 3 retries) |
| `SCRAPE_TRY_TIMEOUT_MS` | `90000` | Hard timeout per try (one page load, up to 6 in-page rounds) |
| `SCRAPE_RUN_BUDGET_MS` | `900000` | Whole-run budget (15 min) |
| `MAX_TRACKED_ITEMS` | `12` | Protects the free tier |
| `LOG_LEVEL` | `info` | |
| `SENDGRID_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | — | Optional (bonus) |

### Frontend (Vercel)

| Name | Example |
|---|---|
| `VITE_API_BASE_URL` | `https://pricepulse-api.onrender.com` |

Keep a committed `backend/.env.example` and `frontend/.env.example`. **Never commit real values.**

## API surface (Express)

All responses are JSON unless noted. Errors look like `{ error: { code, message } }`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | — | Liveness plus `{ lastRunAt, lastRunStatus }`. Target of the keep-warm ping |
| GET | `/api/catalog/search?q=&limit=20` | — | Partial, case-insensitive name search over the cached catalogue, or lookup by store product id (e.g. `2312`). Empty cache → waits for the first sampled batch; stale (> 24 h) or incomplete → refreshes in the background |
| POST | `/api/catalog/refresh` | admin | Force a catalogue refresh |
| GET | `/api/catalog/:productId` | — | Live product details + options (from `/api/v2/items/:id`, cached 10 min) |
| GET | `/api/tracked` | — | Tracked items with latest good price and stock, latest attempt outcome, 24 h sparkline data, success rate |
| POST | `/api/tracked` | — | Body `{ productId, optionId }`. Validates the option exists. Enforces `MAX_TRACKED_ITEMS` and uniqueness. Runs an immediate first scrape in the background |
| GET | `/api/tracked/:id` | — | Item details + product info |
| DELETE | `/api/tracked/:id` | admin | Soft-untrack (`is_active=false`). History is kept |
| GET | `/api/tracked/:id/history` | — | Price and stock time series (successful attempts) plus failed-attempt markers |
| GET | `/api/tracked/:id/attempts?limit=50&before=` | — | Scrape log, newest first, **every** outcome |
| POST | `/api/tracked/:id/scrape-now` | admin | Manual run for one item (`trigger='manual'`) |
| GET | `/api/runs?limit=50` | — | Run history, including `crashed`/`interrupted` runs and missed slots |
| GET | `/api/alerts?unseen=true` | — | Price-drop, back-in-stock and structure-change alerts (bonus) |
| GET | `/api/export.csv[?trackedId=]` | — | `text/csv` download of the full scrape history (PRD M8) |
| POST | `/api/cron/scrape` | cron | Starts the scheduled run. **Responds `202 {runId}` right away**, then scrapes in the background. Returns `200 {skipped:"slot_already_ran"}` if this 2 h slot already has a run |

## Scheduling on a free tier

- Render free instances sleep after about 15 min without inbound traffic, and a cold start takes around 30–60 s. cron-job.org gives up on a request after 30 s.
- Mitigations (use all three):
  1. **Keep-warm:** cron-job.org job A hits `GET /healthz` every 10 min. One service running 24/7 is about 720 h/month, inside Render's 750 free hours.
  2. **Fire-and-forget trigger:** job B calls `POST /api/cron/scrape` at `0 */2 * * *` UTC. The handler validates the secret, inserts the run row and returns 202 before any scraping starts.
  3. **Idempotency by slot:** `slot_key` = the trigger time rounded down to the 2 h boundary (UTC), unique for `trigger='cron'`. Duplicate or retried triggers do nothing.
- **Recovery:** at the start of every run (and on server boot), any run still `running` whose heartbeat is older than 15 min is marked `interrupted`. Every item it didn't finish gets a `failed` attempt with `error_code='RUN_INTERRUPTED'`. That keeps the history honest when Render restarts mid-run.
- **Missed slots:** `/api/runs` works out which expected 2 h slots have no run and returns them as `missed`. The UI shows them.
- **Contingency if Chromium runs out of memory on Render's 512 MB:** run the same `npm run scrape -- --trigger=cron` from a GitHub Actions `schedule` workflow (7 GB runner) writing to the same Supabase. The brief allows "a scheduled function". Document it in the README if we use it.

## Hard constraints

- **Scrape only `STORE_BASE_URL`.** Refuse any other host in `storeApi.ts` and `productPage.ts`.
- **Be polite to the store:** one browser, **concurrency 1**, 1–3 s jitter between products, no scraping outside scheduled, manual or first-track runs.
- **Never save a price or stock without validation.** A failed attempt must have `price IS NULL AND stock_* IS NULL`. The database enforces this with a CHECK constraint.
- Free tiers only. No secrets in the repo or frontend bundle.
- The whole run must finish within `SCRAPE_RUN_BUDGET_MS`. Items not reached are recorded as `failed` / `RUN_BUDGET_EXCEEDED`, never skipped silently.
- Playwright's npm version **must match** the Docker image tag.

## Risks (after the Phase 0 spike)

| Risk | Status / handling |
|---|---|
| Headless Chromium rejected by the challenge | **Resolved:** headless Chromium passes (same ≈50% random 401 rate as headed). Handled with in-page rounds + fresh page loads |
| Hover-only vs hover + click | **Resolved:** hover (≥ 8 moves, ≥ 600 ms) enables the button; then a trusted click, which the page ignores 17.5% of the time |
| Stock/currency formats | **Resolved:** 6 stock templates and 7 price formats, all INR so far. See doc 07 |
| Decoy prices (hidden spans, member price with the `sale` class) | **Resolved:** manifest `priceValue` + structural check must agree; visible text only |
| Stale "Refreshing prices" state | **Resolved:** treated as not ready → "Check again" |
| Manifest rotation (`validUntil` ≈ 4 h) to layouts not yet seen | **Open:** structural fallback + selector-agreement check + a `structure_change` alert |
| Chromium memory on Render free (512 MB) | **Open:** one browser, one context at a time, block images/fonts/media; GitHub Actions fallback |
| API returns HTML error pages after bursts | **Resolved:** check content type + backoff; ≥ 300 ms between catalogue pages |
