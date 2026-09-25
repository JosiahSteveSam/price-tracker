import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

// Page shells for Phase 1. Real content lands in Phase 6 (docs/03-APP-FLOW.md).

function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>;
}

export function DashboardPage() {
  return <PageTitle>Dashboard</PageTitle>;
}

export function TrackPage() {
  return <PageTitle>Track a product</PageTitle>;
}

export function ItemPage() {
  const { trackedId } = useParams();
  return <PageTitle>Item {trackedId}</PageTitle>;
}

export function RunsPage() {
  return <PageTitle>Runs</PageTitle>;
}

export function NotFoundPage() {
  return (
    <div className="space-y-2">
      <PageTitle>Page not found</PageTitle>
      <Link to="/" className="text-primary hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
