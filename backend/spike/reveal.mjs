// Phase 0 spike: select option, hover price area, click "Check today's price", observe result.
// Usage: node spike/reveal.mjs <productId> <optionLabel> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://demo.inelabteamdev.com';
const id = process.argv[2] ?? '2312';
const optionLabel = process.argv[3] ?? 'Studio bundle';
const headed = process.argv.includes('--headed');
const out = `spike/out/${id}`;
fs.mkdirSync(out, { recursive: true });

const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(6);
const log = (...a) => console.log(ms(), ...a);

const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 80 : 0 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('request', (r) => {
  const u = r.url().replace(BASE, '');
  if (r.resourceType() === 'document' || u.startsWith('/api/') || u.startsWith('/assets/'))
    log(`→ ${r.method()} ${u}${r.postData() ? ` body=${r.postData().slice(0, 300)}` : ''} ${JSON.stringify(r.headers().authorization ?? '')}`);
});
page.on('response', async (r) => {
  const u = r.url().replace(BASE, '');
  if (!u.startsWith('/api/') && r.request().resourceType() !== 'document') return;
  let body = '';
  try { body = (await r.text()).slice(0, 500); } catch {}
  log(`← ${r.status()} ${u} ${u.includes('/items/') ? '(item json)' : body}`);
});
page.on('requestfailed', (r) => log(`✕ FAILED ${r.url().replace(BASE, '')} ${r.failure()?.errorText}`));
page.on('console', (m) => log(`[console.${m.type()}] ${m.text().slice(0, 200)}`));

await page.goto(`${BASE}/item/${id}`, { waitUntil: 'domcontentloaded' });
log('domcontentloaded');
const chip = page.locator('button.opt-chip', { hasText: optionLabel });
await chip.waitFor({ timeout: 60000 });
log('option chips rendered');
await chip.click();
log(`clicked option "${optionLabel}" aria-pressed=${await chip.getAttribute('aria-pressed')}`);

// Find the price area: the element containing "Price locked" or the manifest priceWrap.
const manifest = JSON.parse(fs.readFileSync(`${out}/manifest.json`, 'utf8'));
log('priceWrap class (from earlier manifest, may be rotated):', manifest.classes.priceWrap);
const priceArea = page.locator('button.ctl-main').locator('xpath=..');
await priceArea.scrollIntoViewIfNeeded();
const box = await priceArea.boundingBox();
log('price area box', box, 'html:', (await priceArea.evaluate((e) => e.outerHTML)).slice(0, 800));

// Human-ish pointer path over the area, then dwell.
for (let i = 0; i < 25; i++) {
  const x = box.x + 10 + ((box.width - 20) * i) / 24;
  const y = box.y + box.height / 2 + Math.sin(i / 3) * Math.min(20, box.height / 3);
  await page.mouse.move(x, y, { steps: 3 });
  await page.waitForTimeout(60);
}
log('after moves:', JSON.stringify(await priceArea.innerText()));
await page.waitForTimeout(2500);
log('after dwell:', JSON.stringify(await priceArea.innerText()));

await page.locator('button.ctl-main').click();
log('clicked reveal');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  const html = await page.evaluate(() => {
    const b = document.querySelector('button.ctl-main')?.parentElement ?? document.querySelector('output')?.closest('section,div');
    return b ? b.outerHTML : '(no area)';
  });
  log(`t+${i + 1}s area:`, html.slice(0, 1500));
}
await page.screenshot({ path: `${out}/revealed.png`, fullPage: false });
fs.writeFileSync(`${out}/revealed.html`, await page.content());
await browser.close();
