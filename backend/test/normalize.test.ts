import { describe, expect, it } from 'vitest';
import { cleanText, parsePrice, parseStock } from '../src/scraper/normalize.js';

const ZW = '\u200B';
const NB = '\u00A0';

describe('parsePrice — every format the store renders (docs/07 §Price formats)', () => {
  const cases: [string, string, number][] = [
    ['default', '₹92,416', 9241600],
    ['default, lakh grouping', '₹1,02,657', 10265700],
    ['crore grouping', '₹1,00,00,000', 1000000000],
    ['spaced', '₹92 416', 9241600],
    ['spaced lakh', '₹1 02 657', 10265700],
    ['euro', '₹92.416,00', 9241600],
    ['euro lakh', '₹1.02.657,00', 10265700],
    ['trailing', '₹92,416/- (incl. of all taxes)', 9241600],
    ['unicode full-width digits', '₹９２,４１６', 9241600],
    ['nbsp per character', ['₹', '9', '2', ',', '4', '1', '6'].join(NB + ZW), 9241600],
    ['lakh with Rs. prefix', `Rs.${NB}92,416.00`, 9241600],
    ['split carrier (ZWSP after each char)', `₹${ZW}9${ZW}2${ZW},${ZW}4${ZW}1${ZW}6`, 9241600],
    ['small, no grouping', '₹999', 99900],
    ['paise', 'Rs. 1,299.50', 129950],
  ];
  it.each(cases)('%s: %j', (_name, raw, minor) => {
    expect(parsePrice(raw)).toEqual({ ok: true, minor, currency: 'INR' });
  });

  it('detects other currencies', () => {
    expect(parsePrice('$1,299')).toMatchObject({ ok: true, currency: 'USD', minor: 129900 });
    expect(parsePrice('€12,50')).toMatchObject({ ok: true, currency: 'EUR', minor: 1250 });
  });

  const rejects: [string, string][] = [
    ['Price locked', 'CURRENCY_UNKNOWN'],
    ['92,416', 'CURRENCY_UNKNOWN'],
    ['₹', 'PRICE_PARSE_ERROR'],
    ['₹--', 'PRICE_PARSE_ERROR'],
    ['₹9,24,16,', 'PRICE_PARSE_ERROR'],
    ['₹92,4167', 'PRICE_PARSE_ERROR'],
    ['₹1234,567', 'PRICE_PARSE_ERROR'],
    ['Member price ₹1,17,297', 'CURRENCY_UNKNOWN'],
  ];
  it.each(rejects)('rejects %j with %s', (raw, code) => {
    expect(parsePrice(raw)).toMatchObject({ ok: false, code });
  });
});

describe('parseStock — every template (docs/07 §Stock formats)', () => {
  it.each([
    ['Sold out', 'out_of_stock', 0],
    ['Last few: 3', 'in_stock', 3],
    ['Last few: 76', 'in_stock', 76],
    ['90 units available', 'in_stock', 90],
    ['Available (17)', 'in_stock', 17],
    ['Stock: 143 remaining', 'in_stock', 143],
    ['Ready to ship · 179 available', 'in_stock', 179],
    [`Stock:${NB}0 remaining`, 'out_of_stock', 0],
  ])('%j → %s/%i', (raw, status, qty) => {
    expect(parseStock(raw)).toMatchObject({ ok: true, status, qty });
  });

  it('refuses to guess unknown wording', () => {
    expect(parseStock('Plenty')).toMatchObject({ ok: false, code: 'STOCK_UNRECOGNIZED' });
    expect(parseStock('')).toMatchObject({ ok: false, code: 'STOCK_UNRECOGNIZED' });
  });
});

describe('cleanText', () => {
  it('strips zero-width chars and normalizes odd spaces', () => {
    expect(cleanText(`Seller: Mar${ZW}lowe${NB}&${NB}Co `)).toBe('Seller: Marlowe & Co');
  });
});
