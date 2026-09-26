import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { apiUrl } from '../api/client';
import { useHealth, useRuns } from '../api/hooks';
import type { RunStatus } from '../api/types';
import { formatTime, utcTitle } from '../lib/format';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 font-medium transition-colors ${
    isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:text-text'
  }`;

const RUN_LABEL: Record<RunStatus, [string, string]> = {
  running: ['Running', 'text-primary'],
  completed: ['OK', 'text-success'],
  completed_with_failures: ['Some failed', 'text-retried'],
  interrupted: ['Interrupted', 'text-failed'],
  crashed: ['Crashed', 'text-failed'],
};

/** Top-bar pill: last run result + next scheduled run (docs/03-APP-FLOW.md §Navigation). */
function StatusPill() {
  const health = useHealth();
  const runs = useRuns(5);
  if (health.isError) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-failed">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        API unreachable
      </span>
    );
  }
  if (!health.data) return <span className="text-xs text-muted">Connecting…</span>;
  const last = health.data.lastRun;
  const [label, tone] = last ? RUN_LABEL[last.status] : ['No runs yet', 'text-muted'];
  const next = runs.data?.schedule.nextSlot;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line px-2.5 py-1 text-xs whitespace-nowrap">
      {last && (
        <span title={utcTitle(last.startedAt)}>
          Last run {formatTime(last.startedAt)} · <span className={`font-medium ${tone}`}>{label}</span>
        </span>
      )}
      {!last && <span className={tone}>{label}</span>}
      {next && (
        <span className="hidden text-muted sm:inline" title={utcTitle(next)}>
          · next {formatTime(next)}
        </span>
      )}
    </span>
  );
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const exportLink = (
    <a href={apiUrl('/api/export.csv')} className="rounded-md border border-line px-2.5 py-1.5 font-medium hover:bg-line/40">
      Export CSV
    </a>
  );
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:px-6">
          <Link to="/" className="text-base font-semibold tracking-tight">
            PricePulse
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              Dashboard
            </NavLink>
            <NavLink to="/track" className={navClass}>
              Track
            </NavLink>
            <NavLink to="/runs" className={navClass}>
              Runs
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <StatusPill />
            <span className="hidden md:inline">{exportLink}</span>
            <button
              type="button"
              className="rounded-md border border-line px-2.5 py-1.5 md:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              Menu
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-menu" aria-label="Main" className="flex flex-col gap-1 border-t border-line px-4 py-3 md:hidden" onClick={() => setMenuOpen(false)}>
            <NavLink to="/" end className={navClass}>
              Dashboard
            </NavLink>
            <NavLink to="/track" className={navClass}>
              Track a product
            </NavLink>
            <NavLink to="/runs" className={navClass}>
              Runs
            </NavLink>
            <div className="pt-1">{exportLink}</div>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6">
        <Outlet />
      </main>
    </div>
  );
}
