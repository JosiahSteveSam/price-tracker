import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiUrl } from '../api/client';
import { useAttempts, useHistory, useProduct, useTrackedItem } from '../api/hooks';
import type { HistoryPoint } from '../api/types';
import { PriceChart } from '../components/PriceChart';
import { ScrapeLogTable } from '../components/ScrapeLogTable';
import { Card, EmptyState, ErrorState, OutcomeBadge, PriceChange, Skeleton } from '../components/ui';
import { formatDateTime, formatMoney, formatRelative, formatStock, utcTitle } from '../lib/format';
import { buttonCls } from '../lib/styles';
import { useNow } from '../lib/useNow';

type Tab = 'log' | 'prices' | 'info';

function PriceTable({ points, currency }: { points: HistoryPoint[]; currency: string | null }) {
  const valid = points.filter((p) => p.outcome !== 'failed').reverse();
  if (!valid.length) return <EmptyState title="No valid readings yet" />;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] text-left">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">MRP</th>
            <th className="px-3 py-2 font-medium">Change</th>
            <th className="px-3 py-2 font-medium">Stock</th>
          </tr>
        </thead>
        <tbody>
          {valid.map((p, i) => (
            <tr key={p.t} className="border-b border-line">
              <td className="px-3 py-2 tabular" title={utcTitle(p.t)}>
                {formatDateTime(p.t)}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular">{formatMoney(p.price, currency)}</td>
              <td className="px-3 py-2 text-right text-muted tabular">{formatMoney(p.mrp, currency)}</td>
              <td className="px-3 py-2">
                <PriceChange latest={p.price} previous={valid[i + 1]?.price ?? null} currency={currency} />
              </td>
              <td className="px-3 py-2">{formatStock(p.stockStatus, p.stockQty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductInfo({ productId }: { productId: number }) {
  const product = useProduct(productId);
  if (product.isPending) return <Skeleton className="h-40 w-full" />;
  if (product.isError) return <ErrorState error={product.error} onRetry={() => void product.refetch()} />;
  const p = product.data;
  return (
    <Card className="p-4">
      {p.description && <p className="text-muted">{p.description}</p>}
      <p className="mt-2 text-xs text-muted">
        {p.reviews.count > 0 ? `★ ${p.reviews.average} average from ${p.reviews.count} reviews` : 'No reviews'} · Options:{' '}
        {p.options.map((o) => o.label).join(', ')}
      </p>
      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {Object.entries(p.specs).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-line pb-1">
            <dt className="text-muted">{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</dt>
            <dd className="text-right">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function ItemPage() {
  const { trackedId = '' } = useParams();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('log');
  const now = useNow();
  const summary = useTrackedItem(trackedId);
  // Poll quickly until the first attempt lands (right after "Start tracking").
  const waitingFirst = params.has('new') && !summary.data?.lastAttempt;
  const history = useHistory(trackedId, waitingFirst);
  const attempts = useAttempts(trackedId, waitingFirst);
  useTrackedItem(trackedId, { fastPoll: waitingFirst });

  if (summary.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (summary.isError) {
    return (
      <div className="space-y-3">
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        <Link to="/" className="text-primary hover:underline">
          ← Back to the dashboard
        </Link>
      </div>
    );
  }

  const item = summary.data;
  const latest = item.latest;
  const currency = latest?.currency ?? 'INR';
  const allAttempts = attempts.data?.pages.flatMap((p) => p.attempts) ?? [];

  return (
    <>
      <nav className="mb-2 text-xs text-muted" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-text">
          Dashboard
        </Link>{' '}
        / <span className="text-text">{item.productName}</span> — {item.optionLabel}
      </nav>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{item.productName}</h1>
          <p className="mt-1 text-muted">
            {item.optionAxis}: <span className="font-medium text-text">{item.optionLabel}</span>
            {' · '}
            {[item.brand, item.category, item.sku && `SKU ${item.sku}`].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-xs text-muted">
            Store product{' '}
            <a href={item.storeUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              #{item.storeProductId} ↗
            </a>{' '}
            · tracked since <span title={utcTitle(item.createdAt)}>{formatDateTime(item.createdAt)}</span> · next scrape{' '}
            <span title={utcTitle(item.nextDueAt)}>
              {Date.parse(item.nextDueAt) > now ? formatRelative(item.nextDueAt, now) : 'at the next 2-hour slot'}
            </span>
          </p>
        </div>
        <a href={apiUrl(`/api/export.csv?trackedId=${item.id}`)} className={buttonCls.secondary}>
          Export this item
        </a>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <Card className="p-4">
          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Current price</h2>
          <div className="mt-1 text-[28px] leading-8 font-semibold tabular">{latest ? formatMoney(latest.price, currency) : '—'}</div>
          {latest && (
            <>
              <PriceChange latest={latest.price} previous={item.previousPrice} currency={currency} />
              {latest.mrp !== null && <p className="mt-1 text-xs text-muted tabular">MRP {formatMoney(latest.mrp, currency)}</p>}
              <p className={`mt-3 font-medium ${latest.stockStatus === 'out_of_stock' ? 'text-failed' : 'text-success'}`}>
                {formatStock(latest.stockStatus, latest.stockQty, latest.stockText)}
              </p>
              <p className="mt-1 text-xs text-muted" title={utcTitle(latest.at)}>
                Confirmed {formatRelative(latest.at, now)}
              </p>
            </>
          )}
          {!latest && <p className="mt-2 text-muted">{waitingFirst ? 'First scrape running…' : 'No valid reading yet.'}</p>}
          {item.lastAttempt && (
            <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
              Last attempt <OutcomeBadge outcome={item.lastAttempt.outcome} /> {formatRelative(item.lastAttempt.at, now)}
              {item.successRate !== null && (
                <p className="mt-1">
                  {Math.round(item.successRate * 100)}% of the last {item.attemptsCounted} attempts valid
                </p>
              )}
            </div>
          )}
        </Card>
        <Card className="p-4">
          {history.isPending && <Skeleton className="h-72 w-full" />}
          {history.isError && <ErrorState error={history.error} onRetry={() => void history.refetch()} />}
          {history.data && <PriceChart points={history.data} currency={currency} />}
        </Card>
      </div>

      <div role="tablist" aria-label="Item details" className="mt-6 mb-3 flex gap-1 border-b border-line">
        {(
          [
            ['log', 'Scrape log'],
            ['prices', 'Price history'],
            ['info', 'Product info'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <>
          {attempts.isPending && <Skeleton className="h-40 w-full" />}
          {attempts.isError && <ErrorState error={attempts.error} onRetry={() => void attempts.refetch()} />}
          {attempts.data && allAttempts.length === 0 && (
            <EmptyState title={waitingFirst ? 'First scrape running…' : 'No attempts yet'}>
              Scheduled scrapes run every 2 hours; this item is next due{' '}
              {Date.parse(item.nextDueAt) > now ? formatRelative(item.nextDueAt, now) : 'at the next slot'}.
            </EmptyState>
          )}
          {allAttempts.length > 0 && <ScrapeLogTable attempts={allAttempts} />}
          {attempts.hasNextPage && (
            <button
              type="button"
              className={`${buttonCls.secondary} mt-3`}
              disabled={attempts.isFetchingNextPage}
              onClick={() => void attempts.fetchNextPage()}
            >
              {attempts.isFetchingNextPage ? 'Loading…' : 'Load older attempts'}
            </button>
          )}
        </>
      )}
      {tab === 'prices' && history.data && <PriceTable points={history.data} currency={currency} />}
      {tab === 'info' && <ProductInfo productId={item.storeProductId} />}
    </>
  );
}
