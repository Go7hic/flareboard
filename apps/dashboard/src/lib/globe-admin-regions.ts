import { geoCentroid } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

const ADMIN_GEO_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_1_states_provinces.geojson';

export type AdminRegionLabel = {
  lat: number;
  lng: number;
  text: string;
  minTier: 'country' | 'local';
};

type AdminCache = {
  features: Feature<Geometry>[];
  labels: AdminRegionLabel[];
};

let cache: AdminCache | null = null;
let pending: Promise<AdminCache> | null = null;

function labelText(props: Record<string, unknown>): string | null {
  const raw =
    (props.name as string | undefined) ??
    (props.name_en as string | undefined) ??
    (props.name_long as string | undefined);
  if (!raw || raw.length > 28) return null;
  return raw.toUpperCase();
}

export async function loadAdminRegions(): Promise<AdminCache> {
  if (cache) return cache;
  if (pending) return pending;

  pending = (async () => {
    const geojson = (await fetch(ADMIN_GEO_URL).then((res) => res.json())) as FeatureCollection;
    const labels: AdminRegionLabel[] = [];

    for (const feature of geojson.features) {
      const text = labelText((feature.properties ?? {}) as Record<string, unknown>);
      if (!text) continue;
      try {
        const [lng, lat] = geoCentroid(feature);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        labels.push({
          lat,
          lng,
          text,
          minTier: text.length <= 12 ? 'country' : 'local',
        });
      } catch {
        /* skip malformed geometries */
      }
    }

    cache = { features: geojson.features, labels };
    return cache;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}
