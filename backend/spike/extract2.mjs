// Phase 0 spike v2: extraction prototype incorporating all recon findings.
// Usage: node spike/extract2.mjs <productId> <optionId> [--headed] [--json]
import { chromium } from 'playwright';
import { parsePrice, parseStock, cleanText } from './normalize.mjs';

const BASE = 'https://demo.inelabteamdev.com';
const [id, optionId] = [process.argv[2] ?? '2312', process.argv[3] ?? 'o3'];
const headed = process.argv.includes('--headed');
const t0 = Date.now();
const events = [];
const log = (...a) => { const l = `${String(Date.now() - t0).padStart(6)} ${a.join(' ')}`; events.push(l); if (!process.argv.includes('--json')) console.log(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const item = await (await fetch(`${BASE}/api/v2/items/${id}`)).json();
const option = item.options.find((o) => o.id === optionId);
log(`target ${id}/${optionId}: ${item.name} [${item.optionAxis}: ${option.label}]`);

const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 40 : 0 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const quotes = []; // every quote response seen, in order
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (u.pathname.endsWith('/quote')) { quotes.push({ status: r.status(), opt: u.searchParams.get('opt'), path: u.pathname, at: Date.now() - t0 }); log(`← quote ${r.status()} opt=${u.searchParams.get('opt')}`); }
  else if (u.pathname.startsWith('/api/') && r.status() >= 400) log(`← ${r.status()} ${r.request().method()} ${u.pathname}`);
});

// Consent: 75% of loads, 1.5–5 s delay, needs 1–3 clicks.
const consent = page.getByRole('dialog', { name: /privacy preferences/i });
async function dismissConsent() {
  for (let i = 0; i < 6 && (await consent.isVisible()); i++) {
    await consent.getByRole('button', { name: /reject cookies/i }).click({ timeout: 3000 }).catch(() => {});
    await sleep(150);
  }
}
await page.addLocatorHandler(consent, async () => { log('consent → Reject (handler)'); await dismissConsent(); }, { noWaitAfter: true });

let manifest = null;
page.on('response', async (r) => { if (r.url().endsWith('/api/v2/ui/manifest') && r.ok()) manifest = await r.json().catch(() => null); });
await page.goto(`${BASE}/item/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

const chip = page.locator('button.opt-chip', { hasText: new RegExp(`^\\s*${option.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
await chip.waitFor({ timeout: 30000 });
log('manifest', manifest ? `variant=${manifest.variant} tag=${manifest.priceTag} carrier=${manifest.priceCarrier}` : 'MISSING (structural fallback)');
await chip.click();
if ((await chip.getAttribute('aria-pressed')) !== 'true') throw new Error('OPTION_NOT_SELECTED');

const panel = page.locator('.offer-panel').first();
const panelState = async () => {
  const s = await panel.evaluate((e) => ({
    cls: e.className, busy: e.getAttribute('aria-busy'),
    pending: /refreshing prices/i.test(e.textContent), btn: e.querySelector('button')?.textContent.trim() ?? null,
  })).catch(() => null);
  if (!s) return { state: 'absent' };
  const state = s.cls.includes('offer-ready') ? (s.pending ? 'pending' : 'ready') : s.cls.includes('offer-failed') ? 'failed' : s.cls.includes('offer-locked') ? 'locked' : s.busy === 'true' ? 'loading' : 'unknown';
  return { state, btn: s.btn };
};

async function hover() {
  await dismissConsent();
  await panel.scrollIntoViewIfNeeded();
  const box = await panel.boundingBox();
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(box.x + 12 + ((box.width - 24) * i) / 23 + Math.random() * 6, box.y + box.height / 2 + Math.sin(i / 2) * Math.min(18, box.height / 3), { steps: 3 });
    await sleep(55 + Math.random() * 40);
  }
  await sleep(2200 + Math.random() * 500);
}

// Network-driven state machine: a click only "took" if a handshake GET follows; the result is only
// trusted once a handshake/quote *response* arrived after that click and the panel is terminal.
let hsStarted = 0;
let lastOutcomeAt = 0;
page.on('request', (r) => { if (r.url().endsWith('/api/v2/handshake') && r.method() === 'GET') hsStarted++; });
page.on('response', (r) => {
  const p = new URL(r.url()).pathname;
  if (p.endsWith('/quote') || (p.endsWith('/handshake') && r.request().method() === 'POST' && !r.ok())) lastOutcomeAt = Date.now();
});

let st = await panelState();
let rounds = 0;
while (st.state !== 'ready' && rounds < 6) {
  rounds++;
  await hover();
  st = await panelState();
  if (st.state === 'ready') break;
  const label = st.state === 'locked' ? /check today/i : st.state === 'failed' ? /^retry$/i : /check again/i;
  log(`round ${rounds}: ${st.state} → click ${label}`);
  const hsBefore = hsStarted;
  const clickedAt = Date.now();
  await panel.getByRole('button', { name: label }).click({ timeout: 8000 }).catch((e) => log('click failed:', e.message.split('\n')[0]));
  while (hsStarted === hsBefore && Date.now() - clickedAt < 3000) await sleep(100);
  if (hsStarted === hsBefore) { log('click ignored by page (no handshake)'); continue; }
  for (;;) {
    await sleep(250);
    st = await panelState();
    if (lastOutcomeAt > clickedAt && Date.now() - lastOutcomeAt > 300 && ['ready', 'pending', 'failed'].includes(st.state)) break;
    if (Date.now() - clickedAt > 25000) { log('timeout waiting for outcome'); st = { state: 'timeout' }; break; }
  }
  log(`round ${rounds} → ${st.state}`);
}

const result = { id, optionId, label: option.label, ok: false, rounds, state: st.state, manifest: manifest && { variant: manifest.variant, priceTag: manifest.priceTag, carrier: manifest.priceCarrier } };
if (st.state === 'ready') {
  const read = () => page.evaluate((cls) => {
    const vis = (e) => !!e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !e.closest('[aria-hidden="true"]');
    const text = (el) => { if (!vis(el)) return null; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let s = ''; for (let n = w.nextNode(); n; n = w.nextNode()) if (vis(n.parentElement)) s += n.nodeValue; return s; };
    const row = document.querySelector('.offer-panel.offer-ready .offer-row');
    const byManifest = cls?.priceValue ? row?.querySelector(`.${cls.priceValue}`) : null;
    const byStructure = [...(row?.children ?? [])].find((c) => c.style.fontSize === '2.4rem');
    const priceEl = byManifest ?? byStructure;
    const stockEl = document.querySelector('.offer-panel.offer-ready .offer-facts .avail-pill');
    const mrpEl = [...(row?.children ?? [])].find((c) => c.style.textDecoration.includes('line-through'));
    return {
      priceRaw: text(priceEl), priceOpacity: priceEl ? getComputedStyle(priceEl).opacity : null,
      sameNode: !cls?.priceValue || byManifest === byStructure,
      mrpRaw: text(mrpEl), stockRaw: text(stockEl),
      selected: [...document.querySelectorAll('button.opt-chip[aria-pressed="true"]')].map((b) => b.textContent.trim()),
      pending: /refreshing prices/i.test(row?.textContent ?? ''),
      rating: document.querySelector('.offer-facts [aria-label^="Rated"]')?.getAttribute('aria-label') ?? null,
      path: location.pathname,
    };
  }, manifest?.classes ?? null);
  const a = await read();
  await sleep(800);
  const b = await read();
  const price = parsePrice(a.priceRaw ?? '');
  const mrp = a.mrpRaw ? parsePrice(a.mrpRaw) : null;
  const stock = parseStock(a.stockRaw ?? '');
  const lastQuote = quotes.at(-1);
  const checks = {
    stable: a.priceRaw === b.priceRaw && a.stockRaw === b.stockRaw,
    opaque: a.priceOpacity === '1', notPending: !a.pending,
    selectorsAgree: a.sameNode,
    optionSelected: a.selected.length === 1 && a.selected[0] === option.label,
    quoteMatches: lastQuote?.status === 200 && lastQuote.opt === optionId && lastQuote.path === `/api/v2/items/${id}/quote`,
    urlMatches: a.path === `/item/${id}`,
    priceParsed: price.ok, stockParsed: stock.ok,
    priceLeMrp: !mrp?.ok || !price.ok || price.minor <= mrp.minor,
  };
  Object.assign(result, {
    ok: Object.values(checks).every(Boolean), checks,
    price: price.ok ? price.minor / 100 : null, currency: price.currency, mrp: mrp?.ok ? mrp.minor / 100 : null,
    stock: stock.ok ? { status: stock.status, qty: stock.qty } : null,
    raw: { price: cleanText(a.priceRaw ?? ''), stock: a.stockRaw, mrp: a.mrpRaw }, rating: a.rating,
  });
}
result.ms = Date.now() - t0;
result.events = events;
console.log(process.argv.includes('--json') ? JSON.stringify(result) : JSON.stringify({ ...result, events: undefined }, null, 1));
await browser.close();
