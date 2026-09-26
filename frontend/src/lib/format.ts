// Formatting helpers — docs/04-UI-UX-BRIEF.md §Typography. Times are shown in local time; the full
// ISO UTC value goes in a title tooltip.

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number | null | undefined, currency: string | null = 'INR'): string {
  if (value === null || value === undefined) return '—';
  const key = currency ?? 'INR';
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', { style: 'currency', currency: key, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    moneyFormatters.set(key, f);
  }
  return f.format(value);
}

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const timeOnly = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatTime = (iso: string) => timeOnly.format(new Date(iso));
export const utcTitle = (iso: string) => `${new Date(iso).toISOString().replace('.000Z', 'Z')} (UTC)`;

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return diff < 0 ? 'just now' : 'in under a minute';
}

export const formatDuration = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;

export function formatStock(status: string | null | undefined, qty: number | null | undefined, text?: string | null) {
  if (!status) return '—';
  if (status === 'out_of_stock') return 'Out of stock';
  return qty !== null && qty !== undefined ? `In stock · ${qty}` : (text ?? 'In stock');
}

export function priceChange(latest: number | null | undefined, previous: number | null | undefined) {
  if (latest === null || latest === undefined || previous === null || previous === undefined || previous === 0) return null;
  const delta = latest - previous;
  return { delta, pct: (delta / previous) * 100 };
}

export const humanizeCode = (code: string | null | undefined) =>
  code ? code.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';
