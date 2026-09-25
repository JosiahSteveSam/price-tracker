import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    STORE_BASE_URL: z.url().default('https://demo.inelabteamdev.com'),

    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

    CRON_SECRET: z.string().min(16).optional(),
    ADMIN_TOKEN: z.string().min(16).optional(),

    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    HEADLESS: bool.default(true),
    SCRAPE_MAX_TRIES: z.coerce.number().int().min(1).max(10).default(4),
    SCRAPE_TRY_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(90_000),
    SCRAPE_RUN_BUDGET_MS: z.coerce.number().int().min(60_000).default(900_000),
    MAX_TRACKED_ITEMS: z.coerce.number().int().min(1).default(12),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'ADMIN_TOKEN'] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `SUPABASE_URL=` in .env) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();
