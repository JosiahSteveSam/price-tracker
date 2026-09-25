# 07 — Scraper Spec (the graded core)

> An addition to the six standard docs. The brief says scraping reliability is "the heart of this assignment".
> **Status:** Phase 0 spike finished on 2026-09-25. Everything below was **observed** on the live store or read from its JS bundle (`/assets/index-GaW5Fnef.js`). The prototype is in `backend/spike/extract2.mjs` + `normalize.mjs`.

## Goals, in priority order

1. **Never store wrong data.** A wrong price is worse than a missing one.
2. **Never fail silently.** Every due item in every run produces exactly one attempt row, even if the process crashes (recovered on the next run).
3. **Recover automatically** from slow loads, HTTP errors, rejected challenges, ignored clicks, overlays, stale prices, and layout or format changes.
4. **Stay light:** HTTP for catalogue and options; one browser, concurrency 1, for price and stock.

## How the product page works

### Loading
- `GET /item/:id` returns an empty React shell. The page then fetches `GET /api/v2/items/:id` and `GET /api/v2/ui/manifest` in parallel.
- **Slow loads are real:** the manifest sometimes arrives ~15 s after navigation. Use timeouts of at least 30 s.
- If the page's manifest request fails, it renders **without** the rotating classes (`priceWrap` etc. become empty). The scraper must then fall back to structural selectors (see §Selectors).

### Options
- Options are `button.opt-chip` (`aria-pressed="true"` on the selected one, class `opt-chip-on`). Their text is the option label from the item API.
- **The default selected option is RANDOM on every load.** Always click the target option and check `aria-pressed`.
- Changing the option resets the price panel to *locked*.

### The price panel (`.offer-panel`, which also has the manifest `priceWrap` class)

| State | DOM | Button |
|---|---|---|
| locked | `.offer-panel.offer-locked`; "Price locked" + "Hover over the price area…" / "Hold on — checking availability…" / "Check the current price and availability." | "Check today's price", `disabled` until the hover requirements are met |
| loading | `.offer-panel[aria-busy=true]` + `.loader`; "Loading current price…" or "Retrying (attempt n/6)… Store responded with "…"" | — |
| failed | `.offer-panel.offer-failed`; "Couldn't load the price after N attempts." + a reason (e.g. `challenge_failed`) | "Retry" |
| ready | `.offer-panel.offer-ready` with `.offer-row`, `.offer-facts`, `.offer-foot` ("Loaded in N attempts") | "Check again" |
| **pending (stale!)** | ready, but the price is at `opacity: .45` and a "Refreshing prices" span is present. **The page never refreshes it by itself** | "Check again" |

### Unlocking the price (all on the client, done by the page itself)
1. **Hover:** the page records `mousemove` over the panel (≥ 40 ms apart, last 40 kept, **never reset** for the page's lifetime). It requires ≥ **8 moves** and ≥ **600 ms** since the first hover.
2. **Click** the button (the event must be trusted, `isTrusted`). **17.5% of clicks are silently ignored and 17.5% are delayed by 900 ms** (a random wrapper in the bundle).
3. `GET /api/v2/handshake` returns `{salt, ts, difficulty, csig, wasm}`. The page runs a WebAssembly proof-of-work and builds an attestation from the canvas/WebGL/rAF fingerprint and the hover snapshot.
4. `POST /api/v2/handshake` returns `{pass, ttlMs: 30000}`, **or 401 `unauthorized` in roughly 40–60% of attempts**, whatever our hover strategy (tested). A 401 is fatal for that click: the panel goes to *failed / challenge_failed*.
5. `GET /api/v2/items/:id/quote?opt=<optionId>` with `Authorization: Bearer <pass>` returns `{itemId, option, ver, blob, ts}`. The blob is encrypted and decoded in the page. 5xx (`{"error":"upstream_error"}`) and 429 are **retried by the page itself** (up to 6 times, 300·n ms backoff).

We never recreate steps 3–5. Playwright drives the real page, which does them itself.

### The rendered ready panel (`.offer-row` children, in order)

| Element | Meaning | Use? |
|---|---|---|
| `span.price-value[aria-hidden=true][style=display:none]` | **Decoy** price | ❌ never |
| `span.<mrp>` (inline `text-decoration: line-through`) | MRP (list price) | ✅ as `mrp` |
| `span.<sale>` "Member price ₹…" (only sometimes) | **Decoy**: member price. Uses the manifest's `sale` class | ❌ never |
| `<priceTag>.<rot> <priceValue>` (inline `font-size: 2.4rem`) | **The real current price**. With `priceCarrier: "split"`, every character is in its own `<span>` followed by U+200B | ✅ **price** |
| `span.<badge>` "NN% saving" | Unreliable (didn't match price/MRP in one observation) | ❌ |
| "Refreshing prices" span | Present when the quote is pending, i.e. **stale** | ⚠️ means not ready |
| `span.amount[data-price][aria-hidden][display:none]` | **Decoy** price | ❌ never |

`.offer-facts` children are ordered by `manifest.order`: seller (`Seller: Mar​lowe & Co`, split with U+200B), delivery (text), **stock** (`.avail-pill.avail-yes` with count text, or `.avail-pill.avail-no` "Sold out"), and rating (`aria-label="Rated 4.8 out of 5"` when `ratingAria`).

### Price formats (`quote.format`, chosen per response)

| format | Example |
|---|---|
| default | `₹92,416` (en-IN grouping, e.g. `₹1,02,657`) |
| spaced | `₹92 416` |
| euro | `₹92.416,00` |
| trailing | `₹92,416/- (incl. of all taxes)` |
| unicode | `₹９２,４１６` (full-width digits U+FF10–FF19) |
| nbsp | every character followed by U+00A0 U+200B: `₹ 9 2 , 4 1 6` |
| lakh | `Rs. 92,416.00` |

Currency comes from the quote (all observed: INR). The formatter supports any ISO code (`en-IN` currency style).

### Stock formats (`template = qty % 5`, so the wording carries no meaning)

`N units available` · `Last few: N` · `Available (N)` · `Stock: N remaining` · `Ready to ship · N available` · `Sold out` (qty 0, `.avail-no`).
Stock is **per product** (all options showed the same count).

### Consent dialog
- `[role=dialog][aria-label="Privacy preferences"]` inside `.consent-scrim`. It appears on **75%** of loads after **1.5–5 s**, at the bottom, top or centre, and sets `body{overflow:hidden}`. The scrim **intercepts pointer events**, so hover moves and clicks don't reach the panel.
- Allow and Reject share one handler that needs **1 click (70%), 2 (25%) or 3 (5%)** before it closes. We click **Reject** (privacy-preserving) until the dialog is hidden.

### Manifest
`{revision, variant, validUntil, classes{priceWrap, priceValue, mrp, sale, badge, rating, seller, delivery, stock}, order[], priceTag, priceCarrier, ratingAria, sellerTitle}`. `validUntil` is about 4 h ahead, so **expect rotation** of class names, tag (the renderer defaults to `span`), carrier (`split` or plain) and the order of the facts rows during unattended operation. Only variant 4 / `output` / `split` has been observed so far.

### Open API behaviour (HTTP client)
- `/api/v2/listings?page&limit`: max 60 per page, 960 products, 16 "pages"; `q` is ignored. **The full list is reshuffled on every request** (the same page 1 fetched twice shares ~2/60 products), so paging 16 pages covers only ~60–95%. The catalogue is collected by sampling until all `count` unique ids are seen: about 120 requests at 400 ms, ~80 s. Batches are upserted as they arrive.
- `/api/v2/items/:id`: details + `optionAxis` + `options[{id,label}]`.
- **Sporadic non-JSON error pages** (HTML body) after bursts of about 20 quick requests. Always check `content-type` and retry with backoff. Keep catalogue refreshes slow (≥ 300 ms between pages).

## Pipeline for one attempt (one tracked item)

```
for try in 1..MAX_TRIES (4):                         # each try = fresh browser context + page load
  ctx/page; register consent locator handler (click Reject until hidden)
  capture manifest response (optional; may be missing)
  goto /item/{id} (domcontentloaded, 45s) ; wait option chip (30s)
  click target chip ; assert aria-pressed=true and it's the only pressed chip
  for round in 1..6:                                  # in-page rounds
    dismiss consent ; hover panel (24 jittered moves, ~60-95ms apart) ; dwell 2.2-2.7s
    state = panel state
    ready (not pending) → break
    click the panel button (locked: "Check today's price", failed: "Retry", pending: "Check again")
    if no GET /handshake within 3s → "click ignored", next round
    wait until a quote response or handshake 4xx arrives after the click AND the panel is ready/pending/failed (25s cap)
  if not ready → try failed (CHALLENGE_REJECTED / PRICE_NOT_RENDERED / QUOTE_TIMEOUT), backoff, next try
  read A ; sleep 800ms ; read B ; normalize ; validate (all rules below)
  valid → success (try 1) or retried (try > 1)
```

- **Grouping (bonus):** several options of one product share a page load. After a valid read, click the next option chip (the panel resets to locked) and repeat the rounds. Validation checks that the **last quote's `opt` equals this option's ID**.
- **Crash recovery:** if the browser disconnects, relaunch it once and continue with the next try.
- Every try logs `{n, startedAt, durationMs, ok, errorCode, message, rounds, handshakes:{ok, rejected}, quoteStatuses[], consentClicks, manifestVariant}` into `tries`.

## Selectors (in order; they must agree)

1. **Stable structural anchors** (not rotated): `.offer-panel`, `.offer-ready`, `.offer-row`, `.offer-facts`, `.avail-pill`, `.avail-yes|.avail-no`, `button.opt-chip`.
2. **Price element:** within `.offer-panel.offer-ready .offer-row`:
   - by manifest: `.${classes.priceValue}`
   - by structure: the child with inline `font-size: 2.4rem`

   If both exist, **they must be the same node**, else `SELECTOR_CONFLICT`. If the manifest is missing, use structure only and log `selectorSource:"structure"`.
3. **MRP:** the `.offer-row` child with inline `line-through`. It must not be the price element.
4. **Stock:** `.offer-panel.offer-ready .offer-facts .avail-pill`.
5. Read **visible text only**: walk text nodes, skip anything where `checkVisibility({checkOpacity, checkVisibilityCSS})` is false or that's inside `[aria-hidden=true]`.

## Normalization (`normalize.ts`)

1. Remove U+200B–U+200D, U+2060, U+FEFF. Map U+00A0/U+202F/U+2007/U+2009 → space. Map full-width digits → ASCII. Collapse whitespace.
2. Price:
   - strip the `/- (incl. of all taxes)` suffix
   - if every space-separated token is one character (nbsp format), join them
   - currency prefix: `₹`, `Rs.` or `INR` → INR; `US$` or `$` → USD; `€` → EUR; `£` → GBP; anything else → `CURRENCY_UNKNOWN`
   - the rest must be `\d[\d.,\s]*`
   - the **decimal separator** is the last `.` or `,` **followed by exactly 2 digits at the end**; every other separator is grouping
   - grouping check: the last group has 3 digits, middle groups have 2 or 3
   - store as integer minor units
3. Stock: the exact regexes for the 6 templates. qty 0 / "Sold out" → `out_of_stock`, qty > 0 → `in_stock`. `low_stock` is **not** derived, because "Last few" is only a wording template. Anything else → `STOCK_UNRECOGNIZED`.

Unit tests must cover every format in the tables above (see `spike/normalize.mjs` self-test).

## Validation (`validate.ts`): all rules must pass

| Rule | Error code if it fails |
|---|---|
| `location.pathname === /item/{id}` | `PRODUCT_MISMATCH` |
| Exactly one pressed chip, and its text equals `option_label` | `OPTION_MISMATCH` |
| The last quote response after the final click was 200 with `opt === option_id` and path `/api/v2/items/{id}/quote` | `QUOTE_MISMATCH` |
| Panel is `offer-ready`, no "Refreshing prices", price element opacity is `1` | `PRICE_STALE` / `PRICE_NOT_RENDERED` |
| Manifest and structural price selectors resolve to the same node (when a manifest exists) | `SELECTOR_CONFLICT` |
| Price parses; `0 < price < 10,000,000` | `PRICE_PARSE_ERROR` / `CURRENCY_UNKNOWN` / `PRICE_OUT_OF_RANGE` |
| Two reads 800 ms apart are identical (price text and stock text) | `PRICE_UNSTABLE` |
| Stock parses | `STOCK_UNRECOGNIZED` |
| If an MRP parses, `price <= mrp` | `PRICE_GT_MRP` |

**No sanity check against the previous price.** Prices change often by design (observed ₹83,348 → ₹92,416 for the same option within an hour).

## Error codes and retry policy

| Code | Retry with a new page? | Cause |
|---|---|---|
| `NAV_TIMEOUT` | yes | Slow document or asset load |
| `ITEM_NOT_RENDERED` | yes | Option chips didn't appear (item API slow or failed in the page) |
| `CHALLENGE_REJECTED` | yes | Every in-page round ended with a handshake 401 |
| `QUOTE_FAILED` | yes | Page gave up after its own 6 quote retries (5xx/429) |
| `CLICK_IGNORED` | yes | Every round's click was swallowed |
| `PRICE_NOT_RENDERED` / `PRICE_STALE` | yes | Not ready or still pending when the rounds ran out |
| `PRICE_UNSTABLE` / `QUOTE_MISMATCH` / `SELECTOR_CONFLICT` | yes | Read during a transition or the page shifted |
| `OPTION_MISMATCH` / `PRODUCT_MISMATCH` | yes (once) | Wrong chip selected or redirected |
| `OPTION_NOT_FOUND` | **no** + alert | Option label no longer on the page |
| `PRODUCT_NOT_FOUND` | **no** + alert | 404 from the item API |
| `PRICE_PARSE_ERROR` / `CURRENCY_UNKNOWN` / `STOCK_UNRECOGNIZED` / `PRICE_GT_MRP` / `PRICE_OUT_OF_RANGE` | yes, then fail + `structure_change` alert if it repeats | A new format or layout |
| `BROWSER_CRASH` | yes (relaunch) | Out of memory / target closed |
| `RUN_BUDGET_EXCEEDED` / `RUN_INTERRUPTED` | no | Written by the runner or recovery |
| `UNKNOWN` | yes | Anything else (log the stack) |

- `MAX_TRIES = 4` page loads; up to 6 in-page rounds per load. Backoff between tries: `min(2^n × 1500 ms, 12 s) + jitter(0–1000 ms)`.
- Per-try hard timeout `SCRAPE_TRY_TIMEOUT_MS = 90 s`, measured from the spike: a good read takes 8–40 s, 6 rounds can take about 50 s, and loads can be slow. The context is always closed in `finally`.
- Outcome: try 1 valid → `success`; later try valid → `retried`; none valid → `failed`. In-page rounds do **not** count as retries; only fresh page loads do. The round count is recorded in `tries`.
- **Measured (spike, 8 pairs):** 7/8 valid on the first page load (1–5 rounds), 1/8 needed a second page load.

## Run orchestration (`runner.ts`)

1. **Recover:** mark `running` runs with `heartbeat_at < now() - 15 min` as `interrupted`. For each active item without an attempt in that run, insert a `failed` / `RUN_INTERRUPTED` attempt.
2. **Create the run:** cron → insert with `slot_key`. A unique violation means **skip**.
3. **Select items:** `is_active and next_due_at <= now() + 5 min`.
4. **Execute** one product group at a time, with 1–3 s jitter between products. Heartbeat after each attempt. Stop taking new items when the run budget is spent; the rest get `RUN_BUDGET_EXCEEDED`. Budget: `SCRAPE_RUN_BUDGET_MS = 15 min`, enough for about 4 tries × 90 s for several items.
5. **Persist** each attempt right after it finishes, then set `next_due_at`.
6. **Finalize:** counts, status. Any unexpected exception → `crashed`, after writing failed attempts for the remaining items.
7. **Post-run (bonus):** price-drop and back-in-stock alerts; structure signature from the manifest schema + observed format/carrier.

## Headed mode (`cli/scrape.ts`)

```
npm run scrape:headed -- --all                       # headed, slowMo 40, pretty logs, dry-run
npm run scrape:headed -- --product 2312 --option o3  # one pair
npm run scrape:headed -- --all --save                # persist with trigger='cli'
npm run scrape:headed -- --all --simulate slow       # demo only: page.route delays the quote by 20 s once
npm run scrape:headed -- --all --simulate fail       # demo only: page.route returns 503 on the quote once
```

- The real store usually misbehaves on camera anyway: consent dialogs, ignored clicks, 401 challenge failures and the Retry flow. `--simulate` is only a backup, labelled `[SIMULATED]`, and can't be combined with `--save`.
- On-page overlay (via `page.evaluate`): `try n/4 · round r/6 · state · last error`.
- Saves a screenshot to `backend/artifacts/` on every failed try.

## Tests (`vitest`)

- `normalize`: every price and stock format above, plus the reject cases (`Price locked`, `₹`, `₹--`, missing currency, bad grouping).
- `validate`: each rule produces its own error code.
- `retry`: classification + backoff limits.
- `runner` with a fake page driver: success / retried / failed rows; budget; interrupted-run recovery; slot idempotency.
- `csv`: quoting, BOM, column order, empty price/stock on failed rows.
