// Domain types (camelCase). Repositories map to/from snake_case rows (see supabase/migrations).

export type Outcome = 'success' | 'retried' | 'failed';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type RunTrigger = 'cron' | 'manual' | 'first_track' | 'cli';
export type RunStatus = 'running' | 'completed' | 'completed_with_failures' | 'interrupted' | 'crashed';

export interface CatalogProduct {
  storeProductId: number;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  description: string | null;
  refreshedAt: string;
}

export interface TrackedItem {
  id: string;
  storeProductId: number;
  productName: string;
  productSlug: string | null;
  brand: string | null;
  category: string | null;
  sku: string | null;
  optionAxis: string;
  optionId: string;
  optionLabel: string;
  isActive: boolean;
  scrapeIntervalMinutes: number;
  nextDueAt: string;
  createdAt: string;
}

export interface ScrapeRun {
  id: string;
  trigger: RunTrigger;
  slotKey: string | null;
  status: RunStatus;
  startedAt: string;
  heartbeatAt: string;
  finishedAt: string | null;
  itemsTotal: number;
  itemsSuccess: number;
  itemsRetried: number;
  itemsFailed: number;
  manifestSignature: string | null;
  host: string | null;
  errorMessage: string | null;
  plannedItemIds: string[];
}

/** One page load inside an attempt (stored in scrape_attempts.tries). */
export interface TryLog {
  n: number;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
  message?: string;
  [detail: string]: unknown;
}

export interface ScrapeAttempt {
  id: string;
  runId: string;
  trackedItemId: string;
  startedAt: string;
  finishedAt: string;
  outcome: Outcome;
  tryCount: number;
  price: number | null;
  mrp: number | null;
  currency: string | null;
  stockStatus: StockStatus | null;
  stockQty: number | null;
  stockText: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  tries: TryLog[];
  durationMs: number;
  pageSignature: string | null;
}

/** Data for a new attempt. Money in integer minor units (paise); the repo converts to exact decimals. */
export type NewAttempt = {
  runId: string;
  trackedItemId: string;
  startedAt: string;
  finishedAt: string;
  tries: TryLog[];
  pageSignature?: string | null;
} & (
  | {
      outcome: 'success' | 'retried';
      priceMinor: number;
      mrpMinor: number | null;
      currency: string;
      stockStatus: StockStatus;
      stockQty: number | null;
      stockText: string;
      /** For `retried`: the last error seen before the valid read. */
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  | { outcome: 'failed'; errorCode: string; errorMessage: string }
);
