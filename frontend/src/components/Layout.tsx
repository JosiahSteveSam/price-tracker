import { Link, NavLink, Outlet } from 'react-router';
import { useHealth } from '../api/hooks';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 font-medium transition-colors ${
    isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:text-text'
  }`;

function ApiStatus() {
  const health = useHealth();
  const [label, tone] = health.isPending
    ? ['Connecting…', 'text-muted']
    : health.isError
      ? ['API unreachable', 'text-failed']
      : ['API online', 'text-success'];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs ${tone}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-4 px-4 md:px-6">
          <Link to="/" className="text-base font-semibold tracking-tight">
            PricePulse
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main">
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
          <div className="ml-auto">
            <ApiStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6">
        <Outlet />
      </main>
    </div>
  );
}
