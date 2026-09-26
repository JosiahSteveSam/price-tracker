import { Link } from 'react-router';
import { useRuns } from '../api/hooks';
import type { Run, RunStatus } from '../api/types';
import { EmptyState, ErrorState, OutcomeBadge, PageHeader, Skeleton } from '../components/ui';
import { useNow } from '../lib/useNow';
import { formatDateTime, formatDuration, formatRelative, formatTime, utcTitle } from '../lib/format';

const STATUS: Record<RunStatus, { outcome: 'success' | 'retried' | 'failed' | 'running'; label: string }> = {
  running: { outcome: 'running', label: 'Running' },
  completed: { outcome: 'success', label: 'Completed' },
  completed_with_failures: { outcome: 'retried', label: 'Some items failed' },
  interrupted: { outcome: 'failed', label: 'Interrupted' },
  crashed: { outcome: 'failed', label: 'Crashed' },
};

const TRIGGER: Record<Run['trigger'], string> = {
  cron: 'Scheduled',
  manual: 'Manual',
  first_track: 'First scrape',
  cli: 'CLI',
};

type Row = { kind: 'run'; at: string; run: Run } | { kind: 'missed'; at: string };

export function RunsPage() {
  const runs = useRuns(100);
  useNow();

  const rows: Row[] = runs.data
    ? [
        ...runs.data.runs.map((run) => ({ kind: 'run' as const, at: run.slotKey ?? run.startedAt, run })),
        ...runs.data.missedSlots.map((at) => ({ kind: 'missed' as const, at })),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [];

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle={
          runs.data ? (
            <>
              Every scheduled and manual run, including failures and missed slots. Schedule: every{' '}
              {runs.data.schedule.everyMinutes / 60} hours at minute 0 ({runs.data.schedule.timezone}) · next{' '}
              <span title={utcTitle(runs.data.schedule.nextSlot)}>
                {formatTime(runs.data.schedule.nextSlot)} ({formatRelative(runs.data.schedule.nextSlot)})
              </span>
            </>
          ) : (
            'Every scheduled and manual run, including failures and missed slots.'
          )
        }
      />
      {runs.isPending && <Skeleton className="h-64 w-full" />}
      {runs.isError && <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />}
      {runs.data && rows.length === 0 && <EmptyState title="No runs yet" />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-left">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Slot / start</th>
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Items</th>
                <th className="px-3 py-2 text-right font-medium">✓ / ↻ / ✕</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                row.kind === 'missed' ? (
                  <tr key={`m-${row.at}`} className="border-b border-line bg-missed/5">
                    <td className="px-3 py-2 tabular" title={utcTitle(row.at)}>
                      {formatDateTime(row.at)}
                    </td>
                    <td className="px-3 py-2">Scheduled</td>
                    <td className="px-3 py-2">
                      <OutcomeBadge outcome="missed" />
                    </td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-muted">No trigger received for this slot</td>
                  </tr>
                ) : (
                  <tr key={row.run.id} className="border-b border-line">
                    <td className="px-3 py-2 tabular" title={utcTitle(row.run.startedAt)}>
                      {formatDateTime(row.at)}
                    </td>
                    <td className="px-3 py-2">
                      {TRIGGER[row.run.trigger]}
                      {row.run.host && <span className="text-xs text-muted"> · {row.run.host}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <OutcomeBadge outcome={STATUS[row.run.status].outcome} label={STATUS[row.run.status].label} />
                    </td>
                    <td className="px-3 py-2 text-right tabular">{row.run.itemsTotal}</td>
                    <td className="px-3 py-2 text-right tabular">
                      <span className="text-success">{row.run.itemsSuccess}</span> /{' '}
                      <span className="text-retried">{row.run.itemsRetried}</span> /{' '}
                      <span className={row.run.itemsFailed ? 'text-failed' : ''}>{row.run.itemsFailed}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular">{formatDuration(row.run.durationMs)}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-xs text-muted" title={row.run.errorMessage ?? undefined}>
                      {row.run.errorMessage ?? ''}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">
        Per-item details for each run are in the scrape log on each item’s page —{' '}
        <Link to="/" className="text-primary hover:underline">
          back to the dashboard
        </Link>
        .
      </p>
    </>
  );
}
