import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { Outcome } from '../api/types';
import { formatMoney, priceChange } from '../lib/format';

// Shared building blocks. Status is never shown by colour alone.

const OUTCOME: Record<Outcome | 'missed' | 'running', { icon: string; label: string; cls: string }> = {
  success: { icon: '✓', label: 'Success', cls: 'text-success bg-success/10 border-success/25' },
  retried: { icon: '↻', label: 'Retried', cls: 'text-retried bg-retried/10 border-retried/25' },
  failed: { icon: '✕', label: 'Failed', cls: 'text-failed bg-failed/10 border-failed/25' },
  missed: { icon: '⏸', label: 'Missed', cls: 'text-missed bg-missed/10 border-missed/25' },
  running: { icon: '●', label: 'Running', cls: 'text-primary bg-primary/10 border-primary/25' },
};

export function OutcomeBadge({ outcome, label }: { outcome: keyof typeof OUTCOME; label?: string }) {
  const o = OUTCOME[outcome];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${o.cls}`}>
      <span aria-hidden="true">{o.icon}</span>
      {label ?? o.label}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface ${className}`}>{children}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-line/60 ${className}`} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}


export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const cold = error instanceof ApiError && error.code === 'NETWORK';
  return (
    <div role="alert" className="rounded-lg border border-failed/30 bg-failed/5 p-4 text-sm">
      <p className="font-medium text-failed">{cold ? 'Can’t reach the API' : 'Something failed to load'}</p>
      <p className="mt-1 text-muted">
        {cold
          ? 'The server runs on a free tier and may be waking up — this can take up to 60 seconds.'
          : error instanceof Error
            ? error.message
            : String(error)}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 text-primary hover:underline">
          Retry now
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </div>
  );
}

export function PriceChange({ latest, previous, currency }: { latest: number | null; previous: number | null; currency: string | null }) {
  const change = priceChange(latest, previous);
  if (!change || change.delta === 0) return <span className="text-xs text-muted">{change ? 'No change' : ''}</span>;
  const down = change.delta < 0;
  return (
    <span className={`text-xs font-medium tabular ${down ? 'text-price-down' : 'text-price-up'}`}>
      {down ? '▼' : '▲'} {formatMoney(Math.abs(change.delta), currency)} ({Math.abs(change.pct).toFixed(1)}%)
      <span className="sr-only">{down ? ' price decreased' : ' price increased'}</span>
    </span>
  );
}

/** Tiny inline SVG sparkline of valid prices (no chart library needed on cards). */
export function Sparkline({ points }: { points: { t: string; price: number | null }[] }) {
  const values = points.filter((p): p is { t: string; price: number } => p.price !== null);
  if (values.length < 2) return <div className="h-8 text-xs text-muted">{values.length ? '1 data point' : 'No data yet'}</div>;
  const w = 120;
  const h = 32;
  const t0 = Date.parse(values[0]!.t);
  const t1 = Date.parse(values.at(-1)!.t);
  const min = Math.min(...values.map((v) => v.price));
  const max = Math.max(...values.map((v) => v.price));
  const x = (t: string) => (t1 === t0 ? w / 2 : ((Date.parse(t) - t0) / (t1 - t0)) * (w - 4) + 2);
  const y = (p: number) => (max === min ? h / 2 : h - 3 - ((p - min) / (max - min)) * (h - 6));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(v.t).toFixed(1)},${y(v.price).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Price trend over ${values.length} readings`}>
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(values.at(-1)!.t)} cy={y(values.at(-1)!.price)} r="2.5" fill="var(--primary)" />
    </svg>
  );
}
