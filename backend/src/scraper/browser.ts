import { chromium, type Browser, type BrowserContext } from 'playwright';
import { logger } from '../logger.js';

export interface BrowserOptions {
  headless: boolean;
  slowMo?: number;
}

/**
 * One Chromium per run (512 MB on Render), one context per try. Relaunches if the browser dies.
 * Images/media/fonts are blocked; CSS + JS stay because the page layout drives hover/click targets.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  relaunches = 0;

  constructor(private readonly opts: BrowserOptions) {}

  private async ensure(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.browser) {
      this.relaunches++;
      logger.warn({ relaunches: this.relaunches }, 'browser disconnected — relaunching');
    }
    this.browser = await chromium.launch({
      headless: this.opts.headless,
      slowMo: this.opts.slowMo ?? 0,
      args: ['--disable-dev-shm-usage'],
    });
    return this.browser;
  }

  async newContext(): Promise<BrowserContext> {
    const browser = await this.ensure();
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    });
    // When run via tsx (dev/CLI), esbuild's keepNames wraps functions in `__name(...)`; callbacks we pass to
    // page.evaluate are serialized into the page, where that helper doesn't exist. Provide a no-op.
    await ctx.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((fn) => fn);' });
    await ctx.route('**/*', (route) => {
      const type = route.request().resourceType();
      return type === 'image' || type === 'media' || type === 'font' ? route.abort() : route.continue();
    });
    return ctx;
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}
