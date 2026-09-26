// Response shapes of the PricePulse API (backend/src/routes, backend/src/services/*View.ts).

export type Outcome = 'success' | 'retried' | 'failed';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type RunStatus = 'running' | 'completed' | 'completed_with_failures' | 'interrupted' | 'crashed';

export interface TrackedItem {
  id: string;
  storeProductId: number;
  storeUrl: string;
  productName: string;
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

export interface TrackedSummary extends TrackedItem {
  latest: {
    price: number | null;
    mrp: number | null;
    currency: string | null;
    stockStatus: StockStatus | null;
    stockQty: number | null;
    stockText: string | null;
    at: string;
  } | null;
  previousPrice: number | null;
  lastAttempt: { outcome: Outcome; at: string; errorCode: string | null } | null;
  successRate: number | null;
  attemptsCounted: number;
  sparkline: { t: string; price: number | null }[];
}

export interface CatalogResult {
  storeProductId: number;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  storeUrl: string;
}

export interface ProductDetails {
  storeProductId: number;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  description: string | null;
  specs: Record<string, unknown>;
  reviews: { count: number; average: number | null };
  optionAxis: string;
  options: { id: string; label: string; trackedItemId: string | null }[];
  storeUrl: string;
}

export interface HistoryPoint {
  t: string;
  outcome: Outcome;
  price: number | null;
  mrp: number | null;
  stockQty: number | null;
  stockStatus: StockStatus | null;
  errorCode: string | null;
}

export interface TryLog {
  n: number;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
  message?: string;
  rounds?: number;
  clicksIgnored?: number;
  handshakesOk?: number;
  handshakesRejected?: number;
  quoteStatuses?: number[];
  consentClicks?: number;
  lastPanelState?: string;
}

export interface Attempt {
  id: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  outcome: Outcome;
  tryCount: number;
  durationMs: number;
  price: number | null;
  mrp: number | null;
  currency: string | null;
  stockStatus: StockStatus | null;
  stockQty: number | null;
  stockText: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  tries: TryLog[];
}

export interface Run {
  id: string;
  trigger: 'cron' | 'manual' | 'first_track' | 'cli';
  slotKey: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  itemsTotal: number;
  itemsSuccess: number;
  itemsRetried: number;
  itemsFailed: number;
  host: string | null;
  errorMessage: string | null;
}

export interface RunsResponse {
  runs: Run[];
  missedSlots: string[];
  schedule: { everyMinutes: number; timezone: string; nextSlot: string };
  active: { runId: string | null; trigger: string } | null;
}

export interface Health {
  ok: boolean;
  startedAt: string;
  uptimeSec: number;
  db: boolean;
  lastRun: { id: string; trigger: string; status: RunStatus; startedAt: string; finishedAt: string | null } | null;
  activeRun: { runId: string | null; trigger: string } | null;
}
