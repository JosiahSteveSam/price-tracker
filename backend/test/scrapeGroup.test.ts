import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserManager } from '../src/scraper/browser.js';
import { ScrapeError } from '../src/scraper/errors.js';
import type { OptionResult, PageTarget, PageTryResult } from '../src/scraper/productPage.js';
import { scrapeGroup, type ReadPage } from '../src/scraper/scrapeGroup.js';
import { groupByProduct, slotKeyFor, toNewAttempt } from '../src/scraper/runner.js';

const getItem = vi.fn();
vi.mock('../src/scraper/storeApi.js', () => ({ storeApi: { getItem: (id: number) => getItem(id) } }));

const browser = { close: vi.fn(async () => {}) } as unknown as BrowserManager;
const opts = { headed: false, log: () => {} };
const deps = (readPage: ReadPage) => ({ readPage, maxTries: 4, backoff: () => 0 });
const value = {
  priceMinor: 9241600,
  mrpMinor: null,
  currency: 'INR',
  stockStatus: 'in_stock' as const,
  stockQty: 3,
  stockText: 'Available (3)',
};
const diag = {
  rounds: 1,
  clicksIgnored: 0,
  handshakesOk: 1,
  handshakesRejected: 0,
  quoteStatuses: [200],
  lastPanelState: 'ready' as const,
};
const ok = (optionId: string): OptionResult => ({ optionId, ok: true, value, diag });
const bad = (optionId: string, code: ConstructorParameters<typeof ScrapeError>[0]): OptionResult => ({
  optionId,
  ok: false,
  error: new ScrapeError(code, code.toLowerCase()),
  diag,
});

/** Fake page reader: `script[n]` decides each option's result on page load n (1-based). */
function scripted(script: ((t: PageTarget) => OptionResult[] | Error)[]) {
  const calls: PageTarget[] = [];
  const readPage: ReadPage = async (_b, target) => {
    calls.push(target);
    const r = script[calls.length - 1]!(target);
    if (r instanceof Error) throw r;
    return { results: r, manifest: { variant: 4 }, consentClicks: 0 } satisfies PageTryResult;
  };
  return { readPage, calls };
}

beforeEach(() => {
  getItem.mockReset();
  getItem.mockResolvedValue({
    id: 2312,
    name: 'Brightwell Synthesizer Core',
    optionAxis: 'Bundle',
    options: [
      { id: 'o1', label: 'Instrument only' },
      { id: 'o3', label: 'Studio bundle' },
    ],
  });
});

const o3 = { id: 't3', optionId: 'o3', optionLabel: 'Studio bundle' };
const o1 = { id: 't1', optionId: 'o1', optionLabel: 'Instrument only' };

describe('scrapeGroup outcomes', () => {
  it('first page load valid → success with one try', async () => {
    const { readPage } = scripted([() => [ok('o3')]]);
    const [r] = await scrapeGroup(browser, 2312, [o3], opts, deps(readPage));
    expect(r).toMatchObject({ outcome: 'success', value });
    expect(r!.tries).toHaveLength(1);
  });

  it('valid on a later page load → retried, keeps the last error', async () => {
    const { readPage } = scripted([() => [bad('o3', 'CHALLENGE_REJECTED')], () => [ok('o3')]]);
    const [r] = await scrapeGroup(browser, 2312, [o3], opts, deps(readPage));
    expect(r).toMatchObject({ outcome: 'retried', lastError: { code: 'CHALLENGE_REJECTED' } });
    expect(r!.tries.map((t) => t.ok)).toEqual([false, true]);
  });

  it('never valid → failed after MAX_TRIES with no value', async () => {
    const { readPage, calls } = scripted(Array(4).fill(() => [bad('o3', 'PRICE_NOT_RENDERED')]));
    const [r] = await scrapeGroup(browser, 2312, [o3], opts, deps(readPage));
    expect(r).toMatchObject({ outcome: 'failed', error: { code: 'PRICE_NOT_RENDERED' } });
    expect(r!.value).toBeUndefined();
    expect(r!.tries).toHaveLength(4);
    expect(calls).toHaveLength(4);
  });

  it('page-level failure counts as a failed try for every option on it', async () => {
    const { readPage } = scripted([() => new ScrapeError('NAV_TIMEOUT', 'slow'), () => [ok('o3'), ok('o1')]]);
    const results = await scrapeGroup(browser, 2312, [o3, o1], opts, deps(readPage));
    expect(results.map((r) => [r.outcome, r.tries[0]!.errorCode])).toEqual([
      ['retried', 'NAV_TIMEOUT'],
      ['retried', 'NAV_TIMEOUT'],
    ]);
  });

  it('retries only the unresolved options on the next page load', async () => {
    const { readPage, calls } = scripted([() => [ok('o3'), bad('o1', 'PRICE_UNSTABLE')], () => [ok('o1')]]);
    const results = await scrapeGroup(browser, 2312, [o3, o1], opts, deps(readPage));
    expect(results.map((r) => r.outcome)).toEqual(['success', 'retried']);
    expect(calls[1]!.options.map((o) => o.optionId)).toEqual(['o1']);
  });

  it('non-retryable error stops immediately', async () => {
    const { readPage, calls } = scripted([() => [bad('o3', 'OPTION_NOT_FOUND')]]);
    const [r] = await scrapeGroup(browser, 2312, [o3], opts, deps(readPage));
    expect(r).toMatchObject({ outcome: 'failed', error: { code: 'OPTION_NOT_FOUND' } });
    expect(calls).toHaveLength(1);
  });

  it('option removed from the store → failed without opening a page', async () => {
    getItem.mockResolvedValue({
      id: 2312,
      name: 'x',
      optionAxis: 'Bundle',
      options: [{ id: 'o1', label: 'Instrument only' }],
    });
    const { readPage, calls } = scripted([(t) => t.options.map((o) => ok(o.optionId))]);
    const results = await scrapeGroup(browser, 2312, [o3, o1], opts, deps(readPage));
    expect(results.map((r) => [r.outcome, r.error?.code])).toEqual([
      ['failed', 'OPTION_NOT_FOUND'],
      ['success', undefined],
    ]);
    expect(calls[0]!.options.map((o) => o.optionId)).toEqual(['o1']);
  });

  it('product gone (404) → every option failed, no page load', async () => {
    getItem.mockRejectedValue(new ScrapeError('PRODUCT_NOT_FOUND', '404'));
    const { readPage, calls } = scripted([]);
    const results = await scrapeGroup(browser, 2312, [o3, o1], opts, deps(readPage));
    expect(results.every((r) => r.outcome === 'failed' && r.error?.code === 'PRODUCT_NOT_FOUND')).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('uses the store’s current label for an option id', async () => {
    getItem.mockResolvedValue({
      id: 2312,
      name: 'x',
      optionAxis: 'Bundle',
      options: [{ id: 'o3', label: 'Studio bundle (2026)' }],
    });
    const { readPage, calls } = scripted([(t) => t.options.map((o) => ok(o.optionId))]);
    await scrapeGroup(browser, 2312, [o3], opts, deps(readPage));
    expect(calls[0]!.options[0]!.optionLabel).toBe('Studio bundle (2026)');
  });
});

describe('runner helpers', () => {
  it('slotKeyFor floors to the 2 h UTC slot', () => {
    expect(slotKeyFor(new Date('2026-09-26T04:00:30Z')).toISOString()).toBe('2026-09-26T04:00:00.000Z');
    expect(slotKeyFor(new Date('2026-09-26T05:59:59Z')).toISOString()).toBe('2026-09-26T04:00:00.000Z');
    expect(slotKeyFor(new Date('2026-09-26T00:00:00Z')).toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });

  it('toNewAttempt keeps price off failed attempts and carries the last error on retried ones', () => {
    const base = { item: o3, startedAt: 'a', finishedAt: 'b', tries: [], pageSignature: null };
    const failed = toNewAttempt('r', 't', {
      ...base,
      outcome: 'failed',
      error: new ScrapeError('QUOTE_FAILED', 'x'),
    });
    expect(failed).toEqual(expect.objectContaining({ outcome: 'failed', errorCode: 'QUOTE_FAILED' }));
    expect(failed).not.toHaveProperty('priceMinor');
    const retried = toNewAttempt('r', 't', {
      ...base,
      outcome: 'retried',
      value,
      lastError: new ScrapeError('CLICK_IGNORED', 'y'),
    });
    expect(retried).toMatchObject({ outcome: 'retried', priceMinor: 9241600, errorCode: 'CLICK_IGNORED' });
  });

  it('groupByProduct groups options of the same product', () => {
    const mk = (id: string, p: number) =>
      ({ id, storeProductId: p }) as Parameters<typeof groupByProduct>[0][number];
    expect(
      groupByProduct([mk('a', 1), mk('b', 2), mk('c', 1)]).map(([p, g]) => [p, g.map((i) => i.id)]),
    ).toEqual([
      [1, ['a', 'c']],
      [2, ['b']],
    ]);
  });
});
