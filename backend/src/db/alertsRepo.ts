import { db, unwrap } from './supabase.js';

export type AlertType = 'price_drop' | 'back_in_stock' | 'structure_change';

export interface Alert {
  id: string;
  trackedItemId: string | null;
  attemptId: string | null;
  type: AlertType;
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

type Row = Record<string, unknown>;
const toAlert = (r: Row): Alert => ({
  id: r.id as string,
  trackedItemId: (r.tracked_item_id ?? null) as string | null,
  attemptId: (r.attempt_id ?? null) as string | null,
  type: r.type as AlertType,
  message: r.message as string,
  payload: (r.payload ?? null) as Record<string, unknown> | null,
  createdAt: r.created_at as string,
});

export const alertsRepo = {
  async insert(a: {
    trackedItemId: string | null;
    attemptId: string | null;
    type: AlertType;
    message: string;
    payload?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<Alert> {
    const row = unwrap(
      await db()
        .from('alerts')
        .insert({
          tracked_item_id: a.trackedItemId,
          attempt_id: a.attemptId,
          type: a.type,
          message: a.message,
          payload: a.payload ?? null,
          ...(a.createdAt && { created_at: a.createdAt }),
        })
        .select()
        .single(),
      'alerts.insert',
    );
    return toAlert(row);
  },

  async existsForAttempt(attemptId: string, type: AlertType): Promise<boolean> {
    const rows = unwrap(
      await db().from('alerts').select('id').eq('attempt_id', attemptId).eq('type', type).limit(1),
      'alerts.existsForAttempt',
    ) as Row[];
    return rows.length > 0;
  },

  /** Recent structure alerts for an item + error code (dedupes repeated extraction-failure alerts). */
  async recentStructure(trackedItemId: string, code: string, sinceIso: string): Promise<boolean> {
    const rows = unwrap(
      await db()
        .from('alerts')
        .select('id')
        .eq('type', 'structure_change')
        .eq('tracked_item_id', trackedItemId)
        .eq('payload->>errorCode', code)
        .gte('created_at', sinceIso)
        .limit(1),
      'alerts.recentStructure',
    ) as Row[];
    return rows.length > 0;
  },

  async list({ limit = 30, trackedItemId }: { limit?: number; trackedItemId?: string } = {}): Promise<
    Alert[]
  > {
    let q = db().from('alerts').select('*').order('created_at', { ascending: false }).limit(limit);
    if (trackedItemId) q = q.eq('tracked_item_id', trackedItemId);
    return (unwrap(await q, 'alerts.list') as Row[]).map(toAlert);
  },
};

export const signaturesRepo = {
  /** Records a sighting. Returns whether this signature had never been seen before, and how many existed. */
  async recordSeen(signature: string, sample: unknown): Promise<{ isNew: boolean; knownBefore: number }> {
    const existing = unwrap(
      await db()
        .from('structure_signatures')
        .select('signature,seen_count')
        .eq('signature', signature)
        .maybeSingle(),
      'signatures.get',
    ) as Row | null;
    if (existing) {
      unwrap(
        await db()
          .from('structure_signatures')
          .update({ last_seen_at: new Date().toISOString(), seen_count: Number(existing.seen_count) + 1 })
          .eq('signature', signature),
        'signatures.touch',
      );
      return { isNew: false, knownBefore: -1 };
    }
    const { count, error } = await db()
      .from('structure_signatures')
      .select('signature', { count: 'exact' })
      .limit(0);
    if (error) unwrap({ data: null, error }, 'signatures.count');
    unwrap(await db().from('structure_signatures').insert({ signature, sample }), 'signatures.insert');
    return { isNew: true, knownBefore: count ?? 0 };
  },
};
