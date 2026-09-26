import { Link } from 'react-router';
import { apiUrl } from '../api/client';
import { useRuns, useTracked } from '../api/hooks';
import type { TrackedSummary } from '../api/types';
import {
  Card,
  EmptyState,
  ErrorState,
  OutcomeBadge,
  PageHeader,
  PriceChange,
  Skeleton,
  Sparkline,
} from '../components/ui';
import { buttonCls } from '../lib/styles';
import { useNow } from '../lib/useNow';
import { formatMoney, formatRelative, formatStock, formatTime, humanizeCode, utcTitle } from '../lib/format';

function ItemCard({ item }: { item: TrackedSummary }) {
  const latest = item.latest;
  return (
    <Link
      to={`/items/${item.id}`}
      className="group block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-primary/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold group-hover:text-primary">{item.productName}</h2>
          <p className="truncate text-muted">
            {item.optionAxis}: <span className="text-text">{item.optionLabel}</span>
          </p>
          <p className="truncate text-xs text-muted">
            {[item.brand, item.category, `#${item.storeProductId}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {item.lastAttempt && <OutcomeBadge outcome={item.lastAttempt.outcome} />}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[28px] leading-8 font-semibold tabular">
            {latest ? formatMoney(latest.price, latest.currency) : '—'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {latest ? (
              <>
                <span title={utcTitle(latest.at)}>{formatRelative(latest.at)}</span>
                <PriceChange latest={latest.price} previous={item.previousPrice} currency={latest.currency} />
              </>
            ) : (
              'No valid reading yet'
            )}
          </div>
        </div>
        <Sparkline points={item.sparkline} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
        <span className={latest?.stockStatus === 'out_of_stock' ? 'text-failed' : latest ? 'text-success' : 'text-muted'}>
          {latest ? formatStock(latest.stockStatus, latest.stockQty, latest.stockText) : 'Stock unknown'}
        </span>
        <span className="text-muted">
          {item.successRate === null
            ? 'No attempts yet'
            : `${Math.round(item.successRate * 100)}% valid (last ${item.attemptsCounted})`}
        </span>
      </div>
      {item.lastAttempt?.outcome === 'failed' && (
        <p className="mt-2 text-xs text-failed">Last attempt failed: {humanizeCode(item.lastAttempt.errorCode)}</p>
      )}
    </Link>
  );
}

export function DashboardPage() {
  const tracked = useTracked();
  useNow(); // re-render relative times every 30 s
  const runs = useRuns(5);
  const next = runs.data?.schedule.nextSlot;
  const lastRun = runs.data?.runs[0];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            Tracking {tracked.data?.length ?? '…'} item{tracked.data?.length === 1 ? '' : 's'} · scraped every 2 hours
            {next && (
              <span title={utcTitle(next)}>
                {' '}
                · next run {formatTime(next)} ({formatRelative(next)})
              </span>
            )}
            {lastRun && (
              <span title={utcTitle(lastRun.startedAt)}>
                {' '}
                · last run {formatRelative(lastRun.startedAt)}: {lastRun.itemsSuccess + lastRun.itemsRetried}/
                {lastRun.itemsTotal} valid
              </span>
            )}
          </>
        }
        actions={
          <>
            <a href={apiUrl('/api/export.csv')} className={buttonCls.secondary}>
              Export CSV
            </a>
            <Link to="/track" className={buttonCls.primary}>
              Track a product
            </Link>
          </>
        }
      />

      {tracked.isPending && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/3" />
              <Skeleton className="mt-6 h-8 w-1/2" />
              <Skeleton className="mt-4 h-4 w-full" />
            </Card>
          ))}
        </div>
      )}
      {tracked.isError && <ErrorState error={tracked.error} onRetry={() => void tracked.refetch()} />}
      {tracked.data?.length === 0 && (
        <EmptyState title="Nothing tracked yet">
          <Link to="/track" className="text-primary hover:underline">
            Track a product
          </Link>{' '}
          to start collecting its price history.
        </EmptyState>
      )}
      {tracked.data && tracked.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tracked.data.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
