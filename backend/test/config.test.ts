import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults in development and treats empty strings as unset', () => {
    const c = loadConfig({ SUPABASE_URL: '', CORS_ORIGIN: 'http://a.test, http://b.test' });
    expect(c.PORT).toBe(3000);
    expect(c.HEADLESS).toBe(true);
    expect(c.SUPABASE_URL).toBeUndefined();
    expect(c.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
  });

  it('requires secrets in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SUPABASE_URL: required in production/);
  });

  it('parses HEADLESS=false', () => {
    expect(loadConfig({ HEADLESS: 'false' }).HEADLESS).toBe(false);
  });
});
