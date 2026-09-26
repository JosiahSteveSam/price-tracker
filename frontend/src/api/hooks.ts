import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from './client';
import type {
  Alert,
  Attempt,
  CatalogResult,
  Health,
  HistoryPoint,
  ProductDetails,
  RunsResponse,
  TrackedItem,
  TrackedSummary,
} from './types';

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => apiGet<Health>('/healthz'), refetchInterval: 60_000 });
}

export function useTracked() {
  return useQuery({
    queryKey: ['tracked'],
    queryFn: () => apiGet<{ items: TrackedSummary[] }>('/api/tracked').then((r) => r.items),
    refetchInterval: 60_000,
  });
}

/** Polls faster while a scrape is expected (e.g. right after tracking starts). */
export function useTrackedItem(id: string, { fastPoll = false } = {}) {
  return useQuery({
    queryKey: ['tracked', id],
    queryFn: () => apiGet<TrackedSummary>(`/api/tracked/${id}`),
    refetchInterval: fastPoll ? 5_000 : 60_000,
  });
}

export function useHistory(id: string, fastPoll = false) {
  return useQuery({
    queryKey: ['history', id],
    queryFn: () => apiGet<{ points: HistoryPoint[] }>(`/api/tracked/${id}/history`).then((r) => r.points),
    refetchInterval: fastPoll ? 5_000 : 60_000,
  });
}

export function useAttempts(id: string, fastPoll = false) {
  return useInfiniteQuery({
    queryKey: ['attempts', id],
    queryFn: ({ pageParam }) =>
      apiGet<{ attempts: Attempt[]; nextBefore: string | null }>(
        `/api/tracked/${id}/attempts?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: fastPoll ? 5_000 : 60_000,
  });
}

export function useRuns(limit = 50) {
  return useQuery({
    queryKey: ['runs', limit],
    queryFn: () => apiGet<RunsResponse>(`/api/runs?limit=${limit}`),
    refetchInterval: 60_000,
  });
}

export function useCatalogSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['search', term],
    queryFn: () =>
      apiGet<{ results: CatalogResult[] }>(`/api/catalog/search?q=${encodeURIComponent(term)}&limit=20`).then(
        (r) => r.results,
      ),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useProduct(productId: number | null) {
  return useQuery({
    queryKey: ['product', productId],
    queryFn: () => apiGet<ProductDetails>(`/api/catalog/${productId}`),
    enabled: productId !== null,
    staleTime: 5 * 60_000,
  });
}

export function useTrackProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { productId: number; optionId: string }) =>
      apiPost<{ item: TrackedItem; firstScrape: string }>('/api/tracked', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tracked'] });
      void qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useAlerts(trackedId?: string) {
  return useQuery({
    queryKey: ['alerts', trackedId ?? 'all'],
    queryFn: () =>
      apiGet<{ alerts: Alert[] }>(`/api/alerts?limit=20${trackedId ? `&trackedId=${trackedId}` : ''}`).then((r) => r.alerts),
    refetchInterval: 60_000,
  });
}
