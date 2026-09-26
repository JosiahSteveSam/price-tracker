import { Fragment, useState } from 'react';
import type { Attempt } from '../api/types';
import { formatDateTime, formatDuration, formatMoney, formatStock, humanizeCode, utcTitle } from '../lib/format';
import { OutcomeBadge } from './ui';

/** Every attempt, newest first, failures included. Rows expand to the per-try diagnostics. */
export function ScrapeLogTable({ attempts }: { attempts: Attempt[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[720px] text-left">
        <thead className="sticky top-0 bg-surface text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Outcome</th>
            <th className="px-3 py-2 text-right font-medium">Page loads</th>
            <th className="px-3 py-2 text-right font-medium">Duration</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 font-medium">Stock</th>
            <th className="px-3 py-2 font-medium">Error / note</th>
            <th className="px-3 py-2">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <Fragment key={a.id}>
              <tr className="border-b border-line hover:bg-line/20">
                <td className="px-3 py-2 whitespace-nowrap tabular" title={utcTitle(a.finishedAt)}>
                  {formatDateTime(a.finishedAt)}
                </td>
                <td className="px-3 py-2">
                  <OutcomeBadge outcome={a.outcome} />
                </td>
                <td className="px-3 py-2 text-right tabular">{a.tryCount}</td>
                <td className="px-3 py-2 text-right tabular">{formatDuration(a.durationMs)}</td>
                <td className="px-3 py-2 text-right tabular">{a.outcome === 'failed' ? '—' : formatMoney(a.price, a.currency)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{a.outcome === 'failed' ? '—' : formatStock(a.stockStatus, a.stockQty)}</td>
                <td className={`max-w-[320px] truncate px-3 py-2 ${a.outcome === 'failed' ? 'text-failed' : 'text-muted'}`} title={a.errorMessage ?? undefined}>
                  {a.errorCode ? (a.outcome === 'retried' ? `recovered from: ${humanizeCode(a.errorCode)}` : humanizeCode(a.errorCode)) : ''}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    aria-expanded={open === a.id}
                    onClick={() => setOpen(open === a.id ? null : a.id)}
                  >
                    {open === a.id ? 'Hide' : 'Details'}
                  </button>
                </td>
              </tr>
              {open === a.id && (
                <tr className="border-b border-line bg-bg">
                  <td colSpan={8} className="px-3 py-3 text-xs">
                    {a.errorMessage && <p className="mb-2 text-muted">{a.errorMessage}</p>}
                    <ol className="space-y-1">
                      {a.tries.map((t) => (
                        <li key={t.n} className="flex flex-wrap gap-x-3 tabular">
                          <span className="font-medium">Page load {t.n}</span>
                          <span className={t.ok ? 'text-success' : 'text-failed'}>{t.ok ? 'valid read' : humanizeCode(t.errorCode) || 'failed'}</span>
                          <span className="text-muted">{formatDuration(t.durationMs)}</span>
                          {t.rounds !== undefined && <span className="text-muted">{t.rounds} round{t.rounds === 1 ? '' : 's'}</span>}
                          {!!t.handshakesRejected && <span className="text-retried">{t.handshakesRejected} challenge rejected</span>}
                          {!!t.clicksIgnored && <span className="text-muted">{t.clicksIgnored} click ignored</span>}
                          {t.quoteStatuses && t.quoteStatuses.length > 0 && <span className="text-muted">quote HTTP {t.quoteStatuses.join(', ')}</span>}
                          {!!t.consentClicks && <span className="text-muted">cookie dialog ×{t.consentClicks}</span>}
                          {!t.ok && t.message && <span className="text-muted">— {t.message}</span>}
                        </li>
                      ))}
                    </ol>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
