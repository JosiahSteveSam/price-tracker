// Phase 0 spike: prototype of the extraction pipeline for one product/option, with in-page retries.
// Usage: node spike/extract.mjs <productId> <optionId> [--headed] [--json]
import { chromium } from 'playwright';

const BASE = 'https://demo.inelabteamdev.com';
const id = process.argv[2] ?? '2312';
const optionId = process.argv[3] ?? 'o3';
const headed = process.argv.includes('--headed');
const t0 = Date.now();
const events = [];
const log = (...a) => { const line = `${String(Date.now() - t0).padStart(6)} ${a.join(' ')}`; events.push(line); if (!process.argv.includes('--json')) console.log(line); };

const item = await (await fetch(`${BASE}/api/v2/items/${id}`)).json();
const option = item.options.find((o) => o.id === optionId);
log(`target: ${item.name} [${item.optionAxis}: ${option.label}]`);

const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 60 : 0 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('response', async (r) => {
  const u = r.url().replace(BASE, '');
  const m = r.request().method();
  if (u.includes('/quote') || (u.includes('/handshake') && m === 'POST') || r.status() >= 400)
    log(`← ${r.status()} ${m} ${u.split('?')[0]} ${r.status() >= 400 ? (await r.text().catch(() => '')).slice(0, 120) : ''}`);
});

const consent = page.getByRole('dialog', { name: /privacy preferences/i });
await page.addLocatorHandler(consent, async () => {
  log('consent → Reject');
  await consent.getByRole('button', { name: /reject cookies/i }).click();
});

const manifestP = page.waitForResponse((r) => r.url().includes('/api/v2/ui/manifest') && r.status() === 200, { timeout: 30000 });
await page.goto(`${BASE}/item/${id}`, { waitUntil: 'domcontentloaded' });
const manifest = await (await manifestP).json();
const C = manifest.classes;
const wrap = page.locator(`.${C.priceWrap}`).first();
const priceSel = `${manifest.priceTag}.${C.priceValue}`;

const chip = page.locator('button.opt-chip', { hasText: option.label });
await chip.click({ timeout: 30000 });
log('option pressed:', await chip.getAttribute('aria-pressed'));

async function hover() {
  if (await consent.isVisible()) await consent.getByRole('button', { name: /reject cookies/i }).click();
  await wrap.scrollIntoViewIfNeeded();
  const box = await wrap.boundingBox();
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(box.x + 12 + ((box.width - 24) * i) / 23 + Math.random() * 6, box.y + box.height / 2 + Math.sin(i / 2) * Math.min(18, box.height / 3), { steps: 3 });
    await page.waitForTimeout(55 + Math.random() * 40);
  }
  await page.waitForTimeout(2200 + Math.random() * 500);
}

const panelState = () =>
  wrap.evaluate((e) =>
    e.classList.contains('offer-ready') ? 'ready'
      : e.classList.contains('offer-failed') ? 'failed'
      : e.classList.contains('offer-locked') ? 'locked'
      : e.getAttribute('aria-busy') === 'true' ? 'loading' : 'unknown');

let state = 'locked';
for (let attempt = 1; attempt <= 4 && state !== 'ready'; attempt++) {
  await hover();
  const btn = wrap.getByRole('button');
  log(`attempt ${attempt}: state=${await panelState()} button=${JSON.stringify(await btn.textContent())} enabled=${await btn.isEnabled()}`);
  await btn.click({ timeout: 10000 });
  const clickedAt = Date.now();
  for (;;) {
    await page.waitForTimeout(400);
    state = await panelState();
    const waited = Date.now() - clickedAt;
    if (state === 'ready' || state === 'failed') break;
    if (state === 'locked' && waited > 4000) break; // click didn't take
    if (waited > 25000) break;
  }
  log(`attempt ${attempt} → ${state}: ${JSON.stringify((await wrap.innerText()).slice(0, 140))}`);
}

let result = { id, optionId, ok: false, finalState: state };
if (state === 'ready') {
  const read = () =>
    page.evaluate(({ C, priceSel }) => {
      const vis = (e) => e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && e.getAttribute('aria-hidden') !== 'true';
      const clean = (s) => s.replace(/[​-‍⁠﻿]/g, '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
      const vt = (el) => {
        if (!el || !vis(el)) return null;
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let s = '';
        for (let n = w.nextNode(); n; n = w.nextNode()) if (vis(n.parentElement)) s += n.nodeValue;
        return clean(s);
      };
      const all = (sel) => [...document.querySelectorAll(sel)].map(vt).filter(Boolean);
      return {
        price: vt(document.querySelector(priceSel)),
        mrp: all(`.${C.mrp}`), sale: all(`.${C.sale}`), badge: all(`.${C.badge}`),
        stock: all(`.${C.stock}`), seller: all(`.${C.seller}`), delivery: all(`.${C.delivery}`), rating: all(`.${C.rating}`),
        ratingAria: document.querySelector(`.${C.rating}`)?.getAttribute('aria-label') ?? null,
        facts: document.querySelector('.offer-facts')?.outerHTML.slice(0, 1500),
        selected: [...document.querySelectorAll('button.opt-chip[aria-pressed=true]')].map((b) => b.textContent.trim()),
        outputs: document.querySelectorAll('output').length,
      };
    }, { C, priceSel });
  const a = await read();
  await page.waitForTimeout(700);
  const b = await read();
  result = {
    id, optionId, label: option.label, ok: true,
    stable: a.price === b.price && a.stock.join() === b.stock.join(),
    manifest: { variant: manifest.variant, priceTag: manifest.priceTag, carrier: manifest.priceCarrier, order: manifest.order },
    ...a,
  };
}
result.ms = Date.now() - t0;
result.events = events;
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else console.log(JSON.stringify({ ...result, events: undefined }, null, 1));
await browser.close();
