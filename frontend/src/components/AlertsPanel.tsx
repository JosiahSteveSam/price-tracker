import { Link } from 'react-router';
import { useAlerts } from '../api/hooks';
import type { Alert } from '../api/types';
import { formatDateTime, formatRelative, utcTitle } from '../lib/format';
import { Card, Skeleton } from './ui';

const KIND: Record<Alert['type'], { icon: string; label: string; cls: string }> = {
  price_drop: { icon: '▼', label: 'Price drop', cls: 'text-price-down' },
  back_in_stock: { icon: '●', label: 'Back in stock', cls: 'text-success' },
  structure_change: { icon: '⚠', label: 'Store changed', cls: 'text-retried' },
};

/** Dashboard banner when the store's page structure changed recently (bonus: change detection). */
export function StructureBanner({ now }: { now: number }) {
  const alerts = useAlerts();
  const recent = alerts.data?.filter(
    (a) => a.type === 'structure_change' && now - Date.parse(a.createdAt) < 24 * 3_600_000,
  );
  if (!recent?.length) return null;
  return (
    <div role="status" className="mb-4 rounded-lg border border-retried/30 bg-retried/10 p-3 text-sm">
      <p className="font-medium text-retried">⚠ Store page structure changed in the last 24 h</p>
      <p className="mt-1 text-muted">{recent[0]!.message}</p>
    </div>
  );
}

export function AlertsList({ trackedId, title = 'Alerts', now }: { trackedId?: string; title?: string; now: number }) {
  const alerts = useAlerts(trackedId);
  return (
    <Card className="p-4">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{title}</h2>
      {alerts.isPending && <Skeleton className="mt-3 h-16 w-full" />}
      {alerts.isError && <p className="mt-2 text-xs text-failed">Couldn’t load alerts.</p>}
      {alerts.data?.length === 0 && (
        <p className="mt-2 text-muted">No alerts yet — price drops and restocks appear here.</p>
      )}
      {alerts.data && alerts.data.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {alerts.data.slice(0, 8).map((a) => {
            const k = KIND[a.type];
            const body = (
              <>
                <span className={`font-medium ${k.cls}`}>
                  <span aria-hidden="true">{k.icon}</span> {k.label}
                </span>{' '}
                <span>{a.message}</span>
              </>
            );
            return (
              <li key={a.id} className="py-2 text-sm">
                {a.trackedItemId && !trackedId ? (
                  <Link to={`/items/${a.trackedItemId}`} className="hover:underline">
                    {body}
                  </Link>
                ) : (
                  body
                )}
                <div className="text-xs text-muted" title={utcTitle(a.createdAt)}>
                  {formatDateTime(a.createdAt)} · {formatRelative(a.createdAt, now)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
