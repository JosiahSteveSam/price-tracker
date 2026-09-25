import { chromium } from 'playwright';
const t0 = Date.now(); const log = (...a) => console.log(String(Date.now() - t0).padStart(6), ...a);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('https://demo.inelabteamdev.com/item/' + (process.argv[2] ?? '2312'), { waitUntil: 'domcontentloaded' });
let seen = false;
for (let i = 0; i < 40 && !seen; i++) {
  await page.mouse.move(400 + (i % 10) * 50, 300 + (i % 7) * 40, { steps: 4 });
  await page.waitForTimeout(300);
  const html = await page.evaluate(() => {
    const s = document.querySelector('[class*=consent], [class*=cookie], [role=dialog], [aria-modal=true]');
    return s ? (s.closest('.consent-scrim') ?? s).outerHTML : null;
  });
  if (html) { seen = true; log('CONSENT:', html.slice(0, 2500)); }
}
if (!seen) log('no consent overlay in 12s');
await browser.close();
