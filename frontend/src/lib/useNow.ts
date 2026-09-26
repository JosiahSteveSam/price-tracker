import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` — keeps "in 12 minutes" labels live and render pure. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
