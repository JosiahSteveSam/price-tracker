// Derives alerts from history that was stored before the alert feature existed. Idempotent (skips
// attempts that already have an alert of that type). Usage: npm run alerts:backfill
import { attemptsRepo } from '../db/attemptsRepo.js';
import { trackedRepo } from '../db/trackedRepo.js';
import { onAttemptStored } from '../services/alertService.js';

const items = await trackedRepo.list({ activeOnly: false });
let created = 0;
for (const item of items) {
  for (const attempt of await attemptsRepo.historyForItem(item.id)) {
    created += await onAttemptStored(item, attempt);
  }
}
console.log(`backfill complete: ${created} alert(s) created across ${items.length} item(s)`);
