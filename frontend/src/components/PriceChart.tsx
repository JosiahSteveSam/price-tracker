import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HistoryPoint } from '../api/types';
import { formatDateTime, formatMoney, formatStock, humanizeCode } from '../lib/format';
import { useNow } from '../lib/useNow';

// Honest chart (docs/04 §Chart): the price line only connects valid readings and BREAKS at failed attempts;
// failures are red ✕ markers along the bottom — never drawn as zero, never interpolated across.

type Range = '24h' | '3d' | 'all';
const RANGE_MS: Record<Range, number> = { '24h': 86_400_000, '3d': 3 * 86_400_000, all: Infinity };

interface Row {
  x: number;
  price: number | null;
  stock: number | null;
  fail: number | null;
  point: HistoryPoint;
}

interface TooltipProps {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  currency: string | null;
}

function ChartTooltip({ active, payload, currency }: TooltipProps) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  const p = row.point;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{formatDateTime(p.t)}</div>
      {p.outcome === 'failed' ? (
        <div className="mt-1 text-failed">✕ Failed — {humanizeCode(p.errorCode)}</div>
      ) : (
        <>
          <div className="mt-1 tabular">Price {formatMoney(p.price, currency)}</div>
          <div className="tabular">Stock {formatStock(p.stockStatus, p.stockQty)}</div>
          <div className={p.outcome === 'retried' ? 'text-retried' : 'text-success'}>
            {p.outcome === 'retried' ? '↻ Retried' : '✓ Success'}
          </div>
        </>
      )}
    </div>
  );
}

const compactMoney = (v: number, currency: string | null) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency ?? 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(v);

const FailMark = (props: { cx?: number; cy?: number }) => {
  const { cx, cy } = props;
  if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
  return (
    <g stroke="var(--failed)" strokeWidth={2}>
      <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} />
      <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} />
    </g>
  );
};

export function PriceChart({ points, currency }: { points: HistoryPoint[]; currency: string | null }) {
  const [range, setRange] = useState<Range>('all');
  const now = useNow(60_000);
  const rows = useMemo<Row[]>(() => {
    const since = now - RANGE_MS[range];
    return points
      .filter((p) => Date.parse(p.t) >= since)
      .map((p) => ({
        x: Date.parse(p.t),
        price: p.outcome === 'failed' ? null : p.price,
        stock: p.outcome === 'failed' ? null : p.stockQty,
        fail: p.outcome === 'failed' ? 0.04 : null,
        point: p,
      }));
  }, [points, range, now]);

  const valid = rows.filter((r) => r.price !== null).length;
  const failed = rows.length - valid;
  const spanDays = rows.length > 1 ? (rows.at(-1)!.x - rows[0]!.x) / 86_400_000 : 0;
  const tick = (x: number) =>
    new Intl.DateTimeFormat('en-IN', spanDays > 1.5 ? { day: '2-digit', month: 'short', hour: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false }).format(x);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {valid} valid reading{valid === 1 ? '' : 's'} · <span className={failed ? 'text-failed' : ''}>{failed} failed</span> in range
        </p>
        <div role="tablist" aria-label="Chart range" className="inline-flex rounded-md border border-line p-0.5 text-xs">
          {(['24h', '3d', 'all'] as const).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`rounded px-2.5 py-1 ${range === r ? 'bg-primary/10 font-medium text-primary' : 'text-muted hover:text-text'}`}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="grid h-64 place-items-center rounded-lg border border-dashed border-line text-muted">
          No scrapes in this range yet — see the scrape log below.
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={tick}
                stroke="var(--muted)"
                fontSize={11}
                padding={{ left: 12, right: 12 }}
              />
              <YAxis
                yAxisId="price"
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => compactMoney(v, currency)}
                stroke="var(--muted)"
                fontSize={11}
                width={64}
              />
              <YAxis yAxisId="stock" orientation="right" allowDecimals={false} stroke="var(--muted)" fontSize={11} width={36} />
              <YAxis yAxisId="marker" hide orientation="right" width={0} domain={[0, 1]} />
              <Tooltip content={({ active, payload }) => <ChartTooltip active={active} payload={payload} currency={currency} />} />
              <Line
                yAxisId="stock"
                dataKey="stock"
                name="Stock"
                type="stepAfter"
                stroke="var(--muted)"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="price"
                dataKey="price"
                name="Price"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'var(--primary)' }}
                connectNulls={false}
                isAnimationActive={false}
              />
              {/* Own data: only failed rows — Recharts would otherwise draw null rows at the top edge. */}
              <Scatter
                yAxisId="marker"
                data={rows.filter((r) => r.fail !== null)}
                dataKey="fail"
                name="Failed"
                shape={FailMark}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
        <span>
          <span className="text-primary">━</span> Price (left axis)
        </span>
        <span>┅ Stock (right axis)</span>
        <span>
          <span className="text-failed">✕</span> Failed attempt — no data, line breaks
        </span>
      </p>
    </div>
  );
}
