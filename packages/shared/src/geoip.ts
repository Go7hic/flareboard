/** Cloudflare `request.cf` geo fields used for session enrichment. */
export interface CfGeo {
  country?: string;
  region?: string;
  city?: string;
}

export function geoFromCf(cf?: unknown): {
  country: string | null;
  region: string | null;
  city: string | null;
} {
  const g = cf as CfGeo | undefined;
  return {
    country: g?.country ?? null,
    region: g?.region ?? null,
    city: g?.city ?? null,
  };
}
