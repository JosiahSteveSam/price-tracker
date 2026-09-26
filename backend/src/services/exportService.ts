import type { Writable } from 'node:stream';
import { attemptsRepo } from '../db/attemptsRepo.js';
import { trackedRepo } from '../db/trackedRepo.js';
import type { ScrapeAttempt, TrackedItem } from '../db/types.js';

// CSV export (columns fixed by the assignment brief). One row per scrape attempt, failures included.

export const CSV_COLUMNS = [
  'product_id',
  'product_name',
  'option',
  'timestamp',
  'price',
  'stock',
  'outcome',
] as const;

/** RFC 4180: quote fields containing comma, quote, CR or LF; double embedded quotes. */
export function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(
  a: ScrapeAttempt,
  item: Pick<TrackedItem, 'storeProductId' | 'productName' | 'optionLabel'>,
): string {
  const failed = a.outcome === 'failed';
  const price = failed || a.price === null ? '' : a.price.toFixed(2);
  const stock = failed ? '' : (a.stockQty ?? a.stockStatus ?? '');
  return [
    item.storeProductId,
    item.productName,
    item.optionLabel,
    new Date(a.finishedAt).toISOString(),
    price,
    stock,
    a.outcome,
  ]
    .map(csvField)
    .join(',');
}

export const exportFilename = (now = new Date()) =>
  `pricepulse-scrape-history-${now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}Z.csv`;

/** Streams the CSV (UTF-8 BOM so Excel shows ₹ correctly; CRLF line endings per RFC 4180). */
export async function writeCsv(out: Writable, trackedItemId?: string): Promise<number> {
  const items = new Map((await trackedRepo.list({ activeOnly: false })).map((i) => [i.id, i]));
  out.write('\uFEFF' + CSV_COLUMNS.join(',') + '\r\n');
  let rows = 0;
  for await (const page of attemptsRepo.iterateAll(trackedItemId)) {
    let chunk = '';
    for (const a of page) {
      const item = items.get(a.trackedItemId);
      if (!item) continue;
      chunk += csvRow(a, item) + '\r\n';
      rows++;
    }
    out.write(chunk);
  }
  return rows;
}
