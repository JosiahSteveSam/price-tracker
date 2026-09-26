# PricePulse — scheduled price & stock tracker for the INE mock store

Search the [INE mock store](https://demo.inelabteamdev.com), pick a product **and** an option (bundle, storage, pack…),
and PricePulse scrapes its price and stock **every 2 hours**, keeping an honest history: every attempt is logged,
failures included, and a missing price is never replaced by a guess.

| | |
|---|---|
| **Live app** | https://price-tracker-two-sigma.vercel.app |
| **API** | https://pricepulse-api-ngnu.onrender.com (`/healthz`) |
| **Design note** | [DESIGN_NOTE.md](DESIGN_NOTE.md) — how the scraping is made reliable, trade-offs, what the AI got wrong |

## Features

- **Search** the store by full/partial name or product id; pick the option to track.
- **Scheduled scraping** every 2 h (UTC, minute 0), triggered externally — no always-on loop.
- **Price & stock history** chart per item: the line breaks at failed attempts (✕) and missed slots (shaded) —
  never drawn as zero, never interpolated.
- **Per-item scrape log**: every attempt with timestamp, outcome (`success` / `retried` / `failed`), page loads,
  duration, error, and per-page-load diagnostics.
- **CSV export** (all items or one): `product_id, product_name, option, timestamp, price, stock, outcome`,
  one row per attempt, failed rows with empty price/stock.
- **Runs page**: every run, plus scheduled slots that never ran ("missed").
- **Headed mode** to watch the scraper work (see below).
- Bonuses: several options of one product in one page load · change detection (new store layouts / layout-type
  extraction failures) · price-drop & back-in-stock alerts · GitHub Actions CI.

## Architecture

```
 cron-job.org ─┐  every 2 h (primary)                 ┌──────────── Render (Docker, free) ────────────┐
               ├─ POST /api/cron/scrape (secret) ───► │ Express API ──► runner ──► Playwright Chromium │──► demo.inelabteamdev.com
 GitHub Actions┘  :07 & :37 (backup, waits for        │     │            │  (price & stock)           │     (only this host)
                  cold start)                         │     │            └► fetch JSON (catalogue,    │
                                                      │     │               product details, options) │
 Vercel (React) ─── GET /api/… ─────────────────────► │     ▼                                         │
                                                      │  Supabase Postgres (RLS on, service role only) │
                                                      └────────────────────────────────────────────────┘
```

**Hybrid scraping.** The store's open JSON API serves the catalogue, product details and options, so those use
plain HTTP. Price and stock are only available through a browser-only flow (proof-of-work + fingerprint +
trusted hover/click → token → encrypted quote rendered into a decoy-filled DOM), so they use Playwright. Details in
the [design note](DESIGN_NOTE.md).

## Scraping schedule

| Trigger | When | Notes |
|---|---|---|
| cron-job.org (primary) | `0 */2 * * *` **UTC** (00:00, 02:00 … 22:00 = 05:30, 07:30 … IST) | `POST /api/cron/scrape` with header `X-Cron-Secret`; answers `202` immediately, scrapes in the background |
| GitHub Actions (backup) | `7 */2 * * *` and `37 */2 * * *` UTC | `.github/workflows/cron-backup.yml`; wakes the sleeping free instance with up to 2 min patience, then calls the same endpoint |

Each 2-hour UTC slot runs **at most once** (unique index on the slot), so duplicate or late triggers are harmless
(`200 {"skipped":"slot_already_ran"}`). A run scrapes every active tracked item: up to **4 fresh page loads** per
item, each with up to 6 in-page rounds; items of the same product share one page load. Slots that never ran are
reported as **missed** in `/api/runs` and in the UI.

## Repository layout

```
backend/             Express + TypeScript API, scraper, CLI, tests (Dockerfile for Render)
  src/scraper/       storeApi (HTTP), browser, productPage (Playwright), normalize, validate, retry, scrapeGroup, runner
  src/routes/        health, cron, catalog, tracked, runs, export, alerts
  src/services/      catalogue cache, tracking, read models, CSV, alerts & change detection
  src/cli/           scrape (headed mode / dry runs / seeding), dbCheck, backfillAlerts
  spike/             Phase-0 reconnaissance scripts used to reverse-engineer the store's behaviour
frontend/            React 19 + Vite + Tailwind v4 + TanStack Query + Recharts (Vercel)
supabase/migrations/ 0001_init.sql, 0002_run_plan.sql
.github/workflows/   ci.yml (typecheck, lint, test, build) · cron-backup.yml (backup scheduler)
```

## Local setup

Prerequisites: **Node 22+**, a **Supabase** project.

1. **Database** — in the Supabase SQL Editor run `supabase/migrations/0001_init.sql`, then `0002_run_plan.sql`.
2. **Backend**
   ```bash
   cd backend
   cp .env.example .env            # fill in the values (see below)
   npm install
   npx playwright install chromium
   npm run db:check                # verifies schema + honesty constraints against your DB (18 checks)
   npm run dev                     # API on http://localhost:3000
   ```
3. **Frontend**
   ```bash
   cd frontend
   cp .env.example .env            # VITE_API_BASE_URL=http://localhost:3000
   npm install
   npm run dev                     # http://localhost:5173
   ```
4. **Track something** — use the Track page, or `npm run scrape -- --track --product 2312 --option o3` in `backend/`.

## Environment variables

### Backend (`backend/.env`, Render → Environment)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | prod | `development` | `production` on Render (enforces the required secrets) |
| `PORT` | | `3000` | Set by Render |
| `STORE_BASE_URL` | | `https://demo.inelabteamdev.com` | The only host the scraper may touch (enforced in code) |
| `SUPABASE_URL` | ✅ | — | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Service-role / secret key — **server only** |
| `CRON_SECRET` | ✅ | — | Required `X-Cron-Secret` header on `POST /api/cron/scrape` |
| `ADMIN_TOKEN` | ✅ | — | Required `X-Admin-Token` for admin routes (untrack, scrape-now, catalogue refresh) |
| `CORS_ORIGIN` | | `http://localhost:5173` | Comma-separated allowed frontend origins |
| `HEADLESS` | | `true` | `false` for a visible browser |
| `SCRAPE_MAX_TRIES` | | `4` | Fresh page loads per attempt |
| `SCRAPE_TRY_TIMEOUT_MS` | | `90000` | Budget per option per page load |
| `SCRAPE_RUN_BUDGET_MS` | | `900000` | Whole-run budget; items not reached are recorded as failed |
| `MAX_TRACKED_ITEMS` | | `12` | Cap on active tracked items |
| `LOG_LEVEL` | | `info` | pino level |

Generate secrets with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

### Frontend (`frontend/.env`, Vercel → Environment Variables)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the API, e.g. `https://pricepulse-api-ngnu.onrender.com` |

### GitHub Actions

| Secret / variable | Purpose |
|---|---|
| `CRON_SECRET` (secret) | Same value as on Render; used by the backup scheduler |
| `API_BASE_URL` (variable, optional) | Overrides the API URL used by the backup scheduler |

## Headed mode (watch the scraper)

From `backend/` (Chromium opens visibly, with an on-page status box; **dry run** — nothing is saved unless `--save`):

```bash
npm run scrape:headed -- --product 2312 --option o3 --option o1   # two options, one page load
npm run scrape:headed -- --all                                    # every tracked item
npm run scrape:headed -- --product 2155 --option o3 --simulate fail   # demo: first quote returns 503 (never saved)
npm run scrape:headed -- --product 2155 --option o3 --simulate slow   # demo: first quote delayed 20 s (never saved)
npm run scrape -- --all --save                                    # headless real run, saved with trigger=cli
```

Other CLI commands: `--list` (tracked items), `--track --product <id> --option <oN>`, `--recover` (recover
interrupted runs now). The store also misbehaves on its own — cookie dialog, ignored clicks, rejected challenges,
`upstream_error` — and the log shows each recovery step.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | — | Liveness + last run |
| POST | `/api/cron/scrape` | `X-Cron-Secret` | Start the current slot's run (`202`), or `200 skipped` |
| GET | `/api/catalog/search?q=` | — | Search by name / product id |
| GET | `/api/catalog/:productId` | — | Live product details + options |
| POST | `/api/catalog/refresh` | admin | Re-collect the catalogue |
| GET / POST | `/api/tracked` | — | List (with latest price, sparkline, success rate) / start tracking `{productId, optionId}` |
| GET | `/api/tracked/:id` · `/history` · `/attempts` | — | Summary · chart points · scrape log |
| DELETE | `/api/tracked/:id` | admin | Untrack (history kept) |
| POST | `/api/tracked/:id/scrape-now` | admin | Manual run for one item |
| GET | `/api/runs` | — | Runs, missed slots, schedule |
| GET | `/api/alerts` | — | Price-drop / back-in-stock / structure-change alerts |
| GET | `/api/export.csv[?trackedId=]` | — | CSV export |

## Deployment

- **Supabase** — run the two migrations; RLS is enabled with no policies, so only the service role can read/write.
- **Render** — Web Service → Docker, **Root Directory `backend`**, health check `/healthz`, env vars above.
  The image is `mcr.microsoft.com/playwright:v1.63.0-noble` (must match the pinned npm `playwright@1.63.0`).
- **Vercel** — import the repo, **Root Directory `frontend`**, preset Vite, `VITE_API_BASE_URL`. `vercel.json`
  rewrites all paths to the SPA.
- **cron-job.org** — `POST https://<api>/api/cron/scrape`, header `X-Cron-Secret`, custom schedule minute 0,
  hours 0,2,…,22, **time zone UTC**, timeout 30 s. Use `https://` (Render answers `http://` with a 307).
- **GitHub Actions** — add the `CRON_SECRET` repository secret to enable the backup scheduler.

## Tests

```bash
cd backend && npm test        # 101 unit tests: every price/stock format, validation rules, retry/outcome logic,
                              # CSV format, cron endpoint auth + idempotency, alerts
cd backend && npm run db:check  # live DB: columns, search RPC, 7 kinds of dishonest row rejected by constraints
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build for both packages on every push.
