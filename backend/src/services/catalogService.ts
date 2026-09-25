import { catalogRepo } from '../db/catalogRepo.js';
import { trackedRepo } from '../db/trackedRepo.js';
import { HttpError } from '../http.js';
import { logger } from '../logger.js';
import { ScrapeError } from '../scraper/errors.js';
import { storeApi, type StoreItem } from '../scraper/storeApi.js';
import { storeProductUrl } from './trackedView.js';

const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ITEM_TTL_MS = 10 * 60 * 1000;

type ListingLike = {
  id: number;
  slug: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  sku?: string | null;
  description?: string | null;
};
const toInput = (p: ListingLike) => ({
  storeProductId: p.id,
  slug: p.slug,
  name: p.name,
  brand: p.brand ?? null,
  category: p.category ?? null,
  sku: p.sku ?? null,
  description: p.description ?? null,
});

let refreshing: { firstBatch: Promise<void>; done: Promise<number> } | null = null;
let lastRefreshIncomplete = false;

/**
 * Re-collects the store catalogue (the listing is shuffled per request — see storeApi.listAllProducts).
 * Each batch is upserted as it arrives, so `firstBatch` resolves within seconds and search works while the
 * rest fills in. Single-flight: concurrent callers share one refresh.
 */
export function refreshCatalog() {
  if (refreshing) return refreshing;
  let markFirst!: () => void;
  const firstBatch = new Promise<void>((r) => (markFirst = r));
  const done = (async () => {
    try {
      const { products, expected, requests } = await storeApi.listAllProducts({
        onBatch: async (fresh) => {
          await catalogRepo.upsertMany(fresh.map(toInput));
          markFirst();
        },
      });
      lastRefreshIncomplete = products.length < expected;
      logger.info({ products: products.length, expected, requests }, 'catalogue refreshed');
      return products.length;
    } finally {
      markFirst();
      refreshing = null;
    }
  })();
  refreshing = { firstBatch, done };
  done.catch(() => {}); // callers observe failures via firstBatch/done themselves
  return refreshing;
}

/**
 * Partial or full name search over the cached catalogue, plus lookup by store product id (e.g. "2312").
 * Empty cache → wait for the first batch; stale or incomplete cache → refresh in the background.
 */
export async function searchCatalog(q: string, limit: number) {
  const { count, oldestRefreshedAt } = await catalogRepo.stats();
  if (count === 0) {
    const r = refreshCatalog();
    await Promise.race([r.firstBatch, r.done]).catch((err) => {
      logger.error({ err }, 'catalogue refresh failed');
      throw new HttpError(502, 'STORE_UNAVAILABLE', 'Could not load the store catalogue; try again shortly.');
    });
  } else if (
    lastRefreshIncomplete ||
    !oldestRefreshedAt ||
    Date.now() - Date.parse(oldestRefreshedAt) > CATALOG_MAX_AGE_MS
  ) {
    void refreshCatalog().done.catch((err) => logger.warn({ err }, 'background catalogue refresh failed'));
  }

  const results = await catalogRepo.search(q, limit);
  if (/^\d{3,6}$/.test(q) && !results.some((p) => p.storeProductId === Number(q))) {
    const byId = await catalogRepo
      .get(Number(q))
      .then(async (hit) => hit ?? (await lookupAndCache(Number(q))));
    if (byId) results.unshift(byId);
  }
  return results.slice(0, limit);
}

async function lookupAndCache(storeProductId: number) {
  try {
    const item = await storeApi.getItem(storeProductId);
    await catalogRepo.upsertMany([toInput(item)]);
    return catalogRepo.get(storeProductId);
  } catch {
    return null; // unknown id → just no extra result
  }
}

const itemCache = new Map<number, { at: number; item: StoreItem }>();

/** Live product details + options (cached 10 min), with which options are already tracked. */
export async function getProductDetails(storeProductId: number) {
  let item = itemCache.get(storeProductId);
  if (!item || Date.now() - item.at > ITEM_TTL_MS) {
    try {
      item = { at: Date.now(), item: await storeApi.getItem(storeProductId) };
      itemCache.set(storeProductId, item);
    } catch (err) {
      if (err instanceof ScrapeError && err.code === 'PRODUCT_NOT_FOUND') {
        throw new HttpError(404, 'PRODUCT_NOT_FOUND', `Store product ${storeProductId} does not exist.`);
      }
      throw new HttpError(502, 'STORE_UNAVAILABLE', 'The store did not respond; try again shortly.');
    }
  }
  const p = item.item;
  const tracked = (await trackedRepo.list()).filter((t) => t.storeProductId === storeProductId);
  const ratings = (p.reviews ?? []).map((r) => r.rating);
  return {
    storeProductId: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand ?? null,
    category: p.category ?? null,
    sku: p.sku ?? null,
    description: p.description ?? null,
    specs: p.specs ?? {},
    reviews: {
      count: ratings.length,
      average: ratings.length
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
        : null,
    },
    optionAxis: p.optionAxis,
    options: p.options.map((o) => ({
      id: o.id,
      label: o.label,
      trackedItemId: tracked.find((t) => t.optionId === o.id)?.id ?? null,
    })),
    storeUrl: storeProductUrl(p.id),
  };
}
