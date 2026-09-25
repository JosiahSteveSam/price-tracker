import { pino } from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined,
  redact: { paths: ['req.headers["x-cron-secret"]', 'req.headers["x-admin-token"]'], remove: true },
  ...(config.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
  }),
});
