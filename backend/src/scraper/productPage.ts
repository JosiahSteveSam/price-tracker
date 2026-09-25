import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { config } from '../config.js';
import type { BrowserManager } from './browser.js';
import { ScrapeError, toScrapeError, type ErrorCode } from './errors.js';
import type { Manifest } from './manifest.js';
import { sleep } from './retry.js';
import { storeUrl } from './storeApi.js';
import { validateRead, type RawRead, type ValidRead } from './validate.js';

// One "try" = one fresh browser context + page load of /item/:id, reading one or more options of that
// product. Behaviour of the page is documented in docs/07-SCRAPER-SPEC.md §How the product page works.

export interface OptionTarget {
  optionId: string;
  optionLabel: string;
}

export interface PageTarget {
  storeProductId: number;
  options: OptionTarget[];
}

/** Per-option diagnostics stored in scrape_attempts.tries[].details. */
export interface OptionDiagnostics {
  rounds: number;
  clicksIgnored: number;
  handshakesOk: number;
  handshakesRejected: number;
  quoteStatuses: number[];
  lastPanelState: PanelState;
  lastPanelMessage?: string;
  selectorSource?: 'manifest+structure' | 'structure';
}

export type OptionResult =
  | { optionId: string; ok: true; value: ValidRead; diag: OptionDiagnostics }
  | { optionId: string; ok: false; error: ScrapeError; diag: OptionDiagnostics };

export interface PageTryResult {
  results: OptionResult[];
  manifest: Manifest | null;
  consentClicks: number;
}

export interface PageOptions {
  headed: boolean;
  /** Demo only (headed CLI): delay or fail the first quote request. Never combined with persisting. */
  simulate?: 'slow' | 'fail';
  artifactsDir?: string;
  log: (msg: string, data?: Record<string, unknown>) => void;
}

type PanelState = 'locked' | 'loading' | 'ready' | 'pending' | 'failed' | 'absent' | 'unknown' | 'timeout';

const MAX_ROUNDS = 6;
const NAV_TIMEOUT_MS = 45_000;
const RENDER_TIMEOUT_MS = 30_000;
const CLICK_TAKE_MS = 3_000; // page ignores 17.5% of clicks and delays another 17.5% by 900 ms
const OUTCOME_TIMEOUT_MS = 25_000;

/** Network evidence collected from the page's own traffic. */
class PageTraffic {
  handshakesStarted = 0;
  handshakesOk = 0;
  handshakesRejected = 0;
  lastOutcomeAt = 0;
  quotes: { status: number; opt: string | null; path: string; at: number }[] = [];
  manifest: Manifest | null = null;

  attach(page: Page) {
    page.on('request', (req) => {
      if (req.method() === 'GET' && new URL(req.url()).pathname === '/api/v2/handshake')
        this.handshakesStarted++;
    });
    page.on('response', async (res) => {
      const url = new URL(res.url());
      const p = url.pathname;
      if (p.endsWith('/quote')) {
        this.quotes.push({ status: res.status(), opt: url.searchParams.get('opt'), path: p, at: Date.now() });
        this.lastOutcomeAt = Date.now();
      } else if (p === '/api/v2/handshake' && res.request().method() === 'POST') {
        if (res.ok()) this.handshakesOk++;
        else {
          this.handshakesRejected++;
          this.lastOutcomeAt = Date.now();
        }
      } else if (p === '/api/v2/ui/manifest' && res.ok()) {
        this.manifest = (await res.json().catch(() => null)) as Manifest | null;
      }
    });
  }
}

export async function scrapeProductPage(
  browser: BrowserManager,
  target: PageTarget,
  opts: PageOptions,
): Promise<PageTryResult> {
  const ctx: BrowserContext = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const traffic = new PageTraffic();
    traffic.attach(page);
    let consentClicks = 0;

    // Surface the store's failures as they happen (the page silently retries 5xx itself).
    page.on('response', (res) => {
      const u = new URL(res.url());
      if (u.pathname.endsWith('/quote')) {
        opts.log(res.ok() ? 'store: quote ok' : 'store: quote FAILED (page will retry)', {
          status: res.status(),
          opt: u.searchParams.get('opt'),
        });
      } else if (u.pathname === '/api/v2/handshake' && res.request().method() === 'POST' && !res.ok()) {
        opts.log('store: challenge REJECTED', { status: res.status() });
      } else if (u.pathname.startsWith('/api/') && res.status() >= 400) {
        opts.log('store: error response', { path: u.pathname, status: res.status() });
      }
    });

    if (opts.simulate) await installSimulation(page, opts);

    // Consent dialog: 75% of loads, after 1.5–5 s, needs 1–3 clicks. Reject (privacy-preserving) until gone.
    const consent = page.getByRole('dialog', { name: /privacy preferences/i });
    const dismissConsent = async () => {
      for (let i = 0; i < 6 && (await consent.isVisible().catch(() => false)); i++) {
        await consent
          .getByRole('button', { name: /reject cookies/i })
          .click({ timeout: 3000 })
          .then(() => consentClicks++)
          .catch(() => {});
        await sleep(150);
      }
    };
    await page.addLocatorHandler(consent, dismissConsent, { noWaitAfter: true });

    const url = storeUrl(`/item/${target.storeProductId}`);
    opts.log('open page', { url: url.href });
    await overlay(page, opts, `loading /item/${target.storeProductId}…`);
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      throw toScrapeError(err, 'NAV_TIMEOUT');
    }
    try {
      await page.locator('button.opt-chip').first().waitFor({ timeout: RENDER_TIMEOUT_MS });
    } catch (err) {
      throw toScrapeError(err, 'ITEM_NOT_RENDERED');
    }
    opts.log('page rendered', {
      manifest: traffic.manifest
        ? {
            variant: traffic.manifest.variant,
            priceTag: traffic.manifest.priceTag,
            carrier: traffic.manifest.priceCarrier,
          }
        : 'missing (structural selectors only)',
    });

    const results: OptionResult[] = [];
    for (const option of target.options) {
      results.push(await readOption(page, traffic, target.storeProductId, option, dismissConsent, opts));
      if (
        results.at(-1)!.ok === false &&
        (results.at(-1) as { error: ScrapeError }).error.code === 'BROWSER_CRASH'
      ) {
        break; // remaining options fail this try; the runner retries them on a fresh page
      }
    }
    return { results, manifest: traffic.manifest, consentClicks };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function readOption(
  page: Page,
  traffic: PageTraffic,
  storeProductId: number,
  option: OptionTarget,
  dismissConsent: () => Promise<void>,
  opts: PageOptions,
): Promise<OptionResult> {
  const start = {
    ok: traffic.handshakesOk,
    rejected: traffic.handshakesRejected,
    quotes: traffic.quotes.length,
  };
  const diag: OptionDiagnostics = {
    rounds: 0,
    clicksIgnored: 0,
    handshakesOk: 0,
    handshakesRejected: 0,
    quoteStatuses: [],
    lastPanelState: 'unknown',
  };
  const finishDiag = () => {
    diag.handshakesOk = traffic.handshakesOk - start.ok;
    diag.handshakesRejected = traffic.handshakesRejected - start.rejected;
    diag.quoteStatuses = traffic.quotes.slice(start.quotes).map((q) => q.status);
    return diag;
  };
  const deadline = Date.now() + config.SCRAPE_TRY_TIMEOUT_MS;
  const tag = `${storeProductId}/${option.optionId} "${option.optionLabel}"`;

  try {
    // 1. Select the option. The page's default option is RANDOM, so this is never optional.
    const chip = page
      .locator('button.opt-chip')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegex(option.optionLabel)}\\s*$`) });
    if ((await chip.count()) !== 1) {
      throw new ScrapeError('OPTION_NOT_FOUND', `option "${option.optionLabel}" not on page`);
    }
    await chip.click({ timeout: 10_000 });
    if ((await chip.getAttribute('aria-pressed')) !== 'true') {
      throw new ScrapeError('OPTION_MISMATCH', `clicked "${option.optionLabel}" but it is not pressed`);
    }
    opts.log('option selected', { option: tag });

    const panel = page.locator('.offer-panel').first();
    let lastClickAt = 0;
    let state: PanelState = (await panelState(page)).state;

    // 2. Rounds: hover → click → wait for the network outcome. Max 6 per page load.
    while (diag.rounds < MAX_ROUNDS && Date.now() < deadline) {
      diag.rounds++;
      await hover(page, panel, dismissConsent);
      ({ state } = await panelState(page));
      diag.lastPanelState = state;

      if (state === 'loading' || state === 'unknown' || state === 'absent') {
        // A previous click is still in flight (the page retries 5xx itself) — wait for it, don't click.
        diag.lastPanelState = await waitForOutcome(page, traffic, lastClickAt);
        continue;
      }
      if (state === 'ready') {
        const outcome = await readAndValidate(page, traffic, lastClickAt, storeProductId, option, diag);
        if (outcome.ok) {
          opts.log('valid read', {
            option: tag,
            price: outcome.value.priceMinor / 100,
            stock: outcome.value.stockText,
            rounds: diag.rounds,
          });
          await overlay(
            page,
            opts,
            `✓ ${option.optionLabel}: ${outcome.value.priceMinor / 100} ${outcome.value.currency}`,
          );
          return { optionId: option.optionId, ok: true, value: outcome.value, diag: finishDiag() };
        }
        // Transient in-page problems get another round; anything else ends this try.
        if (outcome.error.code !== 'PRICE_UNSTABLE' && outcome.error.code !== 'PRICE_STALE')
          throw outcome.error;
        opts.log('read not final, checking again', { option: tag, code: outcome.error.code });
      }

      const label = state === 'locked' ? /check today/i : state === 'failed' ? /^retry$/i : /check again/i;
      await overlay(
        page,
        opts,
        `${option.optionLabel} · round ${diag.rounds}/${MAX_ROUNDS} · ${state} → click`,
      );
      const hsBefore = traffic.handshakesStarted;
      lastClickAt = Date.now();
      await panel
        .getByRole('button', { name: label })
        .click({ timeout: 8_000 })
        .catch((err: unknown) => opts.log('click failed', { option: tag, err: String(err).split('\n')[0] }));

      while (traffic.handshakesStarted === hsBefore && Date.now() - lastClickAt < CLICK_TAKE_MS)
        await sleep(100);
      if (traffic.handshakesStarted === hsBefore) {
        diag.clicksIgnored++;
        opts.log('click ignored by page', { option: tag, round: diag.rounds });
        continue;
      }
      state = await waitForOutcome(page, traffic, lastClickAt);
      diag.lastPanelState = state;
      if (state === 'failed') diag.lastPanelMessage = await panel.innerText().catch(() => undefined);
      opts.log('round outcome', {
        option: tag,
        round: diag.rounds,
        state,
        handshakesRejected: traffic.handshakesRejected - start.rejected,
      });

      if (state === 'ready') {
        const outcome = await readAndValidate(page, traffic, lastClickAt, storeProductId, option, diag);
        if (outcome.ok) {
          opts.log('valid read', {
            option: tag,
            price: outcome.value.priceMinor / 100,
            stock: outcome.value.stockText,
            rounds: diag.rounds,
          });
          await overlay(
            page,
            opts,
            `✓ ${option.optionLabel}: ${outcome.value.priceMinor / 100} ${outcome.value.currency}`,
          );
          return { optionId: option.optionId, ok: true, value: outcome.value, diag: finishDiag() };
        }
        if (outcome.error.code !== 'PRICE_UNSTABLE' && outcome.error.code !== 'PRICE_STALE')
          throw outcome.error;
        opts.log('read not final, checking again', { option: tag, code: outcome.error.code });
      }
    }
    throw roundsExhaustedError(diag);
  } catch (err) {
    const error = toScrapeError(err);
    finishDiag();
    opts.log('option failed this try', { option: tag, code: error.code, message: error.message });
    await overlay(page, opts, `✕ ${option.optionLabel}: ${error.code}`);
    await screenshot(page, opts, `${storeProductId}-${option.optionId}-${error.code}`);
    return { optionId: option.optionId, ok: false, error, diag };
  }
}

function roundsExhaustedError(diag: OptionDiagnostics): ScrapeError {
  const msg = `no valid price after ${diag.rounds} rounds (last state: ${diag.lastPanelState})`;
  let code: ErrorCode = 'PRICE_NOT_RENDERED';
  if (diag.clicksIgnored === diag.rounds) code = 'CLICK_IGNORED';
  else if (diag.lastPanelState === 'failed' && /challenge_failed/i.test(diag.lastPanelMessage ?? ''))
    code = 'CHALLENGE_REJECTED';
  else if (diag.lastPanelState === 'failed') code = 'QUOTE_FAILED';
  else if (diag.lastPanelState === 'pending') code = 'PRICE_STALE';
  return new ScrapeError(
    code,
    diag.lastPanelMessage ? `${msg}: ${diag.lastPanelMessage.replace(/\s+/g, ' ')}` : msg,
  );
}

async function waitForOutcome(page: Page, traffic: PageTraffic, clickAt: number): Promise<PanelState> {
  const until = clickAt + OUTCOME_TIMEOUT_MS;
  while (Date.now() < until) {
    await sleep(250);
    const { state } = await panelState(page);
    const settled = traffic.lastOutcomeAt > clickAt && Date.now() - traffic.lastOutcomeAt > 300;
    if (settled && (state === 'ready' || state === 'pending' || state === 'failed')) return state;
  }
  return 'timeout';
}

async function readAndValidate(
  page: Page,
  traffic: PageTraffic,
  lastClickAt: number,
  storeProductId: number,
  option: OptionTarget,
  diag: OptionDiagnostics,
) {
  const classes = traffic.manifest?.classes ?? null;
  const first = await readPanel(page, classes);
  await sleep(800);
  const second = await readPanel(page, classes);
  diag.selectorSource = classes?.priceValue ? 'manifest+structure' : 'structure';
  const lastQuote = traffic.quotes.filter((q) => q.at >= lastClickAt).at(-1) ?? null;
  const raw: RawRead = {
    ...first,
    priceRawSecond: second.priceRaw,
    stockRawSecond: second.stockRaw,
    lastQuote: lastQuote && { status: lastQuote.status, opt: lastQuote.opt, path: lastQuote.path },
  };
  const v = validateRead(raw, { storeProductId, optionId: option.optionId, optionLabel: option.optionLabel });
  return v.ok
    ? { ok: true as const, value: v.value }
    : { ok: false as const, error: new ScrapeError(v.code, v.message) };
}

type PanelRead = Omit<RawRead, 'priceRawSecond' | 'stockRawSecond' | 'lastQuote'>;

/** Reads the ready panel using only VISIBLE text. Manifest and structural selectors must hit the same node. */
function readPanel(page: Page, classes: Record<string, string> | null): Promise<PanelRead> {
  return page.evaluate((cls) => {
    const visible = (e: Element | null | undefined): e is HTMLElement =>
      !!e &&
      (e as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      !e.closest('[aria-hidden="true"]');
    const text = (el: Element | null | undefined): string | null => {
      if (!visible(el)) return null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let s = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        if (visible(n.parentElement)) s += n.nodeValue ?? '';
      return s;
    };
    const panel = document.querySelector('.offer-panel');
    const ready = !!panel?.classList.contains('offer-ready');
    const row = ready ? panel!.querySelector('.offer-row') : null;
    const children = [...(row?.children ?? [])] as HTMLElement[];
    const byStructure = children.find((c) => c.style.fontSize === '2.4rem') ?? null;
    const byManifest =
      cls?.priceValue && row
        ? (row.querySelector(`.${CSS.escape(cls.priceValue)}`) as HTMLElement | null)
        : null;
    const priceEl = byManifest ?? byStructure;
    const mrpEl = children.find((c) => c !== priceEl && c.style.textDecoration.includes('line-through'));
    const stockEl = ready ? panel!.querySelector('.offer-facts .avail-pill') : null;
    return {
      path: location.pathname,
      selectedLabels: [...document.querySelectorAll('button.opt-chip[aria-pressed="true"]')].map(
        (b) => b.textContent?.trim() ?? '',
      ),
      panelReady: ready,
      pending: /refreshing prices/i.test(row?.textContent ?? ''),
      priceOpacity: priceEl ? getComputedStyle(priceEl).opacity : null,
      selectorsAgree: !cls?.priceValue || (byManifest !== null && byManifest === byStructure),
      priceRaw: text(priceEl),
      mrpRaw: text(mrpEl),
      stockRaw: text(stockEl),
    };
  }, classes);
}

async function panelState(page: Page): Promise<{ state: PanelState }> {
  const state = await page
    .evaluate(() => {
      const e = document.querySelector('.offer-panel');
      if (!e) return 'absent';
      if (e.classList.contains('offer-ready'))
        return /refreshing prices/i.test(e.textContent ?? '') ? 'pending' : 'ready';
      if (e.classList.contains('offer-failed')) return 'failed';
      if (e.classList.contains('offer-locked')) return 'locked';
      if (e.getAttribute('aria-busy') === 'true') return 'loading';
      return 'unknown';
    })
    .catch(() => 'absent' as const);
  return { state: state as PanelState };
}

/** Trusted pointer moves across the price panel (≥ 8 moves, ≥ 600 ms needed), then a short dwell. */
async function hover(page: Page, panel: ReturnType<Page['locator']>, dismissConsent: () => Promise<void>) {
  await dismissConsent();
  await panel.scrollIntoViewIfNeeded({ timeout: 5_000 });
  const box = await panel.boundingBox();
  if (!box) throw new ScrapeError('PRICE_NOT_RENDERED', 'price panel has no layout box');
  for (let i = 0; i < 24; i++) {
    const x = box.x + 12 + ((box.width - 24) * i) / 23 + Math.random() * 6;
    const y = box.y + box.height / 2 + Math.sin(i / 2) * Math.min(18, box.height / 3);
    await page.mouse.move(x, y, { steps: 3 });
    await sleep(55 + Math.random() * 40);
  }
  await sleep(2200 + Math.random() * 500);
}

async function installSimulation(page: Page, opts: PageOptions) {
  let used = false;
  await page.route('**/api/v2/items/*/quote*', async (route) => {
    if (used) return route.continue();
    used = true;
    if (opts.simulate === 'slow') {
      opts.log('[SIMULATED] delaying quote by 20 s');
      await sleep(20_000);
      return route.continue().catch(() => {});
    }
    opts.log('[SIMULATED] failing quote with 503');
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"simulated_outage"}',
    });
  });
}

/** Small on-page status box for headed runs, so a screen recording explains itself. */
async function overlay(page: Page, opts: PageOptions, message: string) {
  if (!opts.headed) return;
  await page
    .evaluate((msg) => {
      let el = document.getElementById('__pricepulse');
      if (!el) {
        el = document.createElement('div');
        el.id = '__pricepulse';
        el.style.cssText =
          'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;background:#111827;color:#e5e7eb;' +
          'font:13px/1.4 ui-monospace,monospace;padding:8px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:520px';
        document.documentElement.appendChild(el);
      }
      el.textContent = `PricePulse scraper · ${msg}`;
    }, message)
    .catch(() => {});
}

async function screenshot(page: Page, opts: PageOptions, name: string) {
  if (!opts.artifactsDir) return;
  await fs.mkdir(opts.artifactsDir, { recursive: true });
  const file = path.join(opts.artifactsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
