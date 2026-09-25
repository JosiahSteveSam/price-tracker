import { config } from '../config.js';
import type { Outcome, TryLog } from '../db/types.js';
import type { BrowserManager } from './browser.js';
import { ScrapeError, toScrapeError } from './errors.js';
import { manifestSignature } from './manifest.js';
import {
  scrapeProductPage,
  type OptionTarget,
  type PageOptions,
  type PageTarget,
  type PageTryResult,
} from './productPage.js';
import { backoffMs, sleep, withTimeout } from './retry.js';
import { storeApi } from './storeApi.js';
import type { ValidRead } from './validate.js';

// Scrapes every tracked option of ONE product: up to MAX_TRIES fresh page loads, each covering only the
// options still unresolved. Produces exactly one result per option — docs/07 §Pipeline, §Error codes.

export interface GroupItem extends OptionTarget {
  /** tracked_items.id (absent for ad-hoc dry runs). */
  id?: string;
}

export interface AttemptResult {
  item: GroupItem;
  startedAt: string;
  finishedAt: string;
  outcome: Outcome;
  tries: TryLog[];
  value?: ValidRead;
  error?: ScrapeError;
  /** Last error seen before a `retried` success (kept for the scrape log). */
  lastError?: ScrapeError;
  pageSignature: string | null;
  productName?: string;
}

export type ReadPage = (
  browser: BrowserManager,
  target: PageTarget,
  opts: PageOptions,
) => Promise<PageTryResult>;

export async function scrapeGroup(
  browser: BrowserManager,
  storeProductId: number,
  items: GroupItem[],
  opts: PageOptions,
  { readPage = scrapeProductPage as ReadPage, maxTries = config.SCRAPE_MAX_TRIES, backoff = backoffMs } = {},
): Promise<AttemptResult[]> {
  const startedAt = new Date().toISOString();
  const tries = new Map<GroupItem, TryLog[]>(items.map((i) => [i, []]));
  const done = new Map<GroupItem, AttemptResult>();
  const lastError = new Map<GroupItem, ScrapeError>();
  let signature: string | null = null;

  // Resolve current option labels by option id (the stable key) via the open API — one cheap HTTP call.
  let productName: string | undefined;
  const pending: GroupItem[] = [];
  try {
    const product = await storeApi.getItem(storeProductId);
    productName = product.name;
    for (const item of items) {
      const opt = product.options.find((o) => o.id === item.optionId);
      if (!opt) {
        finish(
          item,
          'failed',
          new ScrapeError('OPTION_NOT_FOUND', `option ${item.optionId} no longer offered`),
        );
      } else {
        if (opt.label !== item.optionLabel)
          opts.log('option label changed on store', { from: item.optionLabel, to: opt.label });
        pending.push({ ...item, optionLabel: opt.label });
      }
    }
  } catch (err) {
    const e = toScrapeError(err);
    if (!e.retryable) {
      items.forEach((item) => finish(item, 'failed', e));
      return items.map((i) => done.get(i)!);
    }
    opts.log('item API unavailable, using stored option labels', { code: e.code });
    pending.push(...items);
  }

  // Map resolved (possibly relabelled) targets back to the caller's items.
  const original = new Map<GroupItem, GroupItem>(
    pending.map((p) => [p, items.find((i) => i.optionId === p.optionId)!]),
  );

  for (let n = 1; n <= maxTries; n++) {
    const todo = pending.filter((p) => !done.has(original.get(p)!));
    if (!todo.length) break;
    if (n > 1) {
      const wait = backoff(n, lastError.get(original.get(todo[0]!)!)?.code);
      opts.log('retrying with a fresh page', { try: n, waitMs: wait, options: todo.map((t) => t.optionId) });
      await sleep(wait);
    }
    const tryStart = Date.now();
    const budget = 45_000 + todo.length * config.SCRAPE_TRY_TIMEOUT_MS;
    let page: PageTryResult | null = null;
    let pageError: ScrapeError | null = null;
    try {
      page = await withTimeout(
        readPage(browser, { storeProductId, options: todo }, opts),
        budget,
        'TRY_TIMEOUT',
        () => void browser.close(), // kills the stuck page; the manager relaunches on next use
      );
      signature = manifestSignature(page.manifest).signature;
    } catch (err) {
      pageError = toScrapeError(err);
      opts.log('page load failed', { try: n, code: pageError.code, message: pageError.message });
    }

    for (const target of todo) {
      const item = original.get(target)!;
      const r = page?.results.find((x) => x.optionId === target.optionId);
      const log: TryLog = {
        n,
        startedAt: new Date(tryStart).toISOString(),
        durationMs: Date.now() - tryStart,
        ok: !!r?.ok,
        ...(r?.diag ?? {}),
        consentClicks: page?.consentClicks ?? 0,
        manifestVariant: page?.manifest?.variant ?? null,
      };
      if (r?.ok) {
        tries.get(item)!.push(log);
        finish(item, n === 1 ? 'success' : 'retried', undefined, r.value);
        continue;
      }
      const error =
        r && !r.ok
          ? r.error
          : (pageError ?? new ScrapeError('UNKNOWN', 'option was not attempted on this page load'));
      tries.get(item)!.push({ ...log, errorCode: error.code, message: error.message });
      lastError.set(item, error);
      if (!error.retryable) finish(item, 'failed', error);
    }
  }

  for (const item of items) {
    if (!done.has(item))
      finish(item, 'failed', lastError.get(item) ?? new ScrapeError('UNKNOWN', 'no tries recorded'));
  }
  return items.map((i) => done.get(i)!);

  function finish(item: GroupItem, outcome: Outcome, error?: ScrapeError, value?: ValidRead) {
    const t = tries.get(item)!;
    if (t.length === 0) {
      // Failed before any page load (e.g. option removed): still one honest try entry.
      t.push({ n: 1, startedAt, durationMs: 0, ok: false, errorCode: error?.code, message: error?.message });
    }
    done.set(item, {
      item,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome,
      tries: t,
      value,
      error: outcome === 'failed' ? error : undefined,
      lastError: outcome === 'retried' ? lastError.get(item) : undefined,
      pageSignature: signature,
      productName,
    });
  }
}
