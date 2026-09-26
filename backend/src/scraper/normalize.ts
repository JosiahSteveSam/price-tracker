import type { StockStatus } from '../db/types.js';
import type { ErrorCode } from './errors.js';

// Parses every price/stock format the store renders (DESIGN_NOTE.md §1).
// Prices are returned in integer minor units (paise) so no float ever touches money.

export type Parsed<T> = ({ ok: true } & T) | { ok: false; code: ErrorCode; detail: string };

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const ODD_SPACES = /[\u00A0\u202F\u2007\u2009]/g;
const FULLWIDTH_DIGIT = /[\uFF10-\uFF19]/g;

export function cleanText(s: string): string {
  return s
    .replace(ZERO_WIDTH, '')
    .replace(ODD_SPACES, ' ')
    .replace(FULLWIDTH_DIGIT, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, ' ')
    .trim();
}

const CURRENCY_PREFIXES: [RegExp, string][] = [
  [/^(₹|Rs\.?|INR)/i, 'INR'],
  [/^(US\$|\$|USD)/i, 'USD'],
  [/^(€|EUR)/i, 'EUR'],
  [/^(£|GBP)/i, 'GBP'],
];

export function parsePrice(raw: string): Parsed<{ minor: number; currency: string }> {
  let s = cleanText(raw)
    .replace(/\/-\s*\(incl\. of all taxes\)$/i, '')
    .trim();
  // "nbsp" format separates every character: "₹ 9 2 , 4 1 6".
  const tokens = s.split(' ');
  if (tokens.length > 2 && tokens.every((t) => t.length === 1)) s = tokens.join('');

  let currency: string | null = null;
  for (const [re, code] of CURRENCY_PREFIXES) {
    const m = s.match(re);
    if (m) {
      currency = code;
      s = s.slice(m[0].length).trim();
      break;
    }
  }
  if (!currency) return { ok: false, code: 'CURRENCY_UNKNOWN', detail: raw };
  if (!/^\d[\d.,\s]*$/.test(s)) return { ok: false, code: 'PRICE_PARSE_ERROR', detail: raw };

  // Decimal separator = the last '.' or ',' followed by exactly two digits at the end; others group.
  let intPart = s;
  let frac = '00';
  const dec = s.match(/^(.*\d)[.,](\d{2})$/);
  if (dec) {
    intPart = dec[1]!;
    frac = dec[2]!;
  }
  const groups = intPart.split(/[.,\s]/);
  const last = groups[groups.length - 1]!;
  const validGrouping =
    groups.length === 1
      ? /^\d+$/.test(groups[0]!)
      : /^\d{1,3}$/.test(groups[0]!) &&
        last.length === 3 &&
        groups.slice(1, -1).every((g) => /^\d{2,3}$/.test(g)) &&
        /^\d{3}$/.test(last);
  if (!validGrouping) return { ok: false, code: 'PRICE_PARSE_ERROR', detail: raw };

  const minor = Number(groups.join('')) * 100 + Number(frac);
  if (!Number.isSafeInteger(minor)) return { ok: false, code: 'PRICE_PARSE_ERROR', detail: raw };
  return { ok: true, minor, currency };
}

// The store picks the stock wording by `qty % 5`, so the wording carries no meaning — status comes from qty.
const STOCK_PATTERNS: RegExp[] = [
  /^last few: (\d+)$/i,
  /^(\d+) units available$/i,
  /^available \((\d+)\)$/i,
  /^stock: (\d+) remaining$/i,
  /^ready to ship · (\d+) available$/i,
];

export function parseStock(raw: string): Parsed<{ status: StockStatus; qty: number; text: string }> {
  const text = cleanText(raw);
  if (/^sold out$/i.test(text)) return { ok: true, status: 'out_of_stock', qty: 0, text };
  for (const re of STOCK_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const qty = Number(m[1]);
      return { ok: true, status: qty > 0 ? 'in_stock' : 'out_of_stock', qty, text };
    }
  }
  return { ok: false, code: 'STOCK_UNRECOGNIZED', detail: raw };
}
