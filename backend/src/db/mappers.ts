import { decimalToNumber, minorToDecimal } from './supabase.js';
import type {
  CatalogProduct,
  NewAttempt,
  ScrapeAttempt,
  ScrapeRun,
  StockStatus,
  TrackedItem,
  TryLog,
} from './types.js';

// Rows come back from PostgREST as loosely typed JSON; these mappers are the single place that knows columns.
type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v ?? null) as string | null;
const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const toCatalogProduct = (r: Row): CatalogProduct => ({
  storeProductId: n(r.store_product_id),
  slug: s(r.slug),
  name: s(r.name),
  brand: sn(r.brand),
  category: sn(r.category),
  sku: sn(r.sku),
  description: sn(r.description),
  refreshedAt: s(r.refreshed_at),
});

export const toTrackedItem = (r: Row): TrackedItem => ({
  id: s(r.id),
  storeProductId: n(r.store_product_id),
  productName: s(r.product_name),
  productSlug: sn(r.product_slug),
  brand: sn(r.brand),
  category: sn(r.category),
  sku: sn(r.sku),
  optionAxis: s(r.option_axis),
  optionId: s(r.option_id),
  optionLabel: s(r.option_label),
  isActive: Boolean(r.is_active),
  scrapeIntervalMinutes: n(r.scrape_interval_minutes),
  nextDueAt: s(r.next_due_at),
  createdAt: s(r.created_at),
});

export const toScrapeRun = (r: Row): ScrapeRun => ({
  id: s(r.id),
  trigger: r.trigger as ScrapeRun['trigger'],
  slotKey: sn(r.slot_key),
  status: r.status as ScrapeRun['status'],
  startedAt: s(r.started_at),
  heartbeatAt: s(r.heartbeat_at),
  finishedAt: sn(r.finished_at),
  itemsTotal: n(r.items_total),
  itemsSuccess: n(r.items_success),
  itemsRetried: n(r.items_retried),
  itemsFailed: n(r.items_failed),
  manifestSignature: sn(r.manifest_signature),
  host: sn(r.host),
  errorMessage: sn(r.error_message),
  plannedItemIds: (r.planned_item_ids ?? []) as string[],
});

export const toScrapeAttempt = (r: Row): ScrapeAttempt => ({
  id: s(r.id),
  runId: s(r.run_id),
  trackedItemId: s(r.tracked_item_id),
  startedAt: s(r.started_at),
  finishedAt: s(r.finished_at),
  outcome: r.outcome as ScrapeAttempt['outcome'],
  tryCount: n(r.try_count),
  price: decimalToNumber(r.price as string | number | null),
  mrp: decimalToNumber(r.mrp as string | number | null),
  currency: r.currency === null ? null : s(r.currency).trim(),
  stockStatus: (r.stock_status ?? null) as StockStatus | null,
  stockQty: nn(r.stock_qty),
  stockText: sn(r.stock_text),
  errorCode: sn(r.error_code),
  errorMessage: sn(r.error_message),
  tries: (r.tries ?? []) as TryLog[],
  durationMs: n(r.duration_ms),
  pageSignature: sn(r.page_signature),
});

/** Builds the insert row. Failed attempts carry no price/stock by construction (the DB also enforces it). */
export function fromNewAttempt(a: NewAttempt): Row {
  const base = {
    run_id: a.runId,
    tracked_item_id: a.trackedItemId,
    started_at: a.startedAt,
    finished_at: a.finishedAt,
    outcome: a.outcome,
    try_count: Math.max(1, a.tries.length),
    tries: a.tries,
    duration_ms: Math.max(0, Date.parse(a.finishedAt) - Date.parse(a.startedAt)),
    page_signature: a.pageSignature ?? null,
  };
  if (a.outcome === 'failed') {
    return { ...base, error_code: a.errorCode, error_message: a.errorMessage };
  }
  return {
    ...base,
    price: minorToDecimal(a.priceMinor),
    mrp: a.mrpMinor === null ? null : minorToDecimal(a.mrpMinor),
    currency: a.currency,
    stock_status: a.stockStatus,
    stock_qty: a.stockQty,
    stock_text: a.stockText,
    error_code: a.errorCode ?? null,
    error_message: a.errorMessage ?? null,
  };
}
