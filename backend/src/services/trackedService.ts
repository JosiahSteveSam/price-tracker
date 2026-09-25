import { config } from '../config.js';
import { trackedRepo } from '../db/trackedRepo.js';
import { DbError, PG } from '../db/supabase.js';
import type { TrackedItem } from '../db/types.js';
import { HttpError } from '../http.js';
import { ScrapeError } from '../scraper/errors.js';
import { storeApi } from '../scraper/storeApi.js';

/**
 * Starts tracking one product option. Validates the option against the live store (by option id),
 * enforces MAX_TRACKED_ITEMS and uniqueness. Used by POST /api/tracked and the CLI.
 */
export async function createTracked(storeProductId: number, optionId: string): Promise<TrackedItem> {
  if ((await trackedRepo.countActive()) >= config.MAX_TRACKED_ITEMS) {
    throw new HttpError(422, 'TRACKING_LIMIT', `Tracking limit (${config.MAX_TRACKED_ITEMS}) reached.`);
  }
  const existing = await trackedRepo.findByProductOption(storeProductId, optionId);
  if (existing) {
    if (!existing.isActive) {
      await trackedRepo.setActive(existing.id, true);
      return { ...existing, isActive: true };
    }
    throw new HttpError(409, 'ALREADY_TRACKED', 'This product option is already tracked.');
  }

  let product;
  try {
    product = await storeApi.getItem(storeProductId);
  } catch (err) {
    if (err instanceof ScrapeError && err.code === 'PRODUCT_NOT_FOUND') {
      throw new HttpError(404, 'PRODUCT_NOT_FOUND', `Store product ${storeProductId} does not exist.`);
    }
    throw new HttpError(502, 'STORE_UNAVAILABLE', 'The store did not respond; try again shortly.');
  }
  const option = product.options.find((o) => o.id === optionId);
  if (!option)
    throw new HttpError(422, 'OPTION_NOT_FOUND', `Option ${optionId} is not offered for this product.`);

  try {
    return await trackedRepo.create({
      storeProductId,
      productName: product.name,
      productSlug: product.slug,
      brand: product.brand ?? null,
      category: product.category ?? null,
      sku: product.sku ?? null,
      optionAxis: product.optionAxis,
      optionId: option.id,
      optionLabel: option.label,
    });
  } catch (err) {
    if (err instanceof DbError && err.code === PG.uniqueViolation) {
      throw new HttpError(409, 'ALREADY_TRACKED', 'This product option is already tracked.');
    }
    throw err;
  }
}
