# 01 — PRD: Product Requirements Document

> Source of truth for **what** we build and **why**. Derived from `price_tracker_PRD.pdf` (the assignment brief).
> If this doc and the brief disagree, the brief wins — fix this doc.

| Field | Value |
|---|---|
| **App name** | PricePulse |
| **Tagline** | Pick a product from the INE mock store, pick an option, and get an honest price and stock history, scraped every 2 hours. |
| **Deadline** | **Sunday 2026-09-27, 13:00 IST** (07:30 UTC) |
| **Target site** | https://demo.inelabteamdev.com — the **only** site we may scrape |

## Problem

The mock store is built to be hard to scrape: it renders on the client, its prices change often, content loads late, responses are sometimes slow or fail, the price only appears after an interaction check, and CSS class names change between page loads. A naive scraper either breaks quietly or, worse, saves wrong prices. The evaluator wants a tracker that **keeps working unattended** and **records exactly what happened**, failures included.

## Target user

1. **The evaluator.** Opens the live link, searches for a product, tracks it, checks that the history and scrape log look real and honest, exports the CSV, and reads the design note. They'll be looking for silent failures and made-up data.
2. **A price-conscious shopper (the story the app tells).** Wants to watch one specific variant of a product (e.g. "Studio bundle") and see how its price and stock move over time.

## Core value

**Reliability and honesty over polish.** Every scheduled run leaves a record. A price is saved only after it has been checked. Failures show up as clearly as successes.

## Core features (Must Have)

| # | Feature | Acceptance criteria |
|---|---|---|
| M1 | **Product search** | Searching by partial or full name (case-insensitive) returns matching store products. Search runs over a cached copy of the store catalogue (the store API has no search). |
| M2 | **Option selection and tracking** | The user picks a product **and** one of its options (e.g. storage, kit, bundle, pack size). The tracked item is saved in Supabase. The same product + option can't be tracked twice. |
| M3 | **Scheduled scraping every 2 h** | An external cron (cron-job.org) triggers a scrape of every active tracked item every 2 hours. Scraping never depends on an always-on loop. |
| M4 | **Reliable extraction** | Handles slow loads, errors, late-loading content, the hover/interaction check, changing class names and split price text, with retries and backoff. |
| M5 | **Never store wrong data** | A price or stock value is saved only if it passes validation (see TRD §Scraper and Schema constraints). A failed attempt saves **no** price or stock. |
| M6 | **Price and stock history** | Each tracked item has a chart and a table of price and stock over time. |
| M7 | **Per-product scrape log** | Every attempt appears with its timestamp, outcome (`success` / `retried` / `failed`), number of tries, duration and error. |
| M8 | **CSV export** | An Export button downloads the full scrape history, **one row per scrape attempt**, with columns in this exact order: `product_id, product_name, option, timestamp, price, stock, outcome`. `product_id` = the store ID from the product URL (`/item/:id`). `timestamp` = ISO 8601 UTC. Failed rows have empty price and stock. |
| M9 | **Headed mode** | A CLI command runs the scraper in a visible browser (`HEADLESS=false`, slow-mo, verbose logs) so its behaviour can be watched and recorded, including how it handles slow or failing responses. |
| M10 | **Live deployment** | Frontend on Vercel, backend on Render, database on Supabase. At submission, **at least 3 items** are tracked and their history comes from real unattended runs. |

### Definitions (use these exact meanings everywhere)

- **Scrape attempt** = one scheduled (or manual) scrape of one tracked item within one run. It may contain several **tries**.
- **Outcome**
  - `success`: valid data on the first try
  - `retried`: valid data after one or more failed tries
  - `failed`: every try used up and no valid data. Price and stock stay empty.
- **Run** = one trigger (cron or manual) that scrapes every tracked item that is due.

## Nice to Have (bonus, in priority order)

1. **Scrape several options of one product in one page load.** The runner groups tracked items by product.
2. **Change detection.** Flag when the page's structure or manifest schema changes in a way we don't expect.
3. **In-app alerts** for price drops and items coming back into stock.
4. **Extra product info** on the dashboard: brand, category, SKU, specs, rating summary.
5. **Honest run log.** Show missed or interrupted runs as gaps, not silence.
6. **CI with GitHub Actions**: lint, typecheck, unit tests.
7. **Per-product scrape frequency.** The schema supports it; the default is 120 minutes.
8. **Email alerts** via SendGrid.

## Out of scope

- User accounts, sign-up or login (single shared dashboard)
- Scraping any site other than `demo.inelabteamdev.com`
- Real-time or sub-2-hour price streaming
- Mobile or native apps
- Payments, wishlists, social features
- Forging the store's bot-check challenge over plain HTTP. We drive a real browser instead (see TRD).

## User stories

- As a user, I want to **search by part of a product name** so that I can find a product without knowing its exact title.
- As a user, I want to **choose which option to track** so that I follow the price of the exact variant I'd buy.
- As a user, I want the app to **scrape automatically every 2 hours** so that I don't have to check the store myself.
- As a user, I want to **see price and stock over time** so that I can spot drops and restocks.
- As a user, I want to **see every scrape attempt and its outcome** so that I can trust the history isn't hiding failures.
- As an evaluator, I want to **export the full history as CSV** so that I can check the data offline.
- As an evaluator, I want to **watch a headed run** so that I can see how slow and failing responses are handled.

## Success metrics (at submission)

| Metric | Target |
|---|---|
| Tracked items | ≥ 3, from different products, with at least one bundle/storage option |
| Unattended scheduled runs recorded | ≥ 12 |
| Scheduled slots with no run record at all | 0 unexplained (missed or interrupted runs are shown) |
| Wrong or placeholder prices stored | **0** |
| Attempts with outcome `success` or `retried` | ≥ 90% |
| Failed attempts visible in log and CSV | 100% |
| CSV matches the M8 spec | Exactly |

## Deliverables checklist

- [ ] Live site link (Vercel)
- [ ] Public GitHub repo
- [ ] 2–4 minute screen recording of a headed run, including a slow or failing response
- [ ] README: setup, scraping schedule, environment variables
- [ ] Design note: how reliability was achieved, trade-offs, what the AI tools got wrong and how it was fixed (source: `NOTES.md`)
- [ ] PDF résumé (outside the repo)
