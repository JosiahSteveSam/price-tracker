import { describe, expect, it } from 'vitest';
import { escapeLike } from '../src/db/catalogRepo.js';
import { fromNewAttempt, toScrapeAttempt } from '../src/db/mappers.js';
import { minorToDecimal } from '../src/db/supabase.js';

const base = {
  runId: 'r1',
  trackedItemId: 't1',
  startedAt: '2026-09-26T00:00:00.000Z',
  finishedAt: '2026-09-26T00:00:12.500Z',
};

describe('minorToDecimal', () => {
  it('formats integer paise exactly', () => {
    expect(minorToDecimal(9241600)).toBe('92416.00');
    expect(minorToDecimal(1699650)).toBe('16996.50');
    expect(minorToDecimal(5)).toBe('0.05');
  });
  it('rejects non-integers and negatives', () => {
    expect(() => minorToDecimal(1.5)).toThrow();
    expect(() => minorToDecimal(-1)).toThrow();
  });
});

describe('fromNewAttempt', () => {
  it('never puts price or stock on a failed attempt', () => {
    const row = fromNewAttempt({
      ...base,
      tries: [
        { n: 1, startedAt: base.startedAt, durationMs: 5000, ok: false },
        { n: 2, startedAt: base.startedAt, durationMs: 5000, ok: false },
      ],
      outcome: 'failed',
      errorCode: 'CHALLENGE_REJECTED',
      errorMessage: 'all rounds rejected',
    });
    expect(row).not.toHaveProperty('price');
    expect(row).not.toHaveProperty('stock_status');
    expect(row).toMatchObject({
      outcome: 'failed',
      try_count: 2,
      duration_ms: 12500,
      error_code: 'CHALLENGE_REJECTED',
    });
  });

  it('maps a retried attempt with exact money', () => {
    const row = fromNewAttempt({
      ...base,
      tries: [
        { n: 1, startedAt: base.startedAt, durationMs: 1, ok: false },
        { n: 2, startedAt: base.startedAt, durationMs: 1, ok: true },
      ],
      outcome: 'retried',
      priceMinor: 9241600,
      mrpMinor: 14217800,
      currency: 'INR',
      stockStatus: 'in_stock',
      stockQty: 143,
      stockText: 'Stock: 143 remaining',
      errorCode: 'CHALLENGE_REJECTED',
    });
    expect(row).toMatchObject({ price: '92416.00', mrp: '142178.00', try_count: 2, stock_qty: 143 });
  });
});

describe('toScrapeAttempt', () => {
  it('parses numeric columns and trims char(3) currency', () => {
    const a = toScrapeAttempt({
      id: 'a',
      run_id: 'r',
      tracked_item_id: 't',
      started_at: 's',
      finished_at: 'f',
      outcome: 'success',
      try_count: 1,
      price: '92416.00',
      mrp: null,
      currency: 'INR',
      stock_status: 'in_stock',
      stock_qty: 3,
      stock_text: 'x',
      error_code: null,
      error_message: null,
      tries: [],
      duration_ms: 10,
      page_signature: null,
    });
    expect(a.price).toBe(92416);
    expect(a.mrp).toBeNull();
    expect(a.currency).toBe('INR');
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
