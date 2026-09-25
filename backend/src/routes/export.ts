import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../auth.js';
import { asyncHandler } from '../http.js';
import { logger } from '../logger.js';
import { exportFilename, writeCsv } from '../services/exportService.js';

export const exportRouter = Router();

exportRouter.get(
  '/api/export.csv',
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const trackedId = z
      .uuid()
      .optional()
      .parse(req.query.trackedId || undefined);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename()}"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const rows = await writeCsv(res, trackedId);
      logger.info({ rows, trackedId }, 'csv exported');
    } catch (err) {
      // Headers are already sent — end the stream with a visible marker rather than a silently short file.
      logger.error({ err }, 'csv export failed mid-stream');
      res.write('\r\n# EXPORT INCOMPLETE: server error while reading history\r\n');
    }
    res.end();
  }),
);
