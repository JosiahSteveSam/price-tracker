import { useQuery } from '@tanstack/react-query';
import { apiGet } from './client';

export type Health = { ok: boolean; startedAt: string; uptimeSec: number };

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<Health>('/healthz'),
    refetchInterval: 60_000,
  });
}
