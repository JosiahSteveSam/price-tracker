// Spike prototype of normalize.ts — parses every price/stock format found in the store bundle.

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const SPACES = /[    ]/g;
const FULLWIDTH_DIGIT = /[０-９]/g;

export function cleanText(s) {
  return s
    .replace(ZERO_WIDTH, '')
    .replace(SPACES, ' ')
    .replace(FULLWIDTH_DIGIT, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, ' ')
    .trim();
}

const CURRENCIES = [
  [/^(₹|Rs\.?|INR)/i, 'INR'],
  [/^(US\$|\$|USD)/i, 'USD'],
  [/^(€|EUR)/i, 'EUR'],
  [/^(£|GBP)/i, 'GBP'],
];

/** @returns {{ok:true, minor:number, currency:string, format:string} | {ok:false, code:string, detail:string}} */
export function parsePrice(raw) {
  let s = cleanText(raw).replace(/\/-\s*\(incl\. of all taxes\)$/i, '').trim();
  // "nbsp" format puts a (NB)space between every character: "₹ 9 2 , 4 1 6".
  const tokens = s.split(' ');
  if (tokens.length > 2 && tokens.every((t) => t.length === 1)) s = tokens.join('');
  let currency = null;
  for (const [re, code] of CURRENCIES) {
    const m = s.match(re);
    if (m) { currency = code; s = s.slice(m[0].length).trim(); break; }
  }
  if (!currency) return { ok: false, code: 'CURRENCY_UNKNOWN', detail: raw };
  if (!/^\d[\d.,\s]*$/.test(s)) return { ok: false, code: 'PRICE_PARSE_ERROR', detail: raw };

  let intPart = s;
  let frac = '00';
  const dec = s.match(/^(.*\d)[.,](\d{2})$/); // decimal separator = last sep followed by exactly 2 digits
  if (dec) { intPart = dec[1]; frac = dec[2]; }
  const groups = intPart.split(/[.,\s]/);
  const indian = /^\d{1,2}$/.test(groups[0]) || groups.length === 1 || /^\d{3}$/.test(groups[0]);
  const validGrouping =
    groups.length === 1 ? /^\d+$/.test(groups[0])
      : groups.at(-1).length === 3 && groups.slice(1, -1).every((g) => g.length === 2 || g.length === 3) && indian;
  if (!validGrouping) return { ok: false, code: 'PRICE_PARSE_ERROR', detail: raw };
  const minor = Number(groups.join('')) * 100 + Number(frac);
  if (!Number.isSafeInteger(minor)) return { ok: false, code: 'PRICE_PARSE_ERROR', detail: raw };
  return { ok: true, minor, currency };
}

const STOCK_PATTERNS = [
  [/^sold out$/i, () => ({ status: 'out_of_stock', qty: 0 })],
  [/^last few: (\d+)$/i, (m) => ({ status: 'low_stock', qty: +m[1] })],
  [/^(\d+) units available$/i, (m) => ({ status: 'in_stock', qty: +m[1] })],
  [/^available \((\d+)\)$/i, (m) => ({ status: 'in_stock', qty: +m[1] })],
  [/^stock: (\d+) remaining$/i, (m) => ({ status: 'in_stock', qty: +m[1] })],
  [/^ready to ship · (\d+) available$/i, (m) => ({ status: 'in_stock', qty: +m[1] })],
];

export function parseStock(raw) {
  const s = cleanText(raw);
  for (const [re, f] of STOCK_PATTERNS) {
    const m = s.match(re);
    if (m) return { ok: true, text: s, ...f(m) };
  }
  return { ok: false, code: 'STOCK_UNRECOGNIZED', detail: raw };
}

// Self-test: `node spike/normalize.mjs`
if (process.argv[1]?.endsWith('normalize.mjs')) {
  const ZW = '​', NB = ' ';
  const price = {
    '₹92,416': 9241600,
    '₹1,02,657': 10265700,
    '₹92 416': 9241600,
    '₹1 02 657': 10265700,
    '₹92.416,00': 9241600,
    '₹1.02.657,00': 10265700,
    '₹92,416/- (incl. of all taxes)': 9241600,
    '₹９２,４１６': 9241600,
    [['₹', '9', '2', ',', '4', '1', '6'].join(NB + ZW)]: 9241600,
    [`Rs.${NB}92,416.00`]: 9241600,
    [`₹${ZW}9${ZW}2${ZW},${ZW}4${ZW}1${ZW}6`]: 9241600,
    '₹999': 99900,
  };
  const bad = ['Price locked', '₹', '₹--', '92,416', '₹9,24,16,', '₹92,4167'];
  let fail = 0;
  for (const [raw, want] of Object.entries(price)) {
    const r = parsePrice(raw);
    const ok = r.ok && r.minor === want && r.currency === 'INR';
    if (!ok) fail++;
    console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(raw), '→', JSON.stringify(r));
  }
  for (const raw of bad) {
    const r = parsePrice(raw);
    if (r.ok) fail++;
    console.log(!r.ok ? 'ok  ' : 'FAIL', 'reject', JSON.stringify(raw), '→', r.code ?? r.minor);
  }
  for (const s of ['Sold out', 'Last few: 3', '90 units available', 'Available (17)', 'Stock: 143 remaining', 'Ready to ship · 179 available', 'Plenty']) {
    console.log('stock', JSON.stringify(s), '→', JSON.stringify(parseStock(s)));
  }
  console.log(fail ? `${fail} FAILURES` : 'all price cases pass');
  process.exitCode = fail ? 1 : 0;
}
