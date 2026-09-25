import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ScrapeError } from './errors.js';
import { backoffMs, sleep } from './retry.js';

// Plain HTTP client for the store's open JSON API (catalogue, product details, options).
// Price/stock are NOT available here — they come from productPage.ts (docs/02-TRD.md §Why a hybrid scraper).

const STORE = new URL(config.STORE_BASE_URL);

const ListingSchema = z.object({
  page: z.number(),
  perPage: z.number(),
  totalPages: z.number(),
  count: z.number(),
  results: z.array(
    z.object({
      id: z.number().int(),
      slug: z.string(),
      name: z.string(),
      brand: z.string().nullish(),
      category: z.string().nullish(),
      sku: z.string().nullish(),
      description: z.string().nullish(),
    }),
  ),
});

export const StoreItemSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  brand: z.string().nullish(),
  category: z.string().nullish(),
  sku: z.string().nullish(),
  description: z.string().nullish(),
  specs: z.record(z.string(), z.unknown()).nullish(),
  reviews: z
    .array(
      z.object({ rating: z.number(), title: z.string().nullish(), author: z.string().nullish() }).loose(),
    )
    .nullish(),
  optionAxis: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
});
export type StoreItem = z.infer<typeof StoreItemSchema>;
export type ListingProduct = z.infer<typeof ListingSchema>['results'][number];

/** Refuses any URL outside STORE_BASE_URL — the brief forbids scraping other sites. */
export function storeUrl(path: string): URL {
  const url = new URL(path, STORE);
  if (url.origin !== STORE.origin)
    throw new ScrapeError('HOST_NOT_ALLOWED', `refusing to fetch ${url.origin}`);
  return url;
}

/** GET JSON with timeout, retries (5xx/429/network/HTML error pages) and backoff. 404 is final. */
export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  { tries = 4, timeoutMs = 15_000 } = {},
): Promise<T> {
  const url = storeUrl(path);
  let last: ScrapeError | undefined;
  for (let n = 1; n <= tries; n++) {
    if (n > 1) await sleep(backoffMs(n, last?.code));
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) throw new ScrapeError('PRODUCT_NOT_FOUND', `404 for ${url.pathname}`);
      if (res.status === 429) throw new ScrapeError('HTTP_429', `429 for ${url.pathname}`);
      if (res.status >= 500) throw new ScrapeError('HTTP_5XX', `${res.status} for ${url.pathname}`);
      if (!res.ok) throw new ScrapeError('UNKNOWN', `${res.status} for ${url.pathname}`);
      // The store sometimes answers with an HTML error page and a 200/5xx — never trust it as JSON.
      if (!res.headers.get('content-type')?.includes('application/json')) {
        throw new ScrapeError(
          'HTTP_5XX',
          `non-JSON response (${res.headers.get('content-type')}) for ${url.pathname}`,
        );
      }
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) {
        throw new ScrapeError(
          'UNKNOWN',
          `unexpected JSON shape for ${url.pathname}: ${parsed.error.issues[0]?.message}`,
        );
      }
      return parsed.data;
    } catch (err) {
      last =
        err instanceof ScrapeError
          ? err
          : new ScrapeError(
              err instanceof Error && err.name === 'TimeoutError' ? 'NAV_TIMEOUT' : 'HTTP_5XX',
              `${url.pathname}: ${err instanceof Error ? err.message : String(err)}`,
            );
      if (!last.retryable) throw last;
      logger.debug({ path: url.pathname, try: n, code: last.code }, 'store api retry');
    }
  }
  throw last!;
}

export const storeApi = {
  getItem: (id: number) => getJson(`/api/v2/items/${id}`, StoreItemSchema),

  /**
   * Whole catalogue. The store SHUFFLES the full list on every listing request (the same "page 1" twice
   * shares ~2 of 60 products), so pages are really random samples of 60. We keep sampling — paced, because
   * bursts trigger HTML error pages — until every one of `count` products has been seen (coupon-collector:
   * ~120 requests for 960), handing each batch of new products to `onBatch` so search works while it fills.
   */
  async listAllProducts({
    onBatch,
    maxRequests = 300,
    delayMs = 400,
  }: {
    onBatch?: (fresh: ListingProduct[]) => Promise<void>;
    maxRequests?: number;
    delayMs?: number;
  } = {}): Promise<{
    products: ListingProduct[];
    expected: number;
    requests: number;
  }> {
    const perPage = 60;
    const byId = new Map<number, ListingProduct>();
    let expected = Infinity;
    let requests = 0;
    let pending: ListingProduct[] = [];
    while (byId.size < expected && requests < maxRequests) {
      if (requests > 0) await sleep(delayMs);
      const page = (requests % 16) + 1;
      requests++;
      let res: z.infer<typeof ListingSchema>;
      try {
        res = await getJson(`/api/v2/listings?page=${page}&limit=${perPage}`, ListingSchema);
      } catch (err) {
        if (byId.size === 0) throw err;
        logger.warn({ err, got: byId.size }, 'catalogue sampling stopped early');
        break;
      }
      expected = res.count;
      for (const p of res.results) {
        if (!byId.has(p.id)) {
          byId.set(p.id, p);
          pending.push(p);
        }
      }
      if (onBatch && (pending.length >= 120 || byId.size >= expected)) {
        await onBatch(pending);
        pending = [];
      }
    }
    if (onBatch && pending.length) await onBatch(pending);
    if (byId.size < expected) logger.warn({ got: byId.size, expected, requests }, 'catalogue incomplete');
    return { products: [...byId.values()], expected, requests };
  },
};
