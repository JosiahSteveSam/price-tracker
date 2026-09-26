// Error codes and whether a fresh page load may fix them (DESIGN_NOTE.md §3).

/** code → whether a fresh page load (a new "try") may fix it. */
export const RETRYABLE = {
  NAV_TIMEOUT: true,
  HTTP_5XX: true,
  HTTP_429: true,
  ITEM_NOT_RENDERED: true,
  CHALLENGE_REJECTED: true,
  QUOTE_FAILED: true,
  CLICK_IGNORED: true,
  PRICE_NOT_RENDERED: true,
  PRICE_STALE: true,
  PRICE_UNSTABLE: true,
  QUOTE_MISMATCH: true,
  SELECTOR_CONFLICT: true,
  OPTION_MISMATCH: true,
  PRODUCT_MISMATCH: true,
  PRICE_PARSE_ERROR: true,
  PRICE_OUT_OF_RANGE: true,
  PRICE_GT_MRP: true,
  CURRENCY_UNKNOWN: true,
  STOCK_UNRECOGNIZED: true,
  BROWSER_CRASH: true,
  TRY_TIMEOUT: true,
  UNKNOWN: true,
  OPTION_NOT_FOUND: false,
  PRODUCT_NOT_FOUND: false,
  HOST_NOT_ALLOWED: false,
  RUN_BUDGET_EXCEEDED: false,
  RUN_INTERRUPTED: false,
  RUN_CRASHED: false,
} as const;

export type ErrorCode = keyof typeof RETRYABLE;

export class ScrapeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ScrapeError';
  }

  get retryable(): boolean {
    return RETRYABLE[this.code];
  }
}

/** Normalizes anything thrown during a try into a ScrapeError with a stable code. */
export function toScrapeError(err: unknown, fallback: ErrorCode = 'UNKNOWN'): ScrapeError {
  if (err instanceof ScrapeError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split('\n')[0] ?? message;
  if (
    /Target (page, context or browser )?(has been )?closed|Browser has been closed|browser has disconnected/i.test(
      message,
    )
  ) {
    return new ScrapeError('BROWSER_CRASH', firstLine);
  }
  if (err instanceof Error && err.name === 'TimeoutError')
    return new ScrapeError(fallback === 'UNKNOWN' ? 'NAV_TIMEOUT' : fallback, firstLine);
  return new ScrapeError(fallback, firstLine);
}
