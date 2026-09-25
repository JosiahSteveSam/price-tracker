import { ScrapeError, type ErrorCode } from './errors.js';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Delay before try `nextTry` (2, 3, …): min(2^(n-1) × 1500 ms, 12 s) + 0–1 s jitter.
 * Rate limiting (429) backs off harder: 10 s × n.
 */
export function backoffMs(nextTry: number, lastCode: ErrorCode | undefined, random = Math.random): number {
  const n = Math.max(1, nextTry - 1);
  const base = lastCode === 'HTTP_429' ? 10_000 * n : Math.min(2 ** n * 1500, 12_000);
  return base + Math.floor(random() * 1000);
}

/** Rejects with ScrapeError(code) if `work` doesn't settle within `ms`. `onTimeout` runs cleanup. */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  code: ErrorCode,
  onTimeout?: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new ScrapeError(code, `timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
