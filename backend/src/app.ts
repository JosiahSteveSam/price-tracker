import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { errorHandler, notFound } from './http.js';
import { catalogRouter } from './routes/catalog.js';
import { cronRouter } from './routes/cron.js';
import { exportRouter } from './routes/export.js';
import { healthRouter } from './routes/health.js';
import { runsRouter } from './routes/runs.js';
import { trackedRouter } from './routes/tracked.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render terminates TLS in front of us
  app.use(cors({ origin: config.CORS_ORIGIN, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '32kb' }));

  app.use(healthRouter);
  app.use(cronRouter);
  app.use(catalogRouter);
  app.use(trackedRouter);
  app.use(runsRouter);
  app.use(exportRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
