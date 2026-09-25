import { Router } from 'express';
import { z } from 'zod';
import { runsRepo } from '../db/runsRepo.js';
import { asyncHandler } from '../http.js';
import { activeRun, SLOT_MS, slotKeyFor } from '../scraper/runner.js';
import { missedSlots, runView } from '../services/runsView.js';

export const runsRouter = Router();

runsRouter.get(
  '/api/runs',
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
    const runs = await runsRepo.list(Math.max(limit, 120));
    const now = new Date();
    res.json({
      runs: runs.slice(0, limit).map(runView),
      missedSlots: missedSlots(runs, now),
      schedule: {
        everyMinutes: SLOT_MS / 60_000,
        timezone: 'UTC',
        nextSlot: new Date(slotKeyFor(now).getTime() + SLOT_MS).toISOString(),
      },
      active: activeRun(),
    });
  }),
);
