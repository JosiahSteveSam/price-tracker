// Phase 0 spike: observe a product page — network, manifest, DOM around price/options.
// Usage: node spike/recon.mjs <productId> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://demo.inelabteamdev.com';
const id = process.argv[2] ?? '2312';
const headed = process.argv.includes('--headed');
const out = `spike/out/${id}`;
fs.mkdirSync(out, { recursive: true });

const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(6);
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 100 : 0 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on('request', (r) => {
  if (r.url().includes('/api/')) console.log(`${ms()} → ${r.method()} ${r.url().replace(BASE, '')}${r.postData() ? ` body=${r.postData().slice(0, 200)}` : ''}`);
});
page.on('response', async (r) => {
  if (!r.url().includes('/api/')) return;
  let body = '';
  try { body = (await r.text()).slice(0, 400); } catch {}
  console.log(`${ms()} ← ${r.status()} ${r.url().replace(BASE, '')} ${body}`);
  if (r.url().includes('/ui/manifest')) fs.writeFileSync(`${out}/manifest.json`, body);
});
page.on('console', (m) => console.log(`${ms()} [console.${m.type()}] ${m.text().slice(0, 200)}`));

await page.goto(`${BASE}/item/${id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/initial.png`, fullPage: true });
fs.writeFileSync(`${out}/initial.html`, await page.content());

const visible = await page.evaluate(() => document.body.innerText);
console.log('\n===== innerText (escaped) =====\n' + JSON.stringify(visible).slice(0, 3000));

const controls = await page.evaluate(() =>
  [...document.querySelectorAll('button, input, select, [role=radio], [role=option], a[href*="item"], output')].map((e) => ({
    tag: e.tagName, type: e.getAttribute('type'), role: e.getAttribute('role'), cls: e.className, text: e.textContent.trim().slice(0, 60),
    aria: e.getAttribute('aria-pressed') ?? e.getAttribute('aria-checked') ?? e.getAttribute('aria-selected'), href: e.getAttribute('href'),
  })),
);
console.log('\n===== controls =====');
for (const c of controls) console.log(JSON.stringify(c));
console.log('\nURL now:', page.url());
await browser.close();
