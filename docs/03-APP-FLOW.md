# 03 — App Flow: Navigation & User Journeys

> Every page, every click, every redirect. No auth, so there's one shared experience.

## Pages

| Route | Page | Purpose |
|---|---|---|
| `/` | **Dashboard** | All tracked items at a glance, system status, Export CSV, entry point to tracking |
| `/track` | **Track a product** | Search → pick product → pick option → confirm |
| `/items/:trackedId` | **Item detail** | Product info, price and stock chart, history table, scrape log for one tracked item |
| `/runs` | **Runs** | Every scheduled or manual run, with its status and counts, plus missed and interrupted slots (honest system log) |
| `*` | Not found | Link back to `/` |

## Navigation

- **Top bar** on every page: app name (→ `/`), links `Dashboard`, `Track`, `Runs`, and on the right an **Export CSV** button (full history) plus a small status pill: `Last run 14:00 · OK` / `Retried` / `Failed` / `Missed`, with the next run time.
- On mobile the top bar collapses to the app name, the status pill and a menu button. Export moves into the menu.
- The item detail page has a breadcrumb: `Dashboard / <Product name> — <Option>`.

## First screen

A new visitor lands on `/` (the dashboard):
- **Header strip:** "Tracking N items · scraped every 2 hours · next run at HH:MM (in Xm)" plus the last run's result.
- **Grid of tracked-item cards.** Each card shows:
  - the product name and option label, with brand and category underneath
  - the **latest valid price** and when it was captured ("₹12,499 · 38 min ago")
  - stock status
  - a 24 h sparkline
  - a badge for the latest attempt's outcome
  - success rate over the last 24 attempts
  - Clicking a card goes to `/items/:trackedId`.
- A **Track a product** button → `/track`.

## Core journey 1: track a product

1. The user clicks **Track a product** (dashboard or top bar) → `/track`.
2. They type into the search box (debounced 300 ms, at least 2 characters). `GET /api/catalog/search?q=` returns up to 20 results showing name, brand, category and SKU.
3. They click a result. The right-hand panel (on mobile, the step below) loads `GET /api/catalog/:productId`, showing details, specs, and the **option axis** (e.g. "Bundle") with its options as a radio list.
4. They pick an option. Options already tracked are disabled and labelled "Already tracked" with a link to that item.
5. They click **Start tracking** → `POST /api/tracked`.
   - **Success:** redirect to `/items/:trackedId`, toast "Tracking started — first scrape running". The first attempt shows as "Scraping…" and the page polls every 5 s until it appears.
   - **409 duplicate:** inline message plus a link to the existing item.
   - **422 limit reached:** "Tracking limit (12) reached."
   - **Store API down:** inline error with a Retry button. Search results stay on screen.

## Core journey 2: read a product's history

1. Dashboard → click a card → `/items/:trackedId`.
2. **Header:** product name, option, brand, category, SKU, store product ID with a link to `https://demo.inelabteamdev.com/item/<id>`, the tracking start date, and the next scheduled scrape.
3. **Current state panel:** latest valid price, previous price with the change (▲/▼ and %), stock status, and when it was last confirmed.
4. **Price and stock chart** (Recharts):
   - The price line joins successful attempts only.
   - Failed attempts appear as red ticks on the time axis. They're never drawn as zero, and the line is never filled in across them.
   - Stock shows as a step line or band on a second axis.
   - Range tabs: 24 h / 3 d / All.
5. **Tabs under the chart:**
   - **Scrape log** (default): every attempt, newest first. Columns: time, outcome badge, tries, duration, price, stock, error (code + short message). Clicking a row expands the per-try details (each try's error or status and timing).
   - **Price history:** table of successful attempts only (time, price, stock, change).
   - **Product info:** specs, review summary (average rating and count), description.
6. **Export this item** → `GET /api/export.csv?trackedId=`.

## Core journey 3: export and audit

1. Top bar **Export CSV** → the browser downloads `pricepulse-scrape-history-<YYYYMMDD-HHmm>Z.csv`.
2. `/runs` lists every run: slot, trigger (`cron` / `manual` / `first-track`), status (`completed` / `completed_with_failures` / `interrupted` / `running`), start time, duration, and counts (`success` / `retried` / `failed`). Missed slots are shown as rows with a "Missed — no trigger received" label.

## Loading, empty and error states

| Where | Loading | Empty | Error |
|---|---|---|---|
| Dashboard grid | Card skeletons (3) | "Nothing tracked yet" + **Track a product** button | Banner "Can't reach the API — the server may be waking up (up to 60 s)." Auto-retries with backoff |
| Search | Spinner in the input | "No products match 'xyz'" | Inline error + Retry |
| Option picker | Skeleton radios | — (every product has options) | Inline error + Retry |
| Chart | Skeleton block | "No successful scrapes yet — see the scrape log below" | Inline error |
| Scrape log | Skeleton rows | "First scrape pending — scheduled for HH:MM" | Inline error |
| Runs | Skeleton rows | "No runs yet" | Inline error |

The frontend must expect a **cold backend** (Render waking up). Every query retries 3 times with backoff before showing an error, and the first-load banner explains the delay.

## Modals, drawers and overlays

- No modals are needed. Tracking is a page, not a modal, so it works well on mobile and can be deep-linked.
- Toasts: tracking started, export started, errors on mutations.
- An admin-only action (Untrack) appears only if an `ADMIN_TOKEN` has been entered via `?admin=1`. The token is kept in `sessionStorage`, never `localStorage`. This is optional; skip it if short on time.

## Redirects

| Action | Goes to |
|---|---|
| Start tracking succeeds | `/items/:trackedId` |
| Duplicate track | Stay on `/track`, link to the existing item |
| Unknown route | 404 page → `/` |
| Unknown `trackedId` | 404 state inside the item page → link to `/` |
