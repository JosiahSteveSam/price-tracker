# Design note — making the scraper reliable

## 1. What the store does to scrapers

Reconnaissance (headless/headed Playwright spikes in `backend/spike/`, plus reading the store's JS bundle) found:

- **The page is a React SPA**; the HTML is an empty shell.
- **Price & stock are not in the open JSON API.** `/api/v2/items/:id` returns details and options only. The
  price comes from `/api/v2/items/:id/quote?opt=oN`, which needs a `pass` token from a **challenge**: WebAssembly
  proof-of-work + canvas/WebGL/animation-frame fingerprint + **trusted pointer moves and hover dwell** over the
  price panel, then a **click**. The quote body is **encrypted** and decoded in the page.
- **~50% of challenges are rejected** (401), regardless of how the mouse moves (A/B tested). **17.5% of clicks are
  silently ignored**, another 17.5% delayed 900 ms. Quotes fail with `500 upstream_error` and the page retries them.
- **Decoys:** two hidden prices (`display:none`), a struck-through MRP, and a "Member price" carrying the
  manifest's `sale` class. The real price is one `<output>` whose characters are **split into spans with
  zero-width spaces**.
- **Seven price formats** chosen per response (`₹92,416`, `₹92.416,00`, `₹９２,４１６`, `Rs. 92,416.00`, one
  character per NBSP…), **six stock wordings** (the wording is picked by `qty % 5`).
- **A stale-price state**: price at 45% opacity + "Refreshing prices" — the page never refreshes it by itself.
- **The default option is random** on every load; switching option re-locks the panel.
- **A cookie dialog** on 75% of loads, after 1.5–5 s, that needs 1–3 clicks and swallows pointer events.
- **A rotating layout manifest** (class names, price tag, carrier, row order; `validUntil` ≈ 4 h).
- **The catalogue listing is reshuffled on every request**, so paging 16 pages misses products.

## 2. Fetch vs browser

Plain HTTP (`fetch` + zod) for everything the open API serves: catalogue, search cache, product details, options.
**Playwright only for price & stock**, because the value only exists after the page's own challenge and
decryption. Re-implementing the challenge (forging fingerprints and pointer data) would be brittle, would break on
the next store change, and is exactly what "headless only where genuinely required" argues against. We let the real
page do the work and read what a person would see.

## 3. How reliability is achieved

**Layered recovery, each layer for a different failure:**

1. The store page retries 5xx quotes itself — we wait for it rather than racing it.
2. **In-page rounds (up to 6):** hover → click → the click only "counts" if a handshake request follows within 3 s
   (else: ignored click, try again) → wait until a quote response or a rejected handshake arrives **after that
   click** and the panel reaches a final state → on `failed` press the page's Retry, on stale press "Check again".
   This network-driven state machine exists because reading "the panel looks final" once read the *previous*
   failure as the new result.
3. **Fresh page loads (up to 4)**, only for options still unresolved, with exponential backoff + jitter. A try
   has a hard timeout; a stuck browser is killed and relaunched.

**Never store wrong data.** A reading is accepted only if all of these hold: URL is the right product; exactly one
option chip pressed and it is the tracked label; the **last quote response after the final click was 200 for this
option id**; panel ready, not stale, price fully opaque; manifest selector and a structural selector (the only
`2.4rem` child) hit **the same node**; price parses (every format) and is in range; two reads 800 ms apart agree;
stock parses; price ≤ MRP. Visible text only (decoys are hidden). Anything else is a failure with a specific code.
The database enforces it too: CHECK constraints make "failed with a price" and "success without a price"
impossible to store.

**Never fail silently.** Every due item in every run gets exactly one attempt row. The run records its plan before
scraping and heartbeats every 60 s; a run that dies (deploy, OOM) is found by the next run or at boot and its
unfinished items get `failed / RUN_INTERRUPTED` rows (tested by killing a run mid-way). A run past its budget
records `RUN_BUDGET_EXCEEDED` for items it didn't reach. Scheduled slots with no run at all are shown as
**missed** in the API, the runs page and as shaded bands on each chart.

**Free-tier scheduling.** The cron endpoint validates a secret and answers `202` immediately (cron-job.org gives
up after 30 s; a run takes minutes). Each 2-hour UTC slot has a unique index, so any number of triggers is safe.
After the first unattended slot succeeded, cron-job.org's requests stopped reaching the app ("output too large"
in 0.7 s — something in front of Render answered instead; not reproducible from other networks) and three slots
were missed. The history showed the gap honestly; the fix was a **second, independent trigger** (GitHub Actions,
twice per slot, waiting patiently for the cold start). Two schedulers onto one idempotent endpoint removes the
single point of failure.

## 4. Trade-offs

- **Correctness over speed:** concurrency 1, two reads per value, up to 4 page loads — a good read takes 8–40 s
  (median ≈ 23 s) instead of < 1 s. Fine for a 2-hour schedule.
- **Chromium on a 512 MB free instance** is tight; one browser, one context at a time, images/fonts blocked. Worked
  in production; GitHub Actions could run the scraper itself if memory ever became the limit.
- **DOM, not the encrypted quote:** decoding the blob would be more precise but means reverse-engineering the
  store's crypto; the DOM plus strict validation is the honest "what a customer sees" value.
- **Stock status comes from the quantity only** ("Last few" is just a wording template, not a signal).
- **Catalogue sampling** costs ~120 paced requests (~80 s) once a day to cover the reshuffled listing; batches are
  saved as they arrive so search works immediately; lookup by product id covers any gap.
- **Skipped bonuses:** per-item frequency (changing the schedule this close to the deadline is risky) and email
  alerts (in-app alerts cover the need).

## 5. What the AI tools got wrong first, and how it was corrected

| First attempt | How it showed up | Correction |
|---|---|---|
| Assumed the JSON API would expose the price (plain HTTP would do) | `/items/:id` had options but no price; the bundle showed a challenge-gated quote | Hybrid design; Playwright for price/stock only |
| Spec said "prefer the manifest's `sale` class" for the price | `sale` is the decoy "Member price"; two more hidden decoys exist | Manifest `priceValue` **and** a structural selector must hit the same node; visible text only |
| Assumed hover alone reveals the price | Needs hover **and** a trusted click; 17.5% of clicks ignored | Click, then require a handshake within 3 s, else retry |
| One "Reject" click for the cookie dialog via a locator handler | 4/12 batch runs hung: the dialog needs 1–3 clicks | Click Reject until hidden (max 6) |
| After Retry, waited for "any final panel state" | Read the old failure as the new result | Network-driven state machine (outcome must arrive after the click) |
| Assumed one number format | A batch returned `₹16.996,00`; the bundle has 7 formats | Parser for all 7, unit-tested |
| Treated "Last few: N" as low stock | Wording picked by `qty % 5` | Status from quantity only |
| Checked Supabase tables with `head: true` count queries | Reported PASS for tables that didn't exist; `countActive` would read errors as "0 tracked" | GET + `limit(0)`; the check selects every column by name |
| Passed closures to `page.evaluate` under `tsx` | Every live read failed: `__name is not defined` (esbuild helper) — recorded honestly as 4 failed tries, nothing stored | No-op `__name` injected into every page |
| File writes turned `\u200B` escapes into literal invisible characters | ESLint `no-irregular-whitespace`; also a literal BOM in the CSV writer | Explicit escapes + a scan for invisible characters |
| Paged the listing 16 pages assuming stable order | Catalogue had 918 of 960 products | Sample until all `count` ids are seen |
| Charted failures with a Recharts `Scatter` over all rows | A phantom ✕ at the top edge for every *successful* reading | Scatter gets only failed rows |

## 6. Numbers (production data, 26 Sep 2026 ~10:15 IST)

17 attempts across 4 tracked items (3 products): 14 success, 1 retried, 2 failed (both `RUN_INTERRUPTED` from the
deliberate crash test). Across 18 page loads the scraper absorbed 5 rejected challenges, 7 ignored clicks and 16
cookie-dialog clicks without storing a single unvalidated value.
