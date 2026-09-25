import { Router } from 'express';
import { runsRepo } from '../db/runsRepo.js';
import { activeRun } from '../scraper/runner.js';

const startedAt = new Date();

export const healthRouter = Router();

// Target of the 10-minute keep-warm ping: always 200 while the process is up, even if the DB is unreachable.
healthRouter.get('/healthz', async (_req, res) => {
  const lastRun = await runsRepo.latest().catch(() => undefined);
  res.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    uptimeSec: Math.round(process.uptime()),
    db: lastRun !== undefined,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          trigger: lastRun.trigger,
          status: lastRun.status,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
        }
      : null,
    activeRun: activeRun(),
  });
});
