// Experiment: handshake success rate by hover strategy. Usage: node spike/handshake-exp.mjs <A|B> [n]
import { chromium } from 'playwright';
const strategy = process.argv[2] ?? 'A';
const N = Number(process.argv[3] ?? 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const hs = [];
page.on('response', (r) => { if (r.url().endsWith('/api/v2/handshake') && r.request().method() === 'POST') hs.push(r.status()); });
const consent = page.getByRole('dialog', { name: /privacy preferences/i });
const dismiss = async () => { for (let i = 0; i < 6 && (await consent.isVisible()); i++) { await consent.getByRole('button', { name: /reject/i }).click().catch(() => {}); await sleep(150); } };
await page.addLocatorHandler(consent, dismiss, { noWaitAfter: true });
await page.goto('https://demo.inelabteamdev.com/item/2155', { waitUntil: 'domcontentloaded' });
await page.locator('button.opt-chip', { hasText: '3-pack' }).click();
const panel = page.locator('.offer-panel').first();

for (let i = 0; i < N; i++) {
  await dismiss();
  await panel.scrollIntoViewIfNeeded();
  const box = await panel.boundingBox();
  const btn = panel.getByRole('button').last();
  const bb = await btn.boundingBox();
  const before = hs.length;
  if (strategy === 'A') {
    for (let k = 0; k < 24; k++) { await page.mouse.move(box.x + 12 + ((box.width - 24) * k) / 23, box.y + box.height / 2 + Math.sin(k / 2) * 15, { steps: 3 }); await sleep(60); }
    await sleep(2500);
    await btn.click();
  } else {
    // wander, then glide onto the button and click shortly after arriving
    for (let k = 0; k < 14; k++) { await page.mouse.move(box.x + 20 + Math.random() * (box.width - 40), box.y + 10 + Math.random() * (box.height - 20), { steps: 4 }); await sleep(50 + Math.random() * 60); }
    const tx = bb.x + bb.width * (0.3 + Math.random() * 0.4), ty = bb.y + bb.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(tx, ty, { steps: 12 });
    await sleep(150 + Math.random() * 250);
    await page.mouse.down(); await sleep(60 + Math.random() * 60); await page.mouse.up();
  }
  const t = Date.now();
  while (hs.length === before && Date.now() - t < 6000) await sleep(100);
  await sleep(1200);
  const state = await panel.evaluate((e) => e.className);
  console.log(`${strategy} #${i + 1}: handshake=${hs.slice(before).join(',') || 'none'} panel=${state.replace(/\s+\S+-j2$/, '')}`);
}
const ok = hs.filter((s) => s === 200).length;
console.log(`${strategy}: ${ok}/${hs.length} handshakes OK`);
await browser.close();
