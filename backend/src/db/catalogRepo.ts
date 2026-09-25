import { toCatalogProduct } from './mappers.js';
import { db, unwrap } from './supabase.js';
import type { CatalogProduct } from './types.js';

export type CatalogInput = Omit<CatalogProduct, 'refreshedAt'>;

/** Escapes LIKE wildcards so user input matches literally (search_catalog wraps it in %…%). */
export const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export const catalogRepo = {
  async upsertMany(products: CatalogInput[], refreshedAt = new Date().toISOString()): Promise<void> {
    for (let i = 0; i < products.length; i += 500) {
      const rows = products.slice(i, i + 500).map((p) => ({
        store_product_id: p.storeProductId,
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        category: p.category,
        sku: p.sku,
        description: p.description,
        refreshed_at: refreshedAt,
      }));
      unwrap(await db().from('catalog_products').upsert(rows), 'catalog.upsert');
    }
  },

  async search(q: string, limit = 20): Promise<CatalogProduct[]> {
    const rows = unwrap(
      await db().rpc('search_catalog', { q: escapeLike(q.trim()), max_results: limit }),
      'catalog.search',
    ) as Record<string, unknown>[];
    return rows.map(toCatalogProduct);
  },

  async get(storeProductId: number): Promise<CatalogProduct | null> {
    const row = unwrap(
      await db().from('catalog_products').select('*').eq('store_product_id', storeProductId).maybeSingle(),
      'catalog.get',
    );
    return row ? toCatalogProduct(row) : null;
  },

  /** Count and oldest refresh time — used to decide whether the cache needs refreshing. */
  async stats(): Promise<{ count: number; oldestRefreshedAt: string | null }> {
    // GET + limit(0), not `head: true`: HEAD requests swallow errors (e.g. a missing table reads as count 0).
    const { count, error } = await db()
      .from('catalog_products')
      .select('store_product_id', { count: 'exact' })
      .limit(0);
    if (error) unwrap({ data: null, error }, 'catalog.count');
    const oldest = unwrap(
      await db()
        .from('catalog_products')
        .select('refreshed_at')
        .order('refreshed_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      'catalog.oldest',
    );
    return { count: count ?? 0, oldestRefreshedAt: (oldest?.refreshed_at as string | undefined) ?? null };
  },
};
