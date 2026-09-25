// Scraper CLI — headed mode for the recording, dry runs, seeding, and saved runs.
//
//   npm run scrape -- --product 2312 --option o3            dry run (nothing saved), headless
//   npm run scrape:headed -- --product 2312 --option o3     same, visible browser + on-page overlay
//   npm run scrape:headed -- --all --simulate fail          demo: first quote returns 503 (never saved)
//   npm run scrape -- --all --save                          real run over all active tracked items (trigger=cli)
//   npm run scrape -- --save --trigger cron                 scheduled run for due items (GitHub Actions fallback)
//   npm run scrape -- --track --product 2312 --option o3    start tracking an option
//   npm run scrape -- --list                                show tracked items
//   npm run scrape -- --recover                             recover stale (interrupted) runs now
import { parseArgs } from 'node:util';
import { trackedRepo } from '../db/trackedRepo.js';
import { HttpError } from '../http.js';
import { BrowserManager } from '../scraper/browser.js';
import { scrapeGroup, type GroupItem } from '../scraper/scrapeGroup.js';
import { recoverStaleRuns, runScrape } from '../scraper/runner.js';
import { storeApi } from '../scraper/storeApi.js';
import { createTracked } from '../services/trackedService.js';

const { values: args } = parseArgs({
  options: {
    headed: { type: 'boolean', default: false },
    slowmo: { type: 'string' },
    all: { type: 'boolean', default: false },
    item: { type: 'string', multiple: true },
    product: { type: 'string' },
    option: { type: 'string', multiple: true },
    save: { type: 'boolean', default: false },
    trigger: { type: 'string', default: 'cli' },
    simulate: { type: 'string' },
    track: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    recover: { type: 'boolean', default: false },
  },
  strict: true,
});

const fail = (msg: string): never => {
  console.error(`error: ${msg}`);
  process.exit(2);
};

async function main() {
  if (args.list) {
    const items = await trackedRepo.list({ activeOnly: false });
    console.table(
      items.map((i) => ({
        id: i.id,
        product: i.storeProductId,
        name: i.productName,
        option: `${i.optionId} ${i.optionLabel}`,
        active: i.isActive,
        nextDue: i.nextDueAt,
      })),
    );
    return;
  }
  if (args.recover) {
    console.log(`recovered ${await recoverStaleRuns()} stale run(s)`);
    return;
  }
  if (args.track) {
    if (!args.product || !args.option?.length) fail('--track needs --product <id> --option <optionId>');
    for (const optionId of args.option!) {
      try {
        const item = await createTracked(Number(args.product), optionId);
        console.log(`tracking ${item.id}  ${item.productName} [${item.optionAxis}: ${item.optionLabel}]`);
      } catch (err) {
        console.error(err instanceof HttpError ? `${optionId}: ${err.code} — ${err.message}` : err);
      }
    }
    return;
  }

  const simulate = args.simulate as 'slow' | 'fail' | undefined;
  if (simulate && !['slow', 'fail'].includes(simulate)) fail('--simulate must be "slow" or "fail"');
  if (simulate && args.save)
    fail('--simulate cannot be combined with --save (simulated faults never reach the database)');
  const slowMo = args.slowmo ? Number(args.slowmo) : args.headed ? 40 : 0;

  if (args.save) {
    if (args.trigger !== 'cli' && args.trigger !== 'cron') fail('--trigger must be "cli" or "cron"');
    let itemIds: string[] | undefined = args.item;
    if (args.trigger === 'cli' && !itemIds?.length) {
      if (!args.all) fail('--save needs --all or --item <trackedId> (or --trigger cron for due items)');
      itemIds = (await trackedRepo.list()).map((i) => i.id);
    }
    const summary = await runScrape({
      trigger: args.trigger as 'cli' | 'cron',
      itemIds: args.trigger === 'cron' ? undefined : itemIds,
      headed: args.headed,
      slowMo,
      artifactsDir: 'artifacts',
    });
    console.log('\nRUN SUMMARY', summary);
    return;
  }

  // Dry run: scrape and print, write nothing.
  const groups = new Map<number, GroupItem[]>();
  if (args.product) {
    const product = await storeApi.getItem(Number(args.product));
    const wanted = args.option?.length ? args.option : [product.options[0]!.id];
    for (const w of wanted) {
      const opt = product.options.find((o) => o.id === w || o.label.toLowerCase() === w.toLowerCase());
      if (!opt)
        fail(
          `option "${w}" not found; available: ${product.options.map((o) => `${o.id}=${o.label}`).join(', ')}`,
        );
      groups.set(product.id, [
        ...(groups.get(product.id) ?? []),
        { optionId: opt!.id, optionLabel: opt!.label },
      ]);
    }
  } else if (args.all || args.item?.length) {
    const items = args.all
      ? await trackedRepo.list()
      : await Promise.all(args.item!.map((id) => trackedRepo.get(id)));
    for (const i of items) {
      if (!i) continue;
      groups.set(i.storeProductId, [
        ...(groups.get(i.storeProductId) ?? []),
        { id: i.id, optionId: i.optionId, optionLabel: i.optionLabel },
      ]);
    }
  } else {
    fail('nothing to scrape: use --product <id> [--option <id|label>], --item <trackedId>, or --all');
  }

  console.log(
    `DRY RUN${simulate ? ` [SIMULATED ${simulate}]` : ''} — nothing will be saved. ${args.headed ? 'Headed.' : 'Headless.'}`,
  );
  const browser = new BrowserManager({ headless: !args.headed, slowMo });
  const rows: Record<string, unknown>[] = [];
  try {
    for (const [productId, items] of groups) {
      const results = await scrapeGroup(browser, productId, items, {
        headed: args.headed,
        simulate,
        artifactsDir: 'artifacts',
        log: (msg, data) => console.log(`  [${productId}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`),
      });
      for (const r of results) {
        rows.push({
          product: productId,
          option: `${r.item.optionId} ${r.item.optionLabel}`,
          outcome: r.outcome,
          tries: r.tries.length,
          price: r.value ? r.value.priceMinor / 100 : '',
          mrp: r.value?.mrpMinor ? r.value.mrpMinor / 100 : '',
          stock: r.value ? `${r.value.stockStatus}:${r.value.stockQty}` : '',
          error: r.error ? `${r.error.code}: ${r.error.message}` : (r.lastError?.code ?? ''),
        });
      }
    }
  } finally {
    await browser.close();
  }
  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
