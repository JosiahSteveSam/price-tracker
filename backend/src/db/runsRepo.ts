import { toScrapeRun } from './mappers.js';
import { PG, db, unwrap } from './supabase.js';
import type { RunStatus, RunTrigger, ScrapeRun } from './types.js';

export const runsRepo = {
  /**
   * Creates a cron run for a 2 h slot. Returns null if the slot already has a run — the unique index
   * `scrape_runs_cron_slot` is what makes duplicate/retried cron triggers harmless.
   */
  async createCronRun(slotKey: Date, host: string): Promise<ScrapeRun | null> {
    const res = await db()
      .from('scrape_runs')
      .insert({ trigger: 'cron', slot_key: slotKey.toISOString(), host })
      .select()
      .single();
    if (res.error?.code === PG.uniqueViolation) return null;
    return toScrapeRun(unwrap(res, 'runs.createCron'));
  },

  async create(trigger: Exclude<RunTrigger, 'cron'>, host: string): Promise<ScrapeRun> {
    const row = unwrap(
      await db().from('scrape_runs').insert({ trigger, host }).select().single(),
      'runs.create',
    );
    return toScrapeRun(row);
  },

  async findCronRun(slotKey: Date): Promise<ScrapeRun | null> {
    const row = unwrap(
      await db()
        .from('scrape_runs')
        .select('*')
        .eq('trigger', 'cron')
        .eq('slot_key', slotKey.toISOString())
        .maybeSingle(),
      'runs.findCronRun',
    );
    return row ? toScrapeRun(row) : null;
  },

  async get(id: string): Promise<ScrapeRun | null> {
    const row = unwrap(await db().from('scrape_runs').select('*').eq('id', id).maybeSingle(), 'runs.get');
    return row ? toScrapeRun(row) : null;
  },

  /** Records which items this run intends to scrape, before scraping starts (used by crash recovery). */
  async setPlan(id: string, itemIds: string[]): Promise<void> {
    unwrap(
      await db()
        .from('scrape_runs')
        .update({ planned_item_ids: itemIds, items_total: itemIds.length })
        .eq('id', id),
      'runs.setPlan',
    );
  },

  async heartbeat(id: string): Promise<void> {
    unwrap(
      await db().from('scrape_runs').update({ heartbeat_at: new Date().toISOString() }).eq('id', id),
      'runs.heartbeat',
    );
  },

  async finish(
    id: string,
    fields: {
      status: Exclude<RunStatus, 'running'>;
      itemsTotal: number;
      itemsSuccess: number;
      itemsRetried: number;
      itemsFailed: number;
      manifestSignature?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    unwrap(
      await db()
        .from('scrape_runs')
        .update({
          status: fields.status,
          finished_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          items_total: fields.itemsTotal,
          items_success: fields.itemsSuccess,
          items_retried: fields.itemsRetried,
          items_failed: fields.itemsFailed,
          manifest_signature: fields.manifestSignature ?? null,
          error_message: fields.errorMessage ?? null,
        })
        .eq('id', id),
      'runs.finish',
    );
  },

  /** Runs still marked running whose heartbeat is older than `before` — candidates for recovery. */
  async findStale(before: Date): Promise<ScrapeRun[]> {
    const rows = unwrap(
      await db()
        .from('scrape_runs')
        .select('*')
        .eq('status', 'running')
        .lt('heartbeat_at', before.toISOString()),
      'runs.findStale',
    ) as Record<string, unknown>[];
    return rows.map(toScrapeRun);
  },

  async list(limit = 50): Promise<ScrapeRun[]> {
    const rows = unwrap(
      await db().from('scrape_runs').select('*').order('started_at', { ascending: false }).limit(limit),
      'runs.list',
    ) as Record<string, unknown>[];
    return rows.map(toScrapeRun);
  },

  async latest(): Promise<ScrapeRun | null> {
    return (await this.list(1))[0] ?? null;
  },
};
