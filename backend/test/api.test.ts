import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = vi.hoisted(() => {
  const s = 'test-cron-secret-0123456789';
  process.env.CRON_SECRET = s;
  process.env.ADMIN_TOKEN = 'test-admin-token-0123456789';
  return s;
});

const findCronRun = vi.fn();
const runScrape = vi.fn(async (_opts: unknown) => ({ runId: 'r', status: 'completed' }));
vi.mock('../src/db/runsRepo.js', () => ({
  runsRepo: { findCronRun: (d: Date) => findCronRun(d), latest: async () => null },
}));
vi.mock('../src/scraper/runner.js', async (orig) => ({
  ...(await orig<typeof import('../src/scraper/runner.js')>()),
  runScrape: (o: unknown) => runScrape(o),
}));

const { createApp } = await import('../src/app.js');

let base = '';
let close = () => {};
beforeAll(async () => {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());
beforeEach(() => {
  findCronRun.mockReset();
  runScrape.mockClear();
});

const cron = (headers: Record<string, string> = {}) =>
  fetch(`${base}/api/cron/scrape`, { method: 'POST', headers });

describe('POST /api/cron/scrape', () => {
  it('rejects a missing or wrong secret without starting a run', async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron({ 'x-cron-secret': 'nope' })).status).toBe(401);
    expect(runScrape).not.toHaveBeenCalled();
  });

  it('answers 202 immediately and starts a cron run for a new slot', async () => {
    findCronRun.mockResolvedValue(null);
    const res = await cron({ 'x-cron-secret': SECRET });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(true);
    expect(body.slotKey).toMatch(/T(0[02468]|1[02468]|2[02]):00:00\.000Z$/);
    expect(runScrape).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'cron' }));
  });

  it('answers 200 skipped when the slot already has a run', async () => {
    findCronRun.mockResolvedValue({ id: 'run-1', status: 'completed' });
    const res = await cron({ 'x-cron-secret': SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: 'slot_already_ran', runId: 'run-1' });
    expect(runScrape).not.toHaveBeenCalled();
  });
});

describe('validation and auth on other routes', () => {
  it('rejects a too-short search query with 400', async () => {
    const res = await fetch(`${base}/api/catalog/search?q=a`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('returns 404 for a non-uuid tracked id without hitting the DB', async () => {
    const res = await fetch(`${base}/api/tracked/not-a-uuid`);
    expect(res.status).toBe(404);
  });

  it('requires the admin token to untrack', async () => {
    const res = await fetch(`${base}/api/tracked/2880fc8d-298f-4727-ad76-f5b8bb533b5f`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('validates the track body', async () => {
    const res = await fetch(`${base}/api/tracked`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: 'x', optionId: 'DROP TABLE' }),
    });
    expect(res.status).toBe(400);
  });
});
