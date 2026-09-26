import { describe, expect, it } from 'vitest';
import { alertsFor } from '../src/services/alertService.js';

const item = { productName: 'Veloria E-Reader Duo', optionLabel: '128 GB' };
const valid = (
  price: number,
  stockStatus: 'in_stock' | 'out_of_stock' = 'in_stock',
  stockQty: number | null = 5,
) => ({
  outcome: 'success' as const,
  price,
  currency: 'INR',
  stockStatus,
  stockQty,
  errorCode: null,
  errorMessage: null,
});
const prev = (price: number, stockStatus: 'in_stock' | 'out_of_stock' = 'in_stock') => ({
  price,
  stockStatus,
  finishedAt: '2026-09-26T00:00:00Z',
});

describe('alertsFor', () => {
  it('no alert on the first valid reading', () => {
    expect(alertsFor(item, valid(100), null)).toEqual([]);
  });

  it('price drop vs the previous VALID reading', () => {
    const [a] = alertsFor(item, valid(33137), prev(36733));
    expect(a).toMatchObject({ type: 'price_drop', payload: { from: 36733, to: 33137, pct: 9.8 } });
    expect(a!.message).toContain('dropped 9.8%');
  });

  it('no alert on a price increase or no change', () => {
    expect(alertsFor(item, valid(37000), prev(36733))).toEqual([]);
    expect(alertsFor(item, valid(36733), prev(36733))).toEqual([]);
  });

  it('back in stock after an out-of-stock reading', () => {
    const alerts = alertsFor(item, valid(36733, 'in_stock', 68), prev(33407, 'out_of_stock'));
    expect(alerts.map((a) => a.type)).toEqual(['back_in_stock']);
    expect(alerts[0]!.message).toContain('68 available');
  });

  it('can raise both at once', () => {
    expect(alertsFor(item, valid(30000, 'in_stock'), prev(33407, 'out_of_stock')).map((a) => a.type)).toEqual(
      ['price_drop', 'back_in_stock'],
    );
  });

  it('failed attempts never produce price/stock alerts — only structure alerts for layout-type errors', () => {
    const failed = (code: string) => ({
      ...valid(0),
      outcome: 'failed' as const,
      price: null,
      errorCode: code,
    });
    expect(alertsFor(item, failed('CHALLENGE_REJECTED'), prev(1))).toEqual([]);
    expect(alertsFor(item, failed('RUN_INTERRUPTED'), prev(1))).toEqual([]);
    expect(alertsFor(item, failed('SELECTOR_CONFLICT'), prev(1))).toMatchObject([
      { type: 'structure_change', payload: { errorCode: 'SELECTOR_CONFLICT' } },
    ]);
  });
});
