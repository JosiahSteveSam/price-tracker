import { Router } from 'express';
import { requireCronSecret } from '../auth.js';
import { runsRepo } from '../db/runsRepo.js';
import { asyncHandler } from '../http.js';
import { logger } from '../logger.js';
import { runScrape, slotKeyFor } from '../scraper/runner.js';

export const cronRouter = Router();

/**
 * Called by cron-job.org every 2 h (minute 0, UTC). Answers immediately — cron-job.org gives up after 30 s and a
 * run takes minutes — and scrapes in the background. The unique slot index makes duplicate triggers harmless;
 * the pre-check here just lets us answer 200 "skipped" instead of 202 for an already-run slot.
 */
cronRouter.post(
  '/api/cron/scrape',
  requireCronSecret,
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const slotKey = slotKeyFor(now);
    const existing = await runsRepo.findCronRun(slotKey);
    if (existing) {
      res.status(200).json({
        skipped: 'slot_already_ran',
        slotKey: slotKey.toISOString(),
        runId: existing.id,
        status: existing.status,
      });
      return;
    }
    void runScrape({ trigger: 'cron', now })
      .then((summary) => logger.info({ summary }, 'cron run done'))
      .catch((err) => logger.error({ err }, 'cron run failed to start'));
    res.status(202).json({ accepted: true, slotKey: slotKey.toISOString() });
  }),
);
