import { config } from '../config.js';
import { attemptsRepo } from '../db/attemptsRepo.js';
import { runsRepo } from '../db/runsRepo.js';
import { trackedRepo } from '../db/trackedRepo.js';
import type { NewAttempt, RunStatus, RunTrigger, ScrapeRun, TrackedItem } from '../db/types.js';
import { logger } from '../logger.js';
import { BrowserManager } from './browser.js';
import { ScrapeError, toScrapeError, type ErrorCode } from './errors.js';
import { sleep } from './retry.js';
import { scrapeGroup, type AttemptResult } from './scrapeGroup.js';

// Run orchestration — docs/07-SCRAPER-SPEC.md §Run orchestration. Invariant: every item planned for a run
// ends up with exactly one scrape_attempts row, even when the run crashes (recovered by the next run).

export const SLOT_MS = 2 * 60 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;
const DUE_SLACK_MS = 5 * 60 * 1000;
const HEARTBEAT_EVERY_MS = 60 * 1000;

/** The 2 h UTC slot a cron trigger belongs to (00:00, 02:00, …). A late trigger still maps to its slot. */
export const slotKeyFor = (at: Date) => new Date(Math.floor(at.getTime() / SLOT_MS) * SLOT_MS);

export const runHost = () => (process.env.RENDER ? 'render' : process.env.GITHUB_ACTIONS ? 'gha' : 'local');

export interface RunOptions {
  trigger: RunTrigger;
  /** Scrape exactly these tracked items (manual / first_track / cli). Omit for "all due items". */
  itemIds?: string[];
  now?: Date;
  headed?: boolean;
  slowMo?: number;
  artifactsDir?: string;
}

export type RunSummary =
  | { skipped: 'slot_already_ran'; slotKey: string }
  | { runId: string; status: RunStatus; total: number; success: number; retried: number; failed: number };

// One run at a time per process: a second Chromium would not fit in 512 MB.
let queue: Promise<unknown> = Promise.resolve();
let active: { runId: string | null; trigger: RunTrigger } | null = null;
export const activeRun = () => active;

export function runScrape(opts: RunOptions): Promise<RunSummary> {
  const next = queue.then(() => runScrapeNow(opts));
  queue = next.catch(() => {});
  return next;
}

/**
 * Claims the run row synchronously-ish (so the cron endpoint can answer 202 with a runId) and returns the
 * promise of the full run. Cron: returns null when the slot already ran.
 */
async function runScrapeNow(opts: RunOptions): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const host = runHost();
  const log = logger.child({ trigger: opts.trigger });

  await recoverStaleRuns(now).catch((err) => log.error({ err }, 'stale-run recovery failed'));

  let run: ScrapeRun | null;
  const slotKey = opts.trigger === 'cron' ? slotKeyFor(now) : null;
  if (slotKey) {
    run = await runsRepo.createCronRun(slotKey, host);
    if (!run) {
      log.info({ slotKey }, 'slot already has a run — skipping');
      return { skipped: 'slot_already_ran', slotKey: slotKey.toISOString() };
    }
  } else {
    run = await runsRepo.create(opts.trigger as Exclude<RunTrigger, 'cron'>, host);
  }
  const runLog = log.child({ runId: run.id });
  active = { runId: run.id, trigger: opts.trigger };

  const heartbeat = setInterval(() => void runsRepo.heartbeat(run.id).catch(() => {}), HEARTBEAT_EVERY_MS);
  const browser = new BrowserManager({ headless: !opts.headed, slowMo: opts.slowMo });
  const written = new Set<string>();
  let items: TrackedItem[] = [];
  let signature: string | null = null;

  try {
    items = opts.itemIds
      ? (await Promise.all(opts.itemIds.map((id) => trackedRepo.get(id)))).filter(
          (i): i is TrackedItem => !!i,
        )
      : await trackedRepo.findDue(new Date(now.getTime() + DUE_SLACK_MS));
    await runsRepo.setPlan(
      run.id,
      items.map((i) => i.id),
    );
    runLog.info({ items: items.length }, 'run started');

    const deadline = Date.now() + config.SCRAPE_RUN_BUDGET_MS;
    const groups = groupByProduct(items);
    for (const [gi, [storeProductId, group]] of groups.entries()) {
      if (Date.now() > deadline) {
        for (const item of group) {
          await writeFailure(
            run.id,
            item,
            'RUN_BUDGET_EXCEEDED',
            'run time budget exhausted before this item',
            written,
          );
        }
        continue;
      }
      if (gi > 0) await sleep(1000 + Math.random() * 2000); // polite pacing between products

      const results = await scrapeGroup(
        browser,
        storeProductId,
        group.map((i) => ({ id: i.id, optionId: i.optionId, optionLabel: i.optionLabel })),
        {
          headed: !!opts.headed,
          artifactsDir: opts.artifactsDir,
          log: (msg, data) => runLog.info({ product: storeProductId, ...data }, msg),
        },
      );
      for (const r of results) {
        const item = group.find((i) => i.id === r.item.id)!;
        await attemptsRepo.insert(toNewAttempt(run.id, item.id, r));
        written.add(item.id);
        signature = r.pageSignature ?? signature;
        if (r.productName && r.productName !== item.productName) {
          await trackedRepo.updateProductName(item.id, r.productName);
        }
        if (slotKey) {
          await trackedRepo.setNextDue(
            item.id,
            new Date(slotKey.getTime() + item.scrapeIntervalMinutes * 60_000),
          );
        }
        runLog.info(
          {
            item: item.id,
            outcome: r.outcome,
            tries: r.tries.length,
            price: r.value ? r.value.priceMinor / 100 : null,
            code: r.error?.code,
          },
          'attempt recorded',
        );
      }
      await runsRepo.heartbeat(run.id);
    }

    const counts = await attemptsRepo.countsForRun(run.id);
    const status: RunStatus = counts.failed > 0 ? 'completed_with_failures' : 'completed';
    await runsRepo.finish(run.id, {
      status,
      itemsTotal: items.length,
      itemsSuccess: counts.success,
      itemsRetried: counts.retried,
      itemsFailed: counts.failed,
      manifestSignature: signature,
    });
    runLog.info({ status, ...counts }, 'run finished');
    return { runId: run.id, status, ...counts };
  } catch (err) {
    // Never fail silently: every planned item without a row gets an honest failed attempt.
    const e = toScrapeError(err);
    runLog.error({ err }, 'run crashed');
    for (const item of items) {
      await writeFailure(run.id, item, 'RUN_CRASHED', `run crashed: ${e.message}`, written).catch(() => {});
    }
    const counts = await attemptsRepo
      .countsForRun(run.id)
      .catch(() => ({ total: 0, success: 0, retried: 0, failed: 0 }));
    await runsRepo
      .finish(run.id, {
        status: 'crashed',
        itemsTotal: items.length,
        itemsSuccess: counts.success,
        itemsRetried: counts.retried,
        itemsFailed: counts.failed,
        manifestSignature: signature,
        errorMessage: e.message,
      })
      .catch(() => {});
    return { runId: run.id, status: 'crashed', ...counts };
  } finally {
    clearInterval(heartbeat);
    await browser.close();
    active = null;
  }
}

/**
 * Runs left in `running` with a stale heartbeat died mid-way (deploy, OOM, crash). Mark them interrupted and
 * write a failed RUN_INTERRUPTED attempt for every planned item that never got one.
 */
export async function recoverStaleRuns(now = new Date()): Promise<number> {
  const stale = await runsRepo.findStale(new Date(now.getTime() - STALE_AFTER_MS));
  for (const run of stale) {
    const done = await attemptsRepo.trackedItemIdsInRun(run.id);
    for (const itemId of run.plannedItemIds.filter((id) => !done.has(id))) {
      await attemptsRepo.insert({
        runId: run.id,
        trackedItemId: itemId,
        startedAt: run.heartbeatAt,
        finishedAt: run.heartbeatAt,
        tries: [
          {
            n: 1,
            startedAt: run.heartbeatAt,
            durationMs: 0,
            ok: false,
            errorCode: 'RUN_INTERRUPTED',
            message: `recovered by a later run at ${now.toISOString()}`,
          },
        ],
        outcome: 'failed',
        errorCode: 'RUN_INTERRUPTED',
        errorMessage:
          'the scraper process stopped before this item was scraped (e.g. restart or out of memory)',
      });
    }
    const counts = await attemptsRepo.countsForRun(run.id);
    await runsRepo.finish(run.id, {
      status: 'interrupted',
      itemsTotal: run.plannedItemIds.length,
      itemsSuccess: counts.success,
      itemsRetried: counts.retried,
      itemsFailed: counts.failed,
      manifestSignature: run.manifestSignature,
      errorMessage: `no heartbeat since ${run.heartbeatAt}; recovered at ${now.toISOString()}`,
    });
    logger.warn(
      { runId: run.id, recovered: run.plannedItemIds.length - done.size },
      'recovered interrupted run',
    );
  }
  return stale.length;
}

async function writeFailure(
  runId: string,
  item: TrackedItem,
  code: ErrorCode,
  message: string,
  written: Set<string>,
) {
  if (written.has(item.id)) return;
  const at = new Date().toISOString();
  await attemptsRepo.insert({
    runId,
    trackedItemId: item.id,
    startedAt: at,
    finishedAt: at,
    tries: [{ n: 1, startedAt: at, durationMs: 0, ok: false, errorCode: code, message }],
    outcome: 'failed',
    errorCode: code,
    errorMessage: message,
  });
  written.add(item.id);
}

export function toNewAttempt(runId: string, trackedItemId: string, r: AttemptResult): NewAttempt {
  const base = {
    runId,
    trackedItemId,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    tries: r.tries,
    pageSignature: r.pageSignature,
  };
  if (r.outcome === 'failed' || !r.value) {
    const e = r.error ?? new ScrapeError('UNKNOWN', 'no value and no error');
    return { ...base, outcome: 'failed', errorCode: e.code, errorMessage: e.message };
  }
  return {
    ...base,
    outcome: r.outcome,
    priceMinor: r.value.priceMinor,
    mrpMinor: r.value.mrpMinor,
    currency: r.value.currency,
    stockStatus: r.value.stockStatus,
    stockQty: r.value.stockQty,
    stockText: r.value.stockText,
    errorCode: r.lastError?.code ?? null,
    errorMessage: r.lastError?.message ?? null,
  };
}

export function groupByProduct(items: TrackedItem[]): [number, TrackedItem[]][] {
  const map = new Map<number, TrackedItem[]>();
  for (const item of items) map.set(item.storeProductId, [...(map.get(item.storeProductId) ?? []), item]);
  return [...map.entries()];
}
