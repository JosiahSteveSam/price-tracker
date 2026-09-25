import { fromNewAttempt, toScrapeAttempt } from './mappers.js';
import { db, unwrap } from './supabase.js';
import type { NewAttempt, ScrapeAttempt } from './types.js';

type Row = Record<string, unknown>;

export const attemptsRepo = {
  /** Append-only: attempts are inserted once, right after they finish, and never updated. */
  async insert(attempt: NewAttempt): Promise<ScrapeAttempt> {
    const row = unwrap(
      await db().from('scrape_attempts').insert(fromNewAttempt(attempt)).select().single(),
      'attempts.insert',
    );
    return toScrapeAttempt(row);
  },

  /** Scrape log for one item, newest first; `before` (ISO) paginates. */
  async listForItem(trackedItemId: string, { limit = 50, before }: { limit?: number; before?: string } = {}) {
    let q = db()
      .from('scrape_attempts')
      .select('*')
      .eq('tracked_item_id', trackedItemId)
      .order('finished_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('finished_at', before);
    return (unwrap(await q, 'attempts.listForItem') as Row[]).map(toScrapeAttempt);
  },

  /** All attempts for an item since `since` (oldest first) — feeds the chart. */
  async historyForItem(trackedItemId: string, since?: string): Promise<ScrapeAttempt[]> {
    let q = db()
      .from('scrape_attempts')
      .select('*')
      .eq('tracked_item_id', trackedItemId)
      .order('finished_at', { ascending: true })
      .limit(5000);
    if (since) q = q.gte('finished_at', since);
    return (unwrap(await q, 'attempts.historyForItem') as Row[]).map(toScrapeAttempt);
  },

  async trackedItemIdsInRun(runId: string): Promise<Set<string>> {
    const rows = unwrap(
      await db().from('scrape_attempts').select('tracked_item_id').eq('run_id', runId),
      'attempts.idsInRun',
    ) as Row[];
    return new Set(rows.map((r) => r.tracked_item_id as string));
  },

  async countsForRun(
    runId: string,
  ): Promise<{ total: number; success: number; retried: number; failed: number }> {
    const rows = unwrap(
      await db().from('scrape_attempts').select('outcome').eq('run_id', runId),
      'attempts.countsForRun',
    ) as Row[];
    const count = (o: string) => rows.filter((r) => r.outcome === o).length;
    return {
      total: rows.length,
      success: count('success'),
      retried: count('retried'),
      failed: count('failed'),
    };
  },

  /** Most recent valid (success/retried) attempt for an item — used for alerts and the dashboard. */
  async lastValid(trackedItemId: string, beforeIso?: string): Promise<ScrapeAttempt | null> {
    let q = db()
      .from('scrape_attempts')
      .select('*')
      .eq('tracked_item_id', trackedItemId)
      .neq('outcome', 'failed')
      .order('finished_at', { ascending: false })
      .limit(1);
    if (beforeIso) q = q.lt('finished_at', beforeIso);
    const rows = unwrap(await q, 'attempts.lastValid') as Row[];
    return rows[0] ? toScrapeAttempt(rows[0]) : null;
  },

  /** Streams every attempt (oldest first) in pages — used by the CSV export. */
  async *iterateAll(trackedItemId?: string, pageSize = 1000): AsyncGenerator<ScrapeAttempt[]> {
    for (let from = 0; ; from += pageSize) {
      let q = db()
        .from('scrape_attempts')
        .select('*')
        .order('finished_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (trackedItemId) q = q.eq('tracked_item_id', trackedItemId);
      const rows = (unwrap(await q, 'attempts.iterateAll') as Row[]).map(toScrapeAttempt);
      if (rows.length) yield rows;
      if (rows.length < pageSize) return;
    }
  },
};
