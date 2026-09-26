-- 0001_init.sql — PricePulse schema.
-- Run once in the Supabase SQL Editor (or `supabase db push`). Not re-runnable: a second run fails at the
-- first CREATE TABLE without changing anything. Verify afterwards with `npm run db:check` in backend/.

create extension if not exists pg_trgm with schema extensions;

-- Cached store catalogue, used for search (the store API has no search).
create table catalog_products (
  store_product_id integer primary key,
  slug text not null,
  name text not null,
  brand text,
  category text,
  sku text,
  description text,
  refreshed_at timestamptz not null default now()
);
create index catalog_products_name_trgm on catalog_products using gin (name extensions.gin_trgm_ops);

-- One row per product + option being tracked. store_product_id is deliberately not an FK to the catalogue.
create table tracked_items (
  id uuid primary key default gen_random_uuid(),
  store_product_id integer not null,
  product_name text not null,
  product_slug text,
  brand text,
  category text,
  sku text,
  option_axis text not null,
  option_id text not null,
  option_label text not null,
  is_active boolean not null default true,
  scrape_interval_minutes integer not null default 120 check (scrape_interval_minutes between 30 and 1440),
  next_due_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (store_product_id, option_id)
);
create index tracked_items_due on tracked_items (next_due_at) where is_active;

-- One row per trigger (cron slot, manual, first-track, CLI).
create table scrape_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron','manual','first_track','cli')),
  slot_key timestamptz,
  status text not null default 'running'
    check (status in ('running','completed','completed_with_failures','interrupted','crashed')),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  items_total integer not null default 0,
  items_success integer not null default 0,
  items_retried integer not null default 0,
  items_failed integer not null default 0,
  manifest_signature text,
  host text,
  error_message text,
  check (trigger <> 'cron' or slot_key is not null)
);
create unique index scrape_runs_cron_slot on scrape_runs (slot_key) where trigger = 'cron';
create index scrape_runs_started on scrape_runs (started_at desc);

-- One row per scrape attempt (= one CSV row). Append-only.
create table scrape_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references scrape_runs(id),
  tracked_item_id uuid not null references tracked_items(id),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null check (outcome in ('success','retried','failed')),
  try_count smallint not null check (try_count >= 1),
  price numeric(12,2),
  mrp numeric(12,2),
  currency char(3),
  stock_status text check (stock_status in ('in_stock','low_stock','out_of_stock')),
  stock_qty integer check (stock_qty >= 0),
  stock_text text,
  error_code text,
  error_message text,
  tries jsonb not null default '[]'::jsonb,
  duration_ms integer not null check (duration_ms >= 0),
  page_signature text,
  -- Honesty constraints: the database itself refuses dishonest rows.
  constraint failed_has_no_data check (
    outcome <> 'failed' or (price is null and mrp is null and stock_status is null and stock_qty is null)
  ),
  constraint success_has_data check (
    outcome = 'failed' or (price is not null and price > 0 and currency is not null and stock_status is not null)
  ),
  constraint success_first_try check (outcome <> 'success' or try_count = 1),
  constraint retried_multi_try check (outcome <> 'retried' or try_count >= 2),
  constraint failed_has_error check (outcome <> 'failed' or error_code is not null),
  constraint finished_after_start check (finished_at >= started_at)
);
create index scrape_attempts_item_time on scrape_attempts (tracked_item_id, finished_at desc);
create index scrape_attempts_run on scrape_attempts (run_id);
create index scrape_attempts_time on scrape_attempts (finished_at);

-- Bonus: price-drop / back-in-stock / structure-change alerts.
create table alerts (
  id uuid primary key default gen_random_uuid(),
  tracked_item_id uuid references tracked_items(id),
  attempt_id uuid references scrape_attempts(id),
  type text not null check (type in ('price_drop','back_in_stock','structure_change')),
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index alerts_unseen on alerts (created_at desc) where seen_at is null;

-- Bonus: change detection — manifest/layout schema signatures seen so far.
create table structure_signatures (
  signature text primary key,
  sample jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1
);

-- Only the backend (service role, which bypasses RLS) touches data.
-- RLS on + no policies => the anon/authenticated roles can neither read nor write.
alter table catalog_products     enable row level security;
alter table tracked_items        enable row level security;
alter table scrape_runs          enable row level security;
alter table scrape_attempts      enable row level security;
alter table alerts               enable row level security;
alter table structure_signatures enable row level security;

-- Partial, case-insensitive name search. `q` must already have % _ \ escaped by the caller.
create or replace function search_catalog(q text, max_results int default 20)
returns setof catalog_products
language sql stable
set search_path = public, extensions
as $$
  select * from catalog_products
  where name ilike '%' || q || '%'
  order by (lower(name) like lower(q) || '%') desc, similarity(name, q) desc, name
  limit max_results;
$$;
revoke execute on function search_catalog(text, int) from public, anon, authenticated;
grant execute on function search_catalog(text, int) to service_role;
