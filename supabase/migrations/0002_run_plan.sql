-- 0002_run_plan.sql — record which tracked items a run intends to scrape.
-- Needed so recovery can write an honest `failed / RUN_INTERRUPTED` attempt for every planned item a crashed
-- run never finished (see backend/src/scraper/runner.ts). Run once in the Supabase SQL Editor.

alter table scrape_runs add column planned_item_ids uuid[] not null default '{}';
