import { config } from '../config.js';
import { attemptsRepo } from '../db/attemptsRepo.js';
import type { ScrapeAttempt, TrackedItem } from '../db/types.js';

// Read models for the dashboard and item pages (API JSON, camelCase).

export const storeProductUrl = (storeProductId: number) =>
  new URL(`/item/${storeProductId}`, config.STORE_BASE_URL).href;

const valid = (a: ScrapeAttempt) => a.outcome !== 'failed';

/** Public shape of an attempt (the scrape log row). */
export const attemptView = (a: ScrapeAttempt) => ({
  id: a.id,
  runId: a.runId,
  startedAt: a.startedAt,
  finishedAt: a.finishedAt,
  outcome: a.outcome,
  tryCount: a.tryCount,
  durationMs: a.durationMs,
  price: a.price,
  mrp: a.mrp,
  currency: a.currency,
  stockStatus: a.stockStatus,
  stockQty: a.stockQty,
  stockText: a.stockText,
  errorCode: a.errorCode,
  errorMessage: a.errorMessage,
  tries: a.tries,
});

export const itemView = (i: TrackedItem) => ({
  id: i.id,
  storeProductId: i.storeProductId,
  storeUrl: storeProductUrl(i.storeProductId),
  productName: i.productName,
  brand: i.brand,
  category: i.category,
  sku: i.sku,
  optionAxis: i.optionAxis,
  optionId: i.optionId,
  optionLabel: i.optionLabel,
  isActive: i.isActive,
  scrapeIntervalMinutes: i.scrapeIntervalMinutes,
  nextDueAt: i.nextDueAt,
  createdAt: i.createdAt,
});

/** Dashboard card: latest valid price/stock, change vs previous valid, latest outcome, 24 h sparkline, success rate. */
export async function trackedSummary(item: TrackedItem) {
  const recent = await attemptsRepo.listForItem(item.id, { limit: 60 }); // newest first
  const validOnes = recent.filter(valid);
  const latestValid = validOnes[0] ?? null;
  const previousValid = validOnes[1] ?? null;
  const last24 = recent.slice(0, 24);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return {
    ...itemView(item),
    latest: latestValid && {
      price: latestValid.price,
      mrp: latestValid.mrp,
      currency: latestValid.currency,
      stockStatus: latestValid.stockStatus,
      stockQty: latestValid.stockQty,
      stockText: latestValid.stockText,
      at: latestValid.finishedAt,
    },
    previousPrice: previousValid?.price ?? null,
    lastAttempt: recent[0] && {
      outcome: recent[0].outcome,
      at: recent[0].finishedAt,
      errorCode: recent[0].errorCode,
    },
    successRate: last24.length ? last24.filter(valid).length / last24.length : null,
    attemptsCounted: last24.length,
    sparkline: validOnes
      .filter((a) => Date.parse(a.finishedAt) >= since)
      .reverse()
      .map((a) => ({ t: a.finishedAt, price: a.price })),
  };
}

/**
 * Chart data: every attempt in time order. Valid attempts carry price/stock; failed attempts are markers with
 * no values — the UI must never draw them as zero or interpolate across them.
 */
export async function trackedHistory(itemId: string, since?: string) {
  const attempts = await attemptsRepo.historyForItem(itemId, since);
  return attempts.map((a) => ({
    t: a.finishedAt,
    outcome: a.outcome,
    price: a.price,
    mrp: a.mrp,
    stockQty: a.stockQty,
    stockStatus: a.stockStatus,
    errorCode: a.errorCode,
  }));
}
