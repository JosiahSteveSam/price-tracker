import { chromium } from 'playwright';
const t0 = Date.now(); const log = (...a) => console.log(String(Date.now() - t0).padStart(6), ...a);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('https://demo.inelabteamdev.com/item/' + (process.argv[2] ?? '2312'), { waitUntil: 'domcontentloaded' });
const dlg = page.getByRole('dialog', { name: /privacy preferences/i });
try { await dlg.waitFor({ timeout: 15000 }); } catch { log('no dialog'); process.exit(0); }
const dump = async (tag) => log(tag, (await page.evaluate(() => document.querySelector('.consent-scrim')?.outerHTML ?? '(gone)')).slice(0, 1500));
await dump('before');
await dlg.getByRole('button', { name: /reject/i }).click();
for (const d of [100, 400, 1000, 2000]) { await page.waitForTimeout(d); await dump(`after reject +${d}`); }
await browser.close();
