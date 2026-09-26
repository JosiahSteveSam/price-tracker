# NOTES — decisions, trade-offs and AI corrections

Running log that feeds `DESIGN_NOTE.md`. Newest entries at the bottom. Keep entries short and factual.

## Decisions

- **2026-09-25: hybrid scraper.** Store recon found open JSON endpoints for the catalogue, product details and options, but price and stock sit behind a browser-only challenge (fingerprint + trusted hover/dwell + pass token + encoded response). Decision: plain `fetch` for catalogue and options, Playwright only for price and stock. We don't forge the challenge over HTTP. See docs/02-TRD.md §Why a hybrid scraper.
- **2026-09-25: search runs over a cached catalogue.** `/api/v2/listings` ignores `q`; 960 products across 16 pages of 60. We cache them in `catalog_products` and search with ILIKE + trigram.
- **2026-09-25: free-tier scheduling.** cron-job.org every 2 h (fire-and-forget, 202) + a 10 min keep-warm ping. Idempotency via a unique `slot_key`. Stale-run recovery writes `RUN_INTERRUPTED` attempts so crashes stay visible.
- **2026-09-25: honesty enforced in the DB.** CHECK constraints make "failed with a price" and "success without a price" impossible to store.
- **2026-09-25: CSV granularity.** One row per scrape attempt (one tracked item in one run); individual tries are kept in `tries` jsonb and shown in the scrape log.

## AI mistakes and corrections

| Date | What the AI assumed or did | How it showed up | Fix |
|---|---|---|---|
| 2026-09-25 | Initial hypothesis: the store's JSON API would expose price, so plain HTTP scraping would be enough | `/api/v2/items/:id` returned specs, reviews and options but no price or stock. The bundle showed a challenge-gated price endpoint | Switched to the hybrid design; price and stock via Playwright |
| 2026-09-25 | Spec said "prefer the manifest's `sale` class for the price" | Spike: the `sale` class is a **decoy** "Member price ₹…" span; the real price is `priceValue` in the `<output>`. Two more hidden decoy prices (`.price-value`, `.amount[data-price]`) sit in the same row | Price = manifest `priceValue` **and** the structural 2.4rem node must be the same element; visible text only |
| 2026-09-25 | Assumed the price is revealed by hover alone | The panel needs hover (≥ 8 moves, ≥ 600 ms) **then a click** on "Check today's price", and 17.5% of clicks are silently ignored | Click, then require a handshake request within 3 s, else treat as ignored and repeat |
| 2026-09-25 | Handled the consent dialog with a single "Reject" click via `addLocatorHandler` | 4/12 batch runs crashed: the dialog needs 1–3 clicks (random), so the handler kept waiting for it to hide | Click Reject in a loop until hidden (max 6), using `noWaitAfter` |
| 2026-09-25 | Waited for "any terminal panel state" after clicking Retry | The old *failed* panel was read as the new result before the new handshake even returned | Network-driven state machine: a result only counts once a handshake/quote response arrives after the click |
| 2026-09-25 | Spec treated "Last few: N" as a `low_stock` signal | Bundle: the stock wording template is picked by `qty % 5`, so the wording carries no meaning | Status derived from qty only (0 = out of stock) |
| 2026-09-25 | Assumed one number format (en-IN) | Batch run returned `₹16.996,00`; the bundle has 7 formats (euro, spaced, full-width digits, per-character NBSP, `Rs.` lakh, trailing tax text) | `normalize` handles all 7, with a self-test for each |
| 2026-09-25 | Assumed the Supabase `head: true` count query would report an error for a missing table | `db:check` printed PASS for all 6 tables before the migration had been run; column-level selects returned `PGRST205` | Counts use GET + `limit(0)`; `db:check` selects every expected column by name. The same HEAD pattern in `countActive` could have read an error as "0 tracked" |
| 2026-09-25 | The AI's file-writing step turned `​`-style escapes in regex literals into the literal invisible characters | ESLint `no-irregular-whitespace` on `normalize.ts`; the code *worked* but was unreadable and fragile to edit | Rewrote the lines with explicit escapes and added a scan for invisible characters in `src/` and `test/` |
| 2026-09-25 | Passed closures with named inner arrow functions to `page.evaluate` while running under `tsx` | First live dry run: every read failed with `ReferenceError: __name is not defined` (esbuild `keepNames` helper doesn't exist in the page). The honesty path held: 4 tries recorded, no data stored | `addInitScript` defines a no-op `__name` in every context |
| 2026-09-25 | Catalogue collector assumed listing pages are stable (paged 1–16, plus 3 extra passes for "possible shuffling") | The live DB held 918 of 960 products, so search would silently miss ~42. Probe: the same page 1 twice shared 2/60 ids; the whole list is reshuffled per request | Coupon-collector sampling until `count` unique ids (960 in ~120 requests / 79 s), batches upserted as they arrive; search also accepts a product id |

## Phase 0 facts worth quoting in the design note

- Challenge: handshake POST is rejected ≈50% of the time regardless of hover strategy (A/B tested) → recovery via the page's Retry + fresh page loads, not via "better" mouse faking.
- The page's default option is random; the price is stale while "Refreshing prices" is shown; the manifest rotates about every 4 h.
- Spike results: 7/8 pairs valid on the first page load (8–40 s), the 8th on a fresh load.

## Incidents

- **2026-09-26: three scheduled slots missed (22:00, 00:00, 02:00 UTC).** The first unattended Render run (20:00 UTC) completed 4/4, then no runs arrived. At 04:07 UTC `/healthz` took 27.7 s and showed a fresh boot, so the keep-warm ping wasn't reaching the server either. The honest-history design surfaced it: `/api/runs` listed the slots as **missed** rather than hiding the gap. Response: (1) checked the cron-job.org side (see below); (2) added an **independent GitHub Actions backup trigger** (`.github/workflows/cron-backup.yml`, :07 and :37 of every even hour) that waits patiently for the cold start; slot idempotency makes duplicate triggers harmless. **Lesson:** a single external scheduler plus a sleeping free-tier host is a single point of failure; two independent triggers onto an idempotent endpoint removes it.

## Trade-offs

- Playwright on Render's free tier (512 MB) is tight. We accept the memory risk for correctness, and keep a GitHub Actions scheduled workflow as a documented fallback.
- Concurrency 1 makes runs slower but kinder to the store and more predictable on 512 MB.
