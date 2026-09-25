import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from './config.js';
import { HttpError } from './http.js';

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** Requires a shared secret header (constant-time compare). Refuses everything if the secret isn't configured. */
function requireSecret(header: string, secret: () => string | undefined, what: string): RequestHandler {
  return (req, _res, next) => {
    const expected = secret();
    const given = req.get(header);
    if (!expected)
      return next(new HttpError(503, 'NOT_CONFIGURED', `${what} is not configured on this server`));
    if (!given || !safeEqual(given, expected))
      return next(new HttpError(401, 'UNAUTHORIZED', `Missing or invalid ${header}`));
    next();
  };
}

export const requireCronSecret = requireSecret('x-cron-secret', () => config.CRON_SECRET, 'CRON_SECRET');
export const requireAdmin = requireSecret('x-admin-token', () => config.ADMIN_TOKEN, 'ADMIN_TOKEN');

/** Tiny fixed-window rate limiter per client IP (single instance, in memory). */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return next();
    }
    if (++entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests — slow down.'));
    }
    next();
  };
}
