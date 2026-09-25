import { Router } from 'express';
import { z } from 'zod';
import { rateLimit, requireAdmin } from '../auth.js';
import { attemptsRepo } from '../db/attemptsRepo.js';
import { trackedRepo } from '../db/trackedRepo.js';
import { asyncHandler, HttpError } from '../http.js';
import { logger } from '../logger.js';
import { runScrape } from '../scraper/runner.js';
import { createTracked } from '../services/trackedService.js';
import { attemptView, itemView, trackedHistory, trackedSummary } from '../services/trackedView.js';

export const trackedRouter = Router();

const Uuid = z.uuid();

async function loadItem(id: unknown) {
  const parsed = Uuid.safeParse(id);
  const item = parsed.success ? await trackedRepo.get(parsed.data) : null;
  if (!item) throw new HttpError(404, 'NOT_FOUND', 'Tracked item not found');
  return item;
}

/** Background scrape — never blocks the response; failures are recorded as attempts by the runner. */
function scrapeInBackground(trigger: 'first_track' | 'manual', itemId: string) {
  void runScrape({ trigger, itemIds: [itemId] }).catch((err) =>
    logger.error({ err, itemId, trigger }, 'background scrape failed'),
  );
}

trackedRouter.get(
  '/api/tracked',
  asyncHandler(async (_req, res) => {
    const items = await trackedRepo.list();
    res.json({ items: await Promise.all(items.map(trackedSummary)) });
  }),
);

const TrackBody = z.object({
  productId: z.coerce.number().int().positive(),
  optionId: z.string().regex(/^o\d{1,3}$/, 'invalid option id'),
});

trackedRouter.post(
  '/api/tracked',
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const { productId, optionId } = TrackBody.parse(req.body);
    const item = await createTracked(productId, optionId);
    scrapeInBackground('first_track', item.id);
    res.status(201).json({ item: itemView(item), firstScrape: 'started' });
  }),
);

trackedRouter.get(
  '/api/tracked/:id',
  asyncHandler(async (req, res) => {
    res.json(await trackedSummary(await loadItem(req.params.id)));
  }),
);

trackedRouter.delete(
  '/api/tracked/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const item = await loadItem(req.params.id);
    await trackedRepo.setActive(item.id, false); // soft delete: history is kept
    res.json({ item: { ...itemView(item), isActive: false } });
  }),
);

trackedRouter.get(
  '/api/tracked/:id/history',
  asyncHandler(async (req, res) => {
    const item = await loadItem(req.params.id);
    const since = z.iso.datetime({ offset: true }).optional().parse(req.query.since);
    res.json({ itemId: item.id, points: await trackedHistory(item.id, since) });
  }),
);

const AttemptsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime({ offset: true }).optional(),
});

trackedRouter.get(
  '/api/tracked/:id/attempts',
  asyncHandler(async (req, res) => {
    const item = await loadItem(req.params.id);
    const { limit, before } = AttemptsQuery.parse(req.query);
    const attempts = await attemptsRepo.listForItem(item.id, { limit, before });
    res.json({
      itemId: item.id,
      attempts: attempts.map(attemptView),
      nextBefore: attempts.length === limit ? attempts.at(-1)!.finishedAt : null,
    });
  }),
);

trackedRouter.post(
  '/api/tracked/:id/scrape-now',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const item = await loadItem(req.params.id);
    scrapeInBackground('manual', item.id);
    res.status(202).json({ accepted: true, itemId: item.id });
  }),
);
