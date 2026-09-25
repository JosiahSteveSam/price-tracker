import { createHash } from 'node:crypto';

/** The store's layout manifest (GET /api/v2/ui/manifest) — rotates class names/tag/carrier about every 4 h. */
export interface Manifest {
  revision?: number;
  variant?: number;
  validUntil?: number;
  classes?: Record<string, string>;
  order?: string[];
  priceTag?: string;
  priceCarrier?: string;
  ratingAria?: boolean;
  sellerTitle?: boolean;
  [key: string]: unknown;
}

const typeOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/**
 * Structure signature for change detection: the manifest's *shape* (keys + value types + class-key set +
 * priceTag/priceCarrier), deliberately excluding class names, which rotate by design. A signature we have
 * never seen means the page may now render differently.
 */
export function manifestSignature(m: Manifest | null): { signature: string; shape: Record<string, unknown> } {
  const shape = m
    ? {
        keys: Object.keys(m)
          .sort()
          .map((k) => `${k}:${typeOf(m[k])}`),
        classKeys: Object.keys(m.classes ?? {}).sort(),
        priceTag: m.priceTag ?? null,
        priceCarrier: m.priceCarrier ?? null,
        orderKeys: [...(m.order ?? [])].sort(),
      }
    : { missing: true };
  const signature = createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
  return { signature, shape };
}
