// Verifies the live Supabase schema: tables reachable, search RPC works, and the honesty constraints
// actually reject dishonest rows. Creates clearly-synthetic rows (store_product_id = -1) and deletes them.
// Usage: npm run db:check
import { attemptsRepo } from '../db/attemptsRepo.js';
import { catalogRepo } from '../db/catalogRepo.js';
import { runsRepo } from '../db/runsRepo.js';
import { PG, db } from '../db/supabase.js';
import { trackedRepo } from '../db/trackedRepo.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail });

async function expectRejected(name: string, row: Record<string, unknown>, code: string, constraint?: string) {
  const { error } = await db().from('scrape_attempts').insert(row);
  const ok = error?.code === code && (!constraint || error.message.includes(constraint));
  check(name, ok, error ? `${error.code} ${error.message}` : 'row was ACCEPTED');
}

async function main() {
  // Select every expected column by name with a GET (a HEAD request reports no error for a missing table).
  const expected: Record<string, string> = {
    catalog_products: 'store_product_id,slug,name,brand,category,sku,description,refreshed_at',
    tracked_items:
      'id,store_product_id,product_name,product_slug,brand,category,sku,option_axis,option_id,option_label,is_active,scrape_interval_minutes,next_due_at,created_at',
    scrape_runs:
      'id,trigger,slot_key,status,started_at,heartbeat_at,finished_at,items_total,items_success,items_retried,items_failed,manifest_signature,host,error_message,planned_item_ids',
    scrape_attempts:
      'id,run_id,tracked_item_id,started_at,finished_at,outcome,try_count,price,mrp,currency,stock_status,stock_qty,stock_text,error_code,error_message,tries,duration_ms,page_signature',
    alerts: 'id,tracked_item_id,attempt_id,type,message,payload,created_at,seen_at',
    structure_signatures: 'signature,sample,first_seen_at,last_seen_at,seen_count',
  };
  for (const [table, cols] of Object.entries(expected)) {
    const { error } = await db().from(table).select(cols).limit(0);
    check(
      `table ${table} has all ${cols.split(',').length} columns`,
      !error,
      error ? `${error.code} ${error.message}` : undefined,
    );
  }
  try {
    await catalogRepo.search('synth_%');
    check('search_catalog RPC callable (with LIKE escaping)', true);
  } catch (e) {
    check('search_catalog RPC callable (with LIKE escaping)', false, String(e));
  }
  if (results.some((r) => !r.ok)) return;

  const now = Date.now();
  const iso = (ms: number) => new Date(now + ms).toISOString();
  const item = await trackedRepo.create({
    storeProductId: -1,
    productName: '__db_check__',
    optionAxis: 'Check',
    optionId: `dbcheck-${now}`,
    optionLabel: 'db check',
  });
  const run = await runsRepo.create('cli', 'db-check');
  const slot = new Date(Date.UTC(2000, 0, 1) + (now % 1000) * 7_200_000); // unique synthetic past slot
  const createdRunIds = [run.id];
  try {
    const base = {
      run_id: run.id,
      tracked_item_id: item.id,
      started_at: iso(0),
      finished_at: iso(1000),
      duration_ms: 1000,
    };

    // Valid rows go through the repository (the path production uses).
    await attemptsRepo.insert({
      runId: run.id,
      trackedItemId: item.id,
      startedAt: iso(0),
      finishedAt: iso(1000),
      tries: [{ n: 1, startedAt: iso(0), durationMs: 1000, ok: true }],
      outcome: 'success',
      priceMinor: 1699650,
      mrpMinor: 2500000,
      currency: 'INR',
      stockStatus: 'in_stock',
      stockQty: 5,
      stockText: 'Stock: 5 remaining',
    });
    await attemptsRepo.insert({
      runId: run.id,
      trackedItemId: item.id,
      startedAt: iso(0),
      finishedAt: iso(2000),
      tries: [
        { n: 1, startedAt: iso(0), durationMs: 900, ok: false, errorCode: 'CHALLENGE_REJECTED' },
        { n: 2, startedAt: iso(1000), durationMs: 900, ok: false, errorCode: 'PRICE_NOT_RENDERED' },
      ],
      outcome: 'failed',
      errorCode: 'PRICE_NOT_RENDERED',
      errorMessage: 'db check',
    });
    const stored = await attemptsRepo.listForItem(item.id);
    const success = stored.find((a) => a.outcome === 'success');
    check(
      'valid success row stored with exact price',
      success?.price === 16996.5 && success.currency === 'INR',
      JSON.stringify(success?.price),
    );
    const failed = stored.find((a) => a.outcome === 'failed');
    check(
      'valid failed row stored with empty price/stock',
      !!failed && failed.price === null && failed.stockStatus === null && failed.tryCount === 2,
    );

    // Dishonest rows are inserted raw (bypassing the repo) to prove the DATABASE refuses them.
    await expectRejected(
      'reject: failed attempt WITH a price',
      { ...base, outcome: 'failed', try_count: 1, error_code: 'X', price: '10.00' },
      PG.checkViolation,
      'failed_has_no_data',
    );
    await expectRejected(
      'reject: success WITHOUT a price',
      { ...base, outcome: 'success', try_count: 1, currency: 'INR', stock_status: 'in_stock' },
      PG.checkViolation,
      'success_has_data',
    );
    await expectRejected(
      'reject: success with price 0',
      { ...base, outcome: 'success', try_count: 1, price: '0.00', currency: 'INR', stock_status: 'in_stock' },
      PG.checkViolation,
      'success_has_data',
    );
    await expectRejected(
      'reject: "success" after 2 tries',
      { ...base, outcome: 'success', try_count: 2, price: '1.00', currency: 'INR', stock_status: 'in_stock' },
      PG.checkViolation,
      'success_first_try',
    );
    await expectRejected(
      'reject: "retried" after 1 try',
      { ...base, outcome: 'retried', try_count: 1, price: '1.00', currency: 'INR', stock_status: 'in_stock' },
      PG.checkViolation,
      'retried_multi_try',
    );
    await expectRejected(
      'reject: failed without error code',
      { ...base, outcome: 'failed', try_count: 1 },
      PG.checkViolation,
      'failed_has_error',
    );
    await expectRejected(
      'reject: finished before started',
      { ...base, finished_at: iso(-5000), outcome: 'failed', try_count: 1, error_code: 'X' },
      PG.checkViolation,
      'finished_after_start',
    );

    // Cron idempotency: a second run for the same slot must be refused.
    const first = await runsRepo.createCronRun(slot, 'db-check');
    if (first) createdRunIds.push(first.id);
    const second = await runsRepo.createCronRun(slot, 'db-check');
    if (second) createdRunIds.push(second.id);
    check('cron slot idempotency (second run for same slot refused)', !!first && second === null);

    // Duplicate tracking must be refused.
    const dup = await db().from('tracked_items').insert({
      store_product_id: -1,
      product_name: 'x',
      option_axis: 'x',
      option_id: item.optionId,
      option_label: 'x',
    });
    check(
      'reject: tracking the same product+option twice',
      dup.error?.code === PG.uniqueViolation,
      dup.error?.message ?? 'ACCEPTED',
    );
  } finally {
    // Clean up synthetic rows only.
    await db().from('scrape_attempts').delete().eq('tracked_item_id', item.id);
    await db().from('scrape_runs').delete().in('id', createdRunIds);
    await db().from('tracked_items').delete().eq('store_product_id', -1);
  }
}

main()
  .catch((e) => check('unexpected error', false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    for (const r of results)
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n      ${r.detail}`}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  });
