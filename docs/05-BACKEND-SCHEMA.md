# 05 — Backend Schema: Data Model & Access

> The SQL below is what goes into `supabase/migrations/0001_init.sql`. Change the schema **only** by adding a new migration **and** updating this doc.

## Principles

1. **Honest history is enforced by the database, not just by code.** CHECK constraints make it impossible to store a price on a failed attempt, or a successful attempt without a price.
2. **Append-only attempts.** Scrape attempts are never updated after they're finalized, and never deleted.
3. **The backend is the only client.** RLS is enabled on every table with **no policies**, so the anon key can't read or write anything. The backend uses the service-role key.
4. UTC everywhere (`timestamptz`).

## Tables

### `catalog_products`: cached store catalogue (for search)

| Column | Type | Notes |
|---|---|---|
| `store_product_id` | `integer` PK | Store ID as shown in the `/item/:id` URL |
| `slug` | `text` not null | |
| `name` | `text` not null | Searched with ILIKE + trigram index |
| `brand` | `text` | |
| `category` | `text` | |
| `sku` | `text` | |
| `description` | `text` | |
| `refreshed_at` | `timestamptz` not null default now() | |

### `tracked_items`: one row per product + option being tracked

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `store_product_id` | `integer` not null | Deliberately **not** a foreign key to `catalog_products`, so a catalogue refresh can never break tracking |
| `product_name` | `text` not null | Snapshot at tracking time; updated if the store renames the product |
| `product_slug` | `text` | |
| `brand`, `category`, `sku` | `text` | Snapshot, for the dashboard |
| `option_axis` | `text` not null | e.g. `Bundle`, `Storage` |
| `option_id` | `text` not null | e.g. `o3` |
| `option_label` | `text` not null | e.g. `Studio bundle` (goes into the CSV `option` column) |
| `is_active` | `boolean` not null default true | Untracking is a soft delete |
| `scrape_interval_minutes` | `integer` not null default 120 | Bonus: per-item frequency |
| `next_due_at` | `timestamptz` not null default now() | Runner scrapes items with `next_due_at <= now()` |
| `created_at` | `timestamptz` not null default now() | |
| unique | `(store_product_id, option_id)` | No duplicate tracking |

### `scrape_runs`: one row per trigger

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `trigger` | `text` not null | `cron` \| `manual` \| `first_track` \| `cli` |
| `slot_key` | `timestamptz` | The 2 h UTC slot this cron run belongs to (`date_trunc` to an even hour). Null for non-cron runs |
| `status` | `text` not null | `running` \| `completed` \| `completed_with_failures` \| `interrupted` \| `crashed` |
| `started_at` | `timestamptz` not null default now() | |
| `heartbeat_at` | `timestamptz` not null default now() | Updated after each attempt; used to detect stale runs |
| `finished_at` | `timestamptz` | |
| `items_total` / `items_success` / `items_retried` / `items_failed` | `integer` not null default 0 | |
| `manifest_signature` | `text` | Schema signature seen in this run (change detection) |
| `host` | `text` | `render`, `local`, `gha` (where it ran) |
| `error_message` | `text` | Only for `crashed` / `interrupted` |
| `planned_item_ids` | `uuid[]` not null default `'{}'` | Items this run intends to scrape (set before scraping). Recovery writes `RUN_INTERRUPTED` attempts for planned items with no attempt. *(migration 0002)* |
| unique partial index | `slot_key where trigger='cron'` | Idempotency: one cron run per slot |

### `scrape_attempts`: one row per scrape attempt (the CSV rows)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `run_id` | `uuid` not null FK → `scrape_runs.id` | |
| `tracked_item_id` | `uuid` not null FK → `tracked_items.id` | |
| `started_at` | `timestamptz` not null | |
| `finished_at` | `timestamptz` not null | **CSV `timestamp`** |
| `outcome` | `text` not null | `success` \| `retried` \| `failed` |
| `try_count` | `smallint` not null | ≥ 1 |
| `price` | `numeric(12,2)` | Current or sale price. **Null if and only if failed** |
| `mrp` | `numeric(12,2)` | Struck-through list price if shown (informational; validation requires `price <= mrp`) |
| `currency` | `char(3)` | e.g. `INR`. Not null when successful |
| `stock_status` | `text` | `in_stock` \| `out_of_stock` (based on qty only; `low_stock` is reserved and not derived, since the store's "Last few" is only a wording template). **Null if and only if failed** |
| `stock_qty` | `integer` | Quantity from the stock text (e.g. "Stock: 143 remaining" → 143; "Sold out" → 0) |
| `stock_text` | `text` | Cleaned raw stock text, for auditing |
| `error_code` | `text` | Final error code when failed. Last error seen when retried |
| `error_message` | `text` | |
| `tries` | `jsonb` not null default `'[]'` | Per-try details: `[{n, startedAt, durationMs, ok, errorCode, message, httpStatus}]` |
| `duration_ms` | `integer` not null | |
| `page_signature` | `text` | Manifest schema signature on this page load |

CSV mapping (PRD M8), in order:

| CSV column | Source |
|---|---|
| `product_id` | `tracked_items.store_product_id` |
| `product_name` | `tracked_items.product_name` |
| `option` | `tracked_items.option_label` |
| `timestamp` | `finished_at`, formatted `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `price` | `price` with 2 decimals, empty if null |
| `stock` | `stock_qty` if not null, else `stock_status`, else empty |
| `outcome` | `outcome` |

Sort by `finished_at` ascending, then `product_id`. Use RFC 4180 quoting (quote fields containing `,`, `"` or newlines; double inner quotes). UTF-8 with a BOM so Excel shows ₹ correctly.

### `alerts` (bonus)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `tracked_item_id` | `uuid` FK (nullable for system-wide alerts) | |
| `attempt_id` | `uuid` FK → `scrape_attempts.id` (nullable) | |
| `type` | `text` not null | `price_drop` \| `back_in_stock` \| `structure_change` |
| `message` | `text` not null | |
| `payload` | `jsonb` | e.g. `{from: 12999, to: 12499}` or the manifest diff |
| `created_at` | `timestamptz` not null default now() | |
| `seen_at` | `timestamptz` | |

### `structure_signatures` (bonus: change detection)

| Column | Type | Notes |
|---|---|---|
| `signature` | `text` PK | Hash of the sorted manifest **keys and value types** plus the set of `priceTag` / `priceCarrier` values. Class names aren't included, because they rotate by design |
| `sample` | `jsonb` not null | One manifest example |
| `first_seen_at` | `timestamptz` not null default now() | |
| `last_seen_at` | `timestamptz` not null default now() | |
| `seen_count` | `integer` not null default 1 | |

A signature seen for the first time **after** the first 24 h of operation creates a `structure_change` alert.

## Relationships

- `tracked_items 1 — * scrape_attempts`
- `scrape_runs 1 — * scrape_attempts`
- `tracked_items 1 — * alerts`, `scrape_attempts 1 — 0..1 alerts`
- `catalog_products` is standalone (search cache).

## Migration SQL

The authoritative SQL is in **[`supabase/migrations/`](../supabase/migrations/)**: `0001_init.sql` (everything below) and `0002_run_plan.sql` (`scrape_runs.planned_item_ids`). It implements exactly the tables, constraints and indexes above, plus these Supabase details:
- `pg_trgm` is installed in the `extensions` schema; the index uses `extensions.gin_trgm_ops`.
- No `pgcrypto`: `gen_random_uuid()` is built into Postgres 13+.
- `search_catalog(q, max_results)` pins `search_path = public, extensions`, and only `service_role` may execute it (revoked from `public`, `anon`, `authenticated`).
- RLS is enabled on every table with no policies.

After applying it, run `npm run db:check` in `backend/`. It verifies every column, the search RPC, each honesty constraint (by trying to insert dishonest rows), cron-slot idempotency and duplicate-tracking rejection, then deletes its synthetic rows.

## Access model

| Actor | Access |
|---|---|
| Browser (anyone with the site link) | Only through the Express API. Read everything; track new items (rate-limited, capped at `MAX_TRACKED_ITEMS`) |
| cron-job.org | `POST /api/cron/scrape` with `X-Cron-Secret` |
| Admin (the developer) | `X-Admin-Token`: untrack, manual scrape, catalogue refresh |
| Backend | Supabase service role (bypasses RLS) |
| Supabase anon key | **Not used anywhere** |

## Sensitive fields

- No PII is stored. Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ADMIN_TOKEN`, `SENDGRID_API_KEY`) live only in Render and local `.env`, never in the DB, repo or frontend.
- Compare secrets in constant time (`crypto.timingSafeEqual`).

## File storage

None. Screenshots from headed or debug runs are saved locally under `backend/artifacts/` (gitignored). They aren't uploaded.
