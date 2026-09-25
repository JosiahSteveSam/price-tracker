// Spike: quote body, overlays, full offer panel, option switching after reveal, value stability.
// Usage: node spike/reveal2.mjs <productId> "<label1>|<label2>" [--headed]
import { chromium } from 'playwright';
const BASE = 'https://demo.inelabteamdev.com';
const id = process.argv[2] ?? '2312';
const labels = (process.argv[3] ?? 'Studio bundle|Instrument only').split('|');
const t0 = Date.now();
const log = (...a) => console.log(String(Date.now() - t0).padStart(6), ...a);
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('response', async (r) => {
  const u = r.url().replace(BASE, '');
  const post = r.request().method() === 'POST';
  if (u.includes('/quote') || (u.includes('/handshake') && post) || u.includes('manifest') || r.status() >= 400)
    log(`← ${r.status()} ${r.request().method()} ${u} ${(await r.text().catch(() => '')).slice(0, 700)}`);
});
page.on('requestfailed', (r) => log(`✕ ${r.url().replace(BASE, '')} ${r.failure()?.errorText}`));
await page.goto(`${BASE}/item/${id}`, { waitUntil: 'domcontentloaded' });

const priceBtn = () => page.getByRole('button', { name: /check today/i });

async function logOverlays() {
  const html = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('button')].filter((b) => /cookie|close|dismiss|accept|decline|reject/i.test((b.getAttribute('aria-label') ?? '') + b.textContent));
    return hits.map((b) => (b.closest('[role=dialog],aside,section,div')?.outerHTML ?? '').slice(0, 1200)).join('\n---\n');
  });
  if (html) log('OVERLAY:', html);
}

async function hoverReveal() {
  const btn = priceBtn();
  await btn.waitFor({ timeout: 30000 });
  const box = await btn.locator('xpath=..').boundingBox();
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(box.x + 10 + ((box.width - 20) * i) / 24, box.y + box.height / 2 + Math.sin(i / 3) * 15, { steps: 3 });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(2000);
  log('button disabled?', await btn.isDisabled());
  await btn.click();
}

const panel = () =>
  page.evaluate(() => {
    let el = document.querySelector('output');
    for (let i = 0; i < 3 && el?.parentElement; i++) el = el.parentElement;
    return el ? el.outerHTML : '(none)';
  });

await page.waitForTimeout(1500);
await logOverlays();
for (const [k, label] of labels.entries()) {
  const chip = page.locator('button.opt-chip', { hasText: label });
  await chip.waitFor({ timeout: 30000 });
  await chip.click();
  log(`selected ${label}; locked?`, await priceBtn().count());
  if (await priceBtn().count()) await hoverReveal();
  for (const d of [300, 700, 1500, 3000]) {
    await page.waitForTimeout(d);
    log(`+${d} output text:`, JSON.stringify(await page.locator('output').first().textContent({ timeout: 1000 }).catch(() => null)));
  }
  if (k === 0) log('FULL PANEL:', await panel());
}
await logOverlays();
await browser.close();
