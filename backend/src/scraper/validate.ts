import type { StockStatus } from '../db/types.js';
import type { ErrorCode } from './errors.js';
import { cleanText, parsePrice, parseStock } from './normalize.js';

/** Everything read off the page for one option — two reads 800 ms apart plus network evidence. */
export interface RawRead {
  path: string;
  selectedLabels: string[];
  panelReady: boolean;
  pending: boolean;
  priceOpacity: string | null;
  selectorsAgree: boolean;
  priceRaw: string | null;
  priceRawSecond: string | null;
  mrpRaw: string | null;
  stockRaw: string | null;
  stockRawSecond: string | null;
  /** The last quote response observed after the final reveal click. */
  lastQuote: { status: number; opt: string | null; path: string } | null;
}

export interface Target {
  storeProductId: number;
  optionId: string;
  optionLabel: string;
}

export interface ValidRead {
  priceMinor: number;
  mrpMinor: number | null;
  currency: string;
  stockStatus: StockStatus;
  stockQty: number;
  stockText: string;
}

export type Validation = { ok: true; value: ValidRead } | { ok: false; code: ErrorCode; message: string };

const MAX_PRICE_MINOR = 10_000_000 * 100;
const sameLabel = (a: string, b: string) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
const fail = (code: ErrorCode, message: string): Validation => ({ ok: false, code, message });

/** Applies every validation rule (DESIGN_NOTE.md §3). Any doubt → a failure code, never a guess. */
export function validateRead(read: RawRead, target: Target): Validation {
  if (read.path !== `/item/${target.storeProductId}`) {
    return fail('PRODUCT_MISMATCH', `page is ${read.path}, expected /item/${target.storeProductId}`);
  }
  if (read.selectedLabels.length !== 1 || !sameLabel(read.selectedLabels[0]!, target.optionLabel)) {
    return fail(
      'OPTION_MISMATCH',
      `selected ${JSON.stringify(read.selectedLabels)}, expected "${target.optionLabel}"`,
    );
  }
  const q = read.lastQuote;
  if (
    !q ||
    q.status !== 200 ||
    q.opt !== target.optionId ||
    q.path !== `/api/v2/items/${target.storeProductId}/quote`
  ) {
    return fail('QUOTE_MISMATCH', `last quote ${JSON.stringify(q)} does not match option ${target.optionId}`);
  }
  if (!read.panelReady || read.priceRaw === null)
    return fail('PRICE_NOT_RENDERED', 'price panel is not ready');
  if (read.pending || read.priceOpacity !== '1') {
    return fail('PRICE_STALE', `price is refreshing (pending=${read.pending}, opacity=${read.priceOpacity})`);
  }
  if (!read.selectorsAgree)
    return fail('SELECTOR_CONFLICT', 'manifest and structural price selectors disagree');

  const price = parsePrice(read.priceRaw);
  if (!price.ok) return fail(price.code, `cannot parse price ${JSON.stringify(price.detail)}`);
  if (price.minor <= 0 || price.minor >= MAX_PRICE_MINOR) {
    return fail('PRICE_OUT_OF_RANGE', `price ${price.minor / 100} out of range`);
  }
  if (read.priceRawSecond !== read.priceRaw || read.stockRawSecond !== read.stockRaw) {
    return fail(
      'PRICE_UNSTABLE',
      `values changed between reads: ${JSON.stringify([read.priceRaw, read.priceRawSecond, read.stockRaw, read.stockRawSecond])}`,
    );
  }
  if (read.stockRaw === null) return fail('STOCK_UNRECOGNIZED', 'stock element missing');
  const stock = parseStock(read.stockRaw);
  if (!stock.ok) return fail(stock.code, `cannot parse stock ${JSON.stringify(stock.detail)}`);

  let mrpMinor: number | null = null;
  if (read.mrpRaw) {
    const mrp = parsePrice(read.mrpRaw);
    if (mrp.ok && mrp.currency === price.currency) {
      mrpMinor = mrp.minor;
      if (price.minor > mrp.minor) {
        return fail(
          'PRICE_GT_MRP',
          `price ${price.minor / 100} > MRP ${mrp.minor / 100} — likely read the wrong element`,
        );
      }
    }
  }

  return {
    ok: true,
    value: {
      priceMinor: price.minor,
      mrpMinor,
      currency: price.currency,
      stockStatus: stock.status,
      stockQty: stock.qty,
      stockText: stock.text,
    },
  };
}
