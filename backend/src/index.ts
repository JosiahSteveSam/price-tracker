import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { recoverStaleRuns } from './scraper/runner.js';

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
  // A previous instance may have died mid-run (deploy, OOM): record its unfinished items honestly.
  if (config.SUPABASE_URL) {
    void recoverStaleRuns()
      .then((n) => n && logger.warn({ recovered: n }, 'recovered stale runs on boot'))
      .catch((err) => logger.error({ err }, 'boot recovery failed'));
  }
});

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
