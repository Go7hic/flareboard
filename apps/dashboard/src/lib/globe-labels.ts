import type { GlobeZoomTier } from './globe-zoom-levels';
import { angularDistanceDeg, maxLabelSpreadDeg } from './globe-zoom-levels';
import type { AdminRegionLabel } from './globe-admin-regions';
import { getCountryCentroid } from './country-centroids';
import { getCountryLabelEn } from './map-format';
import { GLOBE_CITY_LABELS, GLOBE_COUNTRY_CODES } from './globe-map-labels';
import { GLOBE_COUNTRY_LABEL_SIZE } from './globe-visual-config';

export type GlobeLabelRecord = {
  lat: number;
  lng: number;
  text: string;
  size: number;
  includeDot: boolean;
  minTier: GlobeZoomTier;
};

const TIER_RANK: Record<GlobeZoomTier, number> = {
  world: 0,
  region: 1,
  country: 2,
  local: 3,
};

function tierVisible(minTier: GlobeZoomTier, current: GlobeZoomTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[minTier];
}

function inView(
  lat: number,
  lng: number,
  pov: { lat: number; lng: number },
  spreadDeg: number,
): boolean {
  return angularDistanceDeg(lat, lng, pov.lat, pov.lng) <= spreadDeg;
}

export function buildGlobeLabels(
  tier: GlobeZoomTier,
  pov: { lat: number; lng: number },
  adminLabels: AdminRegionLabel[],
): GlobeLabelRecord[] {
  const spread = maxLabelSpreadDeg(tier);
  const out: GlobeLabelRecord[] = [];

  if (tierVisible('world', tier)) {
    for (const code of GLOBE_COUNTRY_CODES) {
      const centroid = getCountryCentroid(code);
      if (!centroid) continue;
      const lat = centroid[1];
      const lng = centroid[0];
      if (!inView(lat, lng, pov, spread)) continue;
      out.push({
        lat,
        lng,
        text: getCountryLabelEn(code),
        size: tier === 'world' ? GLOBE_COUNTRY_LABEL_SIZE : GLOBE_COUNTRY_LABEL_SIZE * 0.92,
        includeDot: false,
        minTier: 'world',
      });
    }
  }

  for (const city of GLOBE_CITY_LABELS) {
    if (!tierVisible(city.minTier, tier)) continue;
    if (!inView(city.lat, city.lng, pov, spread)) continue;
    const scale = tier === 'local' ? 1.08 : tier === 'country' ? 1 : 0.92;
    out.push({
      lat: city.lat,
      lng: city.lng,
      text: city.text,
      size: city.size * scale,
      includeDot: true,
      minTier: city.minTier,
    });
  }

  for (const region of adminLabels) {
    if (!tierVisible(region.minTier, tier)) continue;
    if (!inView(region.lat, region.lng, pov, spread)) continue;
    out.push({
      lat: region.lat,
      lng: region.lng,
      text: region.text,
      size: tier === 'local' ? 0.72 : 0.82,
      includeDot: false,
      minTier: region.minTier,
    });
  }

  return out;
}
