import { describe, expect, it } from 'vitest';
import { validateRead, type RawRead, type Target } from '../src/scraper/validate.js';

const target: Target = { storeProductId: 2312, optionId: 'o3', optionLabel: 'Studio bundle' };
const good: RawRead = {
  path: '/item/2312',
  selectedLabels: ['Studio bundle'],
  panelReady: true,
  pending: false,
  priceOpacity: '1',
  selectorsAgree: true,
  priceRaw: '₹\u200B9\u200B2\u200B,\u200B4\u200B1\u200B6',
  priceRawSecond: '₹\u200B9\u200B2\u200B,\u200B4\u200B1\u200B6',
  mrpRaw: '₹1,42,178',
  stockRaw: 'Stock: 143 remaining',
  stockRawSecond: 'Stock: 143 remaining',
  lastQuote: { status: 200, opt: 'o3', path: '/api/v2/items/2312/quote' },
};

describe('validateRead', () => {
  it('accepts a clean read', () => {
    expect(validateRead(good, target)).toEqual({
      ok: true,
      value: {
        priceMinor: 9241600,
        mrpMinor: 14217800,
        currency: 'INR',
        stockStatus: 'in_stock',
        stockQty: 143,
        stockText: 'Stock: 143 remaining',
      },
    });
  });

  it('accepts a read without MRP', () => {
    expect(validateRead({ ...good, mrpRaw: null }, target)).toMatchObject({
      ok: true,
      value: { mrpMinor: null },
    });
  });

  const failures: [string, Partial<RawRead>, string][] = [
    ['wrong product page', { path: '/item/9999' }, 'PRODUCT_MISMATCH'],
    ['random default option still selected', { selectedLabels: ['Starter bundle'] }, 'OPTION_MISMATCH'],
    ['no option selected', { selectedLabels: [] }, 'OPTION_MISMATCH'],
    [
      'quote was for another option',
      { lastQuote: { status: 200, opt: 'o2', path: '/api/v2/items/2312/quote' } },
      'QUOTE_MISMATCH',
    ],
    [
      'quote failed',
      { lastQuote: { status: 500, opt: 'o3', path: '/api/v2/items/2312/quote' } },
      'QUOTE_MISMATCH',
    ],
    ['no quote seen', { lastQuote: null }, 'QUOTE_MISMATCH'],
    ['panel not ready', { panelReady: false }, 'PRICE_NOT_RENDERED'],
    ['"Refreshing prices" shown', { pending: true }, 'PRICE_STALE'],
    ['price faded (opacity .45)', { priceOpacity: '0.45' }, 'PRICE_STALE'],
    ['selectors disagree', { selectorsAgree: false }, 'SELECTOR_CONFLICT'],
    ['placeholder text', { priceRaw: 'Price locked', priceRawSecond: 'Price locked' }, 'CURRENCY_UNKNOWN'],
    ['zero price', { priceRaw: '₹0', priceRawSecond: '₹0' }, 'PRICE_OUT_OF_RANGE'],
    ['price changed between reads', { priceRawSecond: '₹92,417' }, 'PRICE_UNSTABLE'],
    ['stock changed between reads', { stockRawSecond: 'Stock: 142 remaining' }, 'PRICE_UNSTABLE'],
    ['unknown stock wording', { stockRaw: 'Plenty', stockRawSecond: 'Plenty' }, 'STOCK_UNRECOGNIZED'],
    ['price above MRP (wrong element)', { mrpRaw: '₹50,000' }, 'PRICE_GT_MRP'],
  ];
  it.each(failures)('rejects: %s', (_name, patch, code) => {
    expect(validateRead({ ...good, ...patch }, target)).toMatchObject({ ok: false, code });
  });
});
