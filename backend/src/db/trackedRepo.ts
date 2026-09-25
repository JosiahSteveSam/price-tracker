import { toTrackedItem } from './mappers.js';
import { db, unwrap } from './supabase.js';
import type { TrackedItem } from './types.js';

export type NewTrackedItem = Pick<
  TrackedItem,
  'storeProductId' | 'productName' | 'optionAxis' | 'optionId' | 'optionLabel'
> &
  Partial<Pick<TrackedItem, 'productSlug' | 'brand' | 'category' | 'sku'>>;

export const trackedRepo = {
  /** Throws DbError with code 23505 if this product+option is already tracked. */
  async create(item: NewTrackedItem): Promise<TrackedItem> {
    const row = unwrap(
      await db()
        .from('tracked_items')
        .insert({
          store_product_id: item.storeProductId,
          product_name: item.productName,
          product_slug: item.productSlug ?? null,
          brand: item.brand ?? null,
          category: item.category ?? null,
          sku: item.sku ?? null,
          option_axis: item.optionAxis,
          option_id: item.optionId,
          option_label: item.optionLabel,
        })
        .select()
        .single(),
      'tracked.create',
    );
    return toTrackedItem(row);
  },

  async get(id: string): Promise<TrackedItem | null> {
    const row = unwrap(
      await db().from('tracked_items').select('*').eq('id', id).maybeSingle(),
      'tracked.get',
    );
    return row ? toTrackedItem(row) : null;
  },

  async list({ activeOnly = true } = {}): Promise<TrackedItem[]> {
    let q = db().from('tracked_items').select('*').order('created_at', { ascending: true });
    if (activeOnly) q = q.eq('is_active', true);
    return (unwrap(await q, 'tracked.list') as Record<string, unknown>[]).map(toTrackedItem);
  },

  async findByProductOption(storeProductId: number, optionId: string): Promise<TrackedItem | null> {
    const row = unwrap(
      await db()
        .from('tracked_items')
        .select('*')
        .eq('store_product_id', storeProductId)
        .eq('option_id', optionId)
        .maybeSingle(),
      'tracked.findByProductOption',
    );
    return row ? toTrackedItem(row) : null;
  },

  /** Active items due by `dueBy` (the runner passes now + slack). */
  async findDue(dueBy: Date): Promise<TrackedItem[]> {
    const rows = unwrap(
      await db()
        .from('tracked_items')
        .select('*')
        .eq('is_active', true)
        .lte('next_due_at', dueBy.toISOString())
        .order('store_product_id')
        .order('option_id'),
      'tracked.findDue',
    ) as Record<string, unknown>[];
    return rows.map(toTrackedItem);
  },

  async countActive(): Promise<number> {
    // GET + limit(0), not `head: true`: HEAD requests swallow errors (a failure must not read as "0 tracked").
    const { count, error } = await db()
      .from('tracked_items')
      .select('id', { count: 'exact' })
      .eq('is_active', true)
      .limit(0);
    if (error) unwrap({ data: null, error }, 'tracked.countActive');
    return count ?? 0;
  },

  async setNextDue(id: string, at: Date): Promise<void> {
    unwrap(
      await db().from('tracked_items').update({ next_due_at: at.toISOString() }).eq('id', id),
      'tracked.setNextDue',
    );
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    unwrap(
      await db().from('tracked_items').update({ is_active: isActive }).eq('id', id),
      'tracked.setActive',
    );
  },

  /** Keeps the snapshot name current if the store renames the product. */
  async updateProductName(id: string, productName: string): Promise<void> {
    unwrap(
      await db().from('tracked_items').update({ product_name: productName }).eq('id', id),
      'tracked.updateProductName',
    );
  },
};
