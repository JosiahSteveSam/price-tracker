import { describe, expect, it } from 'vitest';
import { ScrapeError, toScrapeError } from '../src/scraper/errors.js';
import { backoffMs, withTimeout } from '../src/scraper/retry.js';

describe('backoffMs', () => {
  const noJitter = () => 0;
  it('grows exponentially and caps at 12 s', () => {
    expect([2, 3, 4, 5, 6].map((n) => backoffMs(n, 'NAV_TIMEOUT', noJitter))).toEqual([
      3000, 6000, 12000, 12000, 12000,
    ]);
  });
  it('backs off harder on 429', () => {
    expect(backoffMs(2, 'HTTP_429', noJitter)).toBe(10000);
    expect(backoffMs(3, 'HTTP_429', noJitter)).toBe(20000);
  });
  it('adds at most 1 s of jitter', () => {
    expect(backoffMs(2, undefined, () => 0.999)).toBe(3999);
  });
});

describe('withTimeout', () => {
  it('resolves when work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'TRY_TIMEOUT')).resolves.toBe(7);
  });
  it('rejects with the given code and runs cleanup', async () => {
    let cleaned = false;
    const never = new Promise(() => {});
    await expect(withTimeout(never, 20, 'TRY_TIMEOUT', () => (cleaned = true))).rejects.toMatchObject({
      code: 'TRY_TIMEOUT',
    });
    expect(cleaned).toBe(true);
  });
});

describe('toScrapeError', () => {
  it('keeps ScrapeErrors and classifies browser crashes and timeouts', () => {
    const e = new ScrapeError('OPTION_NOT_FOUND', 'gone');
    expect(toScrapeError(e)).toBe(e);
    expect(e.retryable).toBe(false);
    expect(toScrapeError(new Error('Target page, context or browser has been closed')).code).toBe(
      'BROWSER_CRASH',
    );
    const timeout = Object.assign(new Error('locator.click: Timeout 8000ms exceeded.'), {
      name: 'TimeoutError',
    });
    expect(toScrapeError(timeout).code).toBe('NAV_TIMEOUT');
    expect(toScrapeError(timeout, 'PRICE_NOT_RENDERED').code).toBe('PRICE_NOT_RENDERED');
    expect(toScrapeError('boom').code).toBe('UNKNOWN');
  });
});
