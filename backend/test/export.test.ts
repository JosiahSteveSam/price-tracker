import { describe, expect, it } from 'vitest';
import type { ScrapeAttempt } from '../src/db/types.js';
import { CSV_COLUMNS, csvField, csvRow, exportFilename } from '../src/services/exportService.js';
import { missedSlots } from '../src/services/runsView.js';
import type { ScrapeRun } from '../src/db/types.js';

const item = {
  storeProductId: 2312,
  productName: 'Brightwell Synthesizer Core',
  optionLabel: 'Studio bundle',
};
const attempt = (patch: Partial<ScrapeAttempt>): ScrapeAttempt => ({
  id: 'a',
  runId: 'r',
  trackedItemId: 't',
  startedAt: '2026-09-26T04:00:01.000Z',
  finishedAt: '2026-09-26T04:00:23.456+00:00',
  outcome: 'success',
  tryCount: 1,
  price: 92416,
  mrp: 142178,
  currency: 'INR',
  stockStatus: 'in_stock',
  stockQty: 143,
  stockText: 'Stock: 143 remaining',
  errorCode: null,
  errorMessage: null,
  tries: [],
  durationMs: 22456,
  pageSignature: null,
  ...patch,
});

describe('CSV export (PRD M8)', () => {
  it('has exactly the required columns in order', () => {
    expect(CSV_COLUMNS.join(',')).toBe('product_id,product_name,option,timestamp,price,stock,outcome');
  });

  it('formats a success row with ISO-8601 UTC timestamp and 2-decimal price', () => {
    expect(csvRow(attempt({}), item)).toBe(
      '2312,Brightwell Synthesizer Core,Studio bundle,2026-09-26T04:00:23.456Z,92416.00,143,success',
    );
  });

  it('leaves price and stock EMPTY on failed rows', () => {
    const row = csvRow(attempt({ outcome: 'failed', price: null, stockQty: null, stockStatus: null }), item);
    expect(row).toBe('2312,Brightwell Synthesizer Core,Studio bundle,2026-09-26T04:00:23.456Z,,,failed');
  });

  it('writes retried rows and sold-out stock as 0', () => {
    expect(csvRow(attempt({ outcome: 'retried', stockQty: 0, stockStatus: 'out_of_stock' }), item)).toMatch(
      /,92416\.00,0,retried$/,
    );
  });

  it('quotes fields per RFC 4180', () => {
    expect(csvField('Marlowe, "Co"')).toBe('"Marlowe, ""Co"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(null)).toBe('');
  });

  it('names the file with a UTC timestamp', () => {
    expect(exportFilename(new Date('2026-09-26T04:05:09Z'))).toBe(
      'pricepulse-scrape-history-20260926-0405Z.csv',
    );
  });
});

describe('missedSlots', () => {
  const run = (slot: string): ScrapeRun => ({ trigger: 'cron', slotKey: slot }) as ScrapeRun;
  it('lists expected 2 h slots with no run, after a 15 min grace', () => {
    const runs = [run('2026-09-26T00:00:00.000Z'), run('2026-09-26T04:00:00.000Z')];
    expect(missedSlots(runs, new Date('2026-09-26T06:10:00Z'))).toEqual(['2026-09-26T02:00:00.000Z']);
    expect(missedSlots(runs, new Date('2026-09-26T06:20:00Z'))).toEqual([
      '2026-09-26T02:00:00.000Z',
      '2026-09-26T06:00:00.000Z',
    ]);
  });
  it('reports nothing before the first cron run', () => {
    expect(missedSlots([], new Date())).toEqual([]);
  });
});
