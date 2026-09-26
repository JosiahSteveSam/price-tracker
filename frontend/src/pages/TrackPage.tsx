import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useCatalogSearch, useProduct, useTrackProduct } from '../api/hooks';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { buttonCls } from '../lib/styles';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ProductPanel({ productId }: { productId: number }) {
  const product = useProduct(productId);
  const track = useTrackProduct();
  const navigate = useNavigate();
  const [optionId, setOptionId] = useState<string | null>(null);
  const groupName = useId();

  if (product.isPending) {
    return (
      <Card className="p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }
  if (product.isError) return <ErrorState error={product.error} onRetry={() => void product.refetch()} />;
  const p = product.data;
  const specs = Object.entries(p.specs).slice(0, 6);
  const error = track.error instanceof ApiError ? track.error : null;
  const duplicateId = p.options.find((o) => o.id === optionId)?.trackedItemId;

  return (
    <Card className="p-5">
      <p className="text-xs text-muted">
        {[p.category, p.brand, p.sku && `SKU ${p.sku}`, `#${p.storeProductId}`].filter(Boolean).join(' · ')}
      </p>
      <h2 className="mt-1 text-lg font-semibold">{p.name}</h2>
      {p.reviews.count > 0 && (
        <p className="mt-1 text-xs text-muted">
          ★ {p.reviews.average} from {p.reviews.count} reviews
        </p>
      )}
      {p.description && <p className="mt-3 text-muted">{p.description}</p>}
      {specs.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {specs.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <fieldset className="mt-5">
        <legend className="mb-2 font-medium">{p.optionAxis}: choose the option to track</legend>
        <div className="space-y-2">
          {p.options.map((o) => (
            <label
              key={o.id}
              className={`flex min-h-10 items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                o.trackedItemId ? 'border-line opacity-70' : optionId === o.id ? 'border-primary bg-primary/5' : 'border-line hover:bg-line/30'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={groupName}
                  value={o.id}
                  checked={optionId === o.id}
                  disabled={!!o.trackedItemId}
                  onChange={() => setOptionId(o.id)}
                />
                {o.label}
              </span>
              {o.trackedItemId && (
                <Link to={`/items/${o.trackedItemId}`} className="text-xs text-primary hover:underline">
                  Already tracked →
                </Link>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-sm text-failed">
          {error.message}{' '}
          {error.code === 'ALREADY_TRACKED' && duplicateId && (
            <Link to={`/items/${duplicateId}`} className="text-primary hover:underline">
              Open it
            </Link>
          )}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonCls.primary}
          disabled={!optionId || track.isPending}
          onClick={() =>
            optionId &&
            track.mutate(
              { productId: p.storeProductId, optionId },
              { onSuccess: (r) => navigate(`/items/${r.item.id}?new=1`) },
            )
          }
        >
          {track.isPending ? 'Starting…' : 'Start tracking'}
        </button>
        <a href={p.storeUrl} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-text">
          View on store ↗
        </a>
      </div>
      <p className="mt-3 text-xs text-muted">
        The first scrape starts immediately; after that it runs every 2 hours.
      </p>
    </Card>
  );
}

export function TrackPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query, 300);
  const search = useCatalogSearch(debounced);
  const results = search.data ?? [];
  const listId = useId();

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setSelected(results[active]!.storeProductId);
    }
  };

  return (
    <>
      <PageHeader title="Track a product" subtitle="Search the INE store by full or partial product name, or by product id." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <label htmlFor="product-search" className="sr-only">
            Search products
          </label>
          <div className="relative">
            <input
              id="product-search"
              type="search"
              autoFocus
              autoComplete="off"
              placeholder="e.g. synth, e-reader, 2312"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${results[active].storeProductId}` : undefined}
              className="h-11 w-full rounded-lg border border-line bg-surface px-3 outline-none focus:border-primary"
            />
            {search.isFetching && (
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">Searching…</span>
            )}
          </div>

          <div className="mt-3">
            {debounced.trim().length < 2 && <p className="text-muted">Type at least 2 characters.</p>}
            {search.isError && <ErrorState error={search.error} onRetry={() => void search.refetch()} />}
            {search.isSuccess && debounced.trim().length >= 2 && results.length === 0 && (
              <EmptyState title={`No products match “${debounced.trim()}”`} />
            )}
            {results.length > 0 && (
              <ul id={listId} role="listbox" aria-label="Search results" className="divide-y divide-line rounded-lg border border-line bg-surface">
                {results.map((r, i) => (
                  <li
                    key={r.storeProductId}
                    id={`${listId}-${r.storeProductId}`}
                    role="option"
                    aria-selected={selected === r.storeProductId}
                    onClick={() => {
                      setSelected(r.storeProductId);
                      setActive(i);
                    }}
                    className={`cursor-pointer px-3 py-2.5 ${
                      selected === r.storeProductId ? 'bg-primary/10' : i === active ? 'bg-line/40' : 'hover:bg-line/30'
                    }`}
                  >
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted">
                      {[r.brand, r.category, r.sku, `#${r.storeProductId}`].filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          {selected !== null ? (
            <ProductPanel key={selected} productId={selected} />
          ) : (
            <EmptyState title="Pick a product">Its options and details appear here.</EmptyState>
          )}
        </div>
      </div>
    </>
  );
}
