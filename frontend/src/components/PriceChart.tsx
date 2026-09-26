import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
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
// failures are red ✕ markers along the bottom — never drawn as zero, never interpolated across. Scheduled
// slots that never ran (missed) are shaded bands, and the line breaks across them too.

type Range = '24h' | '3d' | 'all';
const RANGE_MS: Record<Range, number> = { '24h': 86_400_000, '3d': 3 * 86_400_000, all: Infinity };
const SLOT_MS = 2 * 60 * 60 * 1000;

interface Row {
  x: number;
  price: number | null;
  stock: number | null;
  fail: number | null;
  /** A real attempt, or a synthetic gap row in the middle of a missed slot. */
  point: HistoryPoint | { missedSlot: string };
}

interface TooltipProps {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  currency: string | null;
}

function ChartTooltip({ active, payload, currency }: TooltipProps) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  if ('missedSlot' in row.point) {
    return (
      <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
        <div className="font-medium">Slot {formatDateTime(row.point.missedSlot)}</div>
        <div className="mt-1 text-missed">⏸ Missed — the scheduler never triggered this run</div>
      </div>
    );
  }
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

export function PriceChart({
  points,
  currency,
  missedSlots = [],
  trackedSince,
}: {
  points: HistoryPoint[];
  currency: string | null;
  /** ISO starts of 2 h slots with no run at all (GET /api/runs → missedSlots). */
  missedSlots?: string[];
  trackedSince?: string;
}) {
  const [range, setRange] = useState<Range>('all');
  const now = useNow(60_000);
  const { rows, missed } = useMemo(() => {
    const since = now - RANGE_MS[range];
    const from = Math.max(since, trackedSince ? Date.parse(trackedSince) - SLOT_MS : -Infinity);
    const missed = missedSlots
      .map((s) => Date.parse(s))
      .filter((start) => start + SLOT_MS > from && start < now)
      .map((start) => ({ start, end: Math.min(start + SLOT_MS, now) }));
    const real: Row[] = points
      .filter((p) => Date.parse(p.t) >= since)
      .map((p) => ({
        x: Date.parse(p.t),
        price: p.outcome === 'failed' ? null : p.price,
        stock: p.outcome === 'failed' ? null : p.stockQty,
        fail: p.outcome === 'failed' ? 0.04 : null,
        point: p,
      }));
    // A null row inside each missed slot breaks the line: no data was collected there.
    const gaps: Row[] = missed.map((m) => ({
      x: (m.start + m.end) / 2,
      price: null,
      stock: null,
      fail: null,
      point: { missedSlot: new Date(m.start).toISOString() },
    }));
    return { rows: [...real, ...gaps].sort((a, b) => a.x - b.x), missed };
  }, [points, range, now, missedSlots, trackedSince]);

  const attempts = rows.filter((r) => !('missedSlot' in r.point));
  const valid = attempts.filter((r) => r.price !== null).length;
  const failed = attempts.length - valid;
  const xMin = rows.length ? Math.min(rows[0]!.x, ...missed.map((m) => m.start)) : 0;
  const xMax = rows.length ? Math.max(rows.at(-1)!.x, ...missed.map((m) => m.end)) : 0;
  const spanDays = (xMax - xMin) / 86_400_000;
  // Evenly spaced ticks on round hours (local time), so sparse data still gets a readable axis.
  const stepMs = spanDays <= 0.5 ? 2 * 3_600_000 : spanDays <= 2 ? 6 * 3_600_000 : 86_400_000;
  const tzOffset = new Date(xMin).getTimezoneOffset() * 60_000;
  const ticks: number[] = [];
  for (let t = Math.ceil((xMin - tzOffset) / stepMs) * stepMs + tzOffset; t <= xMax; t += stepMs) ticks.push(t);
  const tick = (x: number) =>
    new Intl.DateTimeFormat('en-IN', spanDays > 1.5 ? { day: '2-digit', month: 'short', hour: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false }).format(x);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {valid} valid reading{valid === 1 ? '' : 's'} · <span className={failed ? 'text-failed' : ''}>{failed} failed</span>
          {missed.length > 0 && <span className="text-missed"> · {missed.length} missed slot{missed.length === 1 ? '' : 's'}</span>} in range
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
      {attempts.length === 0 ? (
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
                domain={[xMin, xMax]}
                ticks={ticks}
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
              {missed.map((m) => (
                <ReferenceArea
                  key={m.start}
                  yAxisId="price"
                  x1={m.start}
                  x2={m.end}
                  fill="var(--missed)"
                  fillOpacity={0.14}
                  stroke="var(--missed)"
                  strokeOpacity={0.4}
                  strokeDasharray="3 3"
                  ifOverflow="extendDomain"
                />
              ))}
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
        <span>
          <span className="inline-block h-2.5 w-3 rounded-sm border border-dashed border-missed bg-missed/20 align-middle" /> Missed
          slot — scheduler never ran
        </span>
      </p>
    </div>
  );
}
