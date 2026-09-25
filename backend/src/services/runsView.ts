import type { ScrapeRun } from '../db/types.js';
import { SLOT_MS } from '../scraper/runner.js';

const GRACE_MS = 15 * 60 * 1000;

/**
 * Expected cron slots (every 2 h UTC) from the first cron run until now that have no run at all — shown as
 * "missed" so gaps in the history are explained, not silent. Slots are considered missed after a 15 min grace.
 */
export function missedSlots(runs: ScrapeRun[], now = new Date()): string[] {
  const cronSlots = runs.filter((r) => r.trigger === 'cron' && r.slotKey).map((r) => Date.parse(r.slotKey!));
  if (!cronSlots.length) return [];
  const have = new Set(cronSlots);
  const first = Math.min(...cronSlots);
  const missed: string[] = [];
  for (let t = first; t + GRACE_MS < now.getTime(); t += SLOT_MS) {
    if (!have.has(t)) missed.push(new Date(t).toISOString());
  }
  return missed;
}

export const runView = (r: ScrapeRun) => ({
  id: r.id,
  trigger: r.trigger,
  slotKey: r.slotKey,
  status: r.status,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  durationMs: r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : null,
  itemsTotal: r.itemsTotal,
  itemsSuccess: r.itemsSuccess,
  itemsRetried: r.itemsRetried,
  itemsFailed: r.itemsFailed,
  host: r.host,
  errorMessage: r.errorMessage,
});
