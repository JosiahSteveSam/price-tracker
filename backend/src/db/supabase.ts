import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let client: SupabaseClient | null = null;

/** Service-role client (bypasses RLS). Server-only — never expose this key. */
export function db(): SupabaseClient {
  if (!client) {
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export class DbError extends Error {
  constructor(
    readonly op: string,
    readonly pg: PostgrestError,
  ) {
    super(`${op}: ${pg.message}${pg.code ? ` (${pg.code})` : ''}`);
  }
  get code() {
    return this.pg.code;
  }
}

/** Postgres error codes we branch on. */
export const PG = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
} as const;

/**
 * Unwraps a Supabase response or throws a DbError naming the operation.
 * The schema is untyped on purpose: rows are mapped in db/mappers.ts, the single place that knows columns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unwrap<T = any>(res: { data: unknown; error: PostgrestError | null }, op: string): T {
  if (res.error) throw new DbError(op, res.error);
  return res.data as T;
}

/** Money is stored as numeric(12,2); send exact decimal strings, never floats. */
export const minorToDecimal = (minor: number) => {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError(`invalid minor amount: ${minor}`);
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
};
export const decimalToNumber = (v: string | number | null) => (v === null ? null : Number(v));
