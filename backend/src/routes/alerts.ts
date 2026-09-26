import { Router } from 'express';
import { z } from 'zod';
import { alertsRepo } from '../db/alertsRepo.js';
import { asyncHandler } from '../http.js';

export const alertsRouter = Router();

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  trackedId: z.uuid().optional(),
});

alertsRouter.get(
  '/api/alerts',
  asyncHandler(async (req, res) => {
    const { limit, trackedId } = Query.parse(req.query);
    res.json({ alerts: await alertsRepo.list({ limit, trackedItemId: trackedId }) });
  }),
);
