import { Router } from 'express';
import { z } from 'zod';
import { rateLimit, requireAdmin } from '../auth.js';
import { asyncHandler } from '../http.js';
import { getProductDetails, refreshCatalog, searchCatalog } from '../services/catalogService.js';
import { storeProductUrl } from '../services/trackedView.js';

export const catalogRouter = Router();

const SearchQuery = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

catalogRouter.get(
  '/api/catalog/search',
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (req, res) => {
    const { q, limit } = SearchQuery.parse(req.query);
    const results = await searchCatalog(q, limit);
    res.json({
      results: results.map((p) => ({
        storeProductId: p.storeProductId,
        name: p.name,
        brand: p.brand,
        category: p.category,
        sku: p.sku,
        storeUrl: storeProductUrl(p.storeProductId),
      })),
    });
  }),
);

catalogRouter.post(
  '/api/catalog/refresh',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ products: await refreshCatalog().done });
  }),
);

catalogRouter.get(
  '/api/catalog/:productId',
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (req, res) => {
    const productId = z.coerce.number().int().positive().parse(req.params.productId);
    res.json(await getProductDetails(productId));
  }),
);
