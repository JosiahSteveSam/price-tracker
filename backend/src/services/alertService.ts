import { alertsRepo, signaturesRepo, type AlertType } from '../db/alertsRepo.js';
import { attemptsRepo } from '../db/attemptsRepo.js';
import type { ScrapeAttempt, TrackedItem } from '../db/types.js';
import { logger } from '../logger.js';

// Bonus features (docs/01-PRD.md Nice-to-have 2 + 3): price-drop / back-in-stock alerts and change detection.
// Alerts are derived only from stored, validated attempts. Nothing here may ever break a scrape run: every
// entry point swallows and logs its own errors.

/** Failure codes that suggest the page's structure or formats changed (vs. transient network/challenge issues). */
export const STRUCTURE_CODES = new Set([
  'SELECTOR_CONFLICT',
  'PRICE_PARSE_ERROR',
  'CURRENCY_UNKNOWN',
  'STOCK_UNRECOGNIZED',
  'PRICE_GT_MRP',
  'OPTION_NOT_FOUND',
]);

type Candidate = { type: AlertType; message: string; payload: Record<string, unknown> };

const inr = (v: number, currency: string | null) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency ?? 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);

/** Pure decision: which alerts does `attempt` warrant, given the previous valid attempt? */
export function alertsFor(
  item: Pick<TrackedItem, 'productName' | 'optionLabel'>,
  attempt: Pick<
    ScrapeAttempt,
    'outcome' | 'price' | 'currency' | 'stockStatus' | 'stockQty' | 'errorCode' | 'errorMessage'
  >,
  previousValid: Pick<ScrapeAttempt, 'price' | 'stockStatus' | 'finishedAt'> | null,
): Candidate[] {
  const name = `${item.productName} (${item.optionLabel})`;
  if (attempt.outcome === 'failed') {
    return attempt.errorCode && STRUCTURE_CODES.has(attempt.errorCode)
      ? [
          {
            type: 'structure_change',
            message: `Extraction failed for ${name}: ${attempt.errorCode} — the store page may have changed.`,
            payload: { errorCode: attempt.errorCode, detail: attempt.errorMessage },
          },
        ]
      : [];
  }
  if (!previousValid || attempt.price === null) return [];
  const out: Candidate[] = [];
  if (previousValid.price !== null && attempt.price < previousValid.price) {
    const pct = ((previousValid.price - attempt.price) / previousValid.price) * 100;
    out.push({
      type: 'price_drop',
      message: `${name} dropped ${pct.toFixed(1)}% to ${inr(attempt.price, attempt.currency)} (was ${inr(previousValid.price, attempt.currency)}).`,
      payload: {
        from: previousValid.price,
        to: attempt.price,
        pct: Math.round(pct * 10) / 10,
        since: previousValid.finishedAt,
      },
    });
  }
  if (previousValid.stockStatus === 'out_of_stock' && attempt.stockStatus === 'in_stock') {
    out.push({
      type: 'back_in_stock',
      message: `${name} is back in stock${attempt.stockQty !== null ? ` (${attempt.stockQty} available)` : ''}.`,
      payload: { qty: attempt.stockQty, since: previousValid.finishedAt },
    });
  }
  return out;
}

/** Called by the runner after each stored attempt. Idempotent per (attempt, type). */
export async function onAttemptStored(item: TrackedItem, attempt: ScrapeAttempt): Promise<number> {
  try {
    const previous =
      attempt.outcome === 'failed' ? null : await attemptsRepo.lastValid(item.id, attempt.finishedAt);
    let created = 0;
    for (const c of alertsFor(item, attempt, previous)) {
      if (await alertsRepo.existsForAttempt(attempt.id, c.type)) continue;
      if (c.type === 'structure_change') {
        const since = new Date(Date.parse(attempt.finishedAt) - 6 * 3_600_000).toISOString();
        if (await alertsRepo.recentStructure(item.id, String(c.payload.errorCode), since)) continue; // one per code per 6 h
      }
      await alertsRepo.insert({
        trackedItemId: item.id,
        attemptId: attempt.id,
        type: c.type,
        message: c.message,
        payload: c.payload,
        createdAt: attempt.finishedAt,
      });
      created++;
    }
    return created;
  } catch (err) {
    logger.warn({ err, attemptId: attempt.id }, 'alert evaluation failed (run unaffected)');
    return 0;
  }
}

export interface StructureSighting {
  signature: string;
  shape: Record<string, unknown>;
  attempts: number;
  valid: number;
}

/**
 * Change detection: records every manifest-shape signature seen in a run. A signature never seen before
 * (when others are already known) raises a `structure_change` alert, noting whether extraction still worked.
 * A missing manifest is a transient load failure, not a layout change, so it is recorded but not alerted.
 */
export async function recordStructures(sightings: StructureSighting[]): Promise<void> {
  for (const s of sightings) {
    try {
      const { isNew, knownBefore } = await signaturesRepo.recordSeen(s.signature, s.shape);
      if (!isNew || knownBefore === 0 || s.shape.missing) continue;
      await alertsRepo.insert({
        trackedItemId: null,
        attemptId: null,
        type: 'structure_change',
        message:
          `Store layout changed: new manifest shape ${s.signature} (priceTag=${String(s.shape.priceTag)}, ` +
          `carrier=${String(s.shape.priceCarrier)}). Extraction ${s.valid === s.attempts ? 'still succeeded' : 'FAILED'} ` +
          `on ${s.valid}/${s.attempts} page loads.`,
        payload: { signature: s.signature, shape: s.shape, attempts: s.attempts, valid: s.valid },
      });
    } catch (err) {
      logger.warn({ err, signature: s.signature }, 'structure recording failed (run unaffected)');
    }
  }
}
