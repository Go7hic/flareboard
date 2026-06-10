export type GlobeZoomTier = 'world' | 'region' | 'country' | 'local';

export type GlobePov = { lat: number; lng: number; altitude: number };

export function zoomTierFromAltitude(altitude: number): GlobeZoomTier {
  if (altitude >= 1.15) return 'world';
  if (altitude >= 0.65) return 'region';
  if (altitude >= 0.38) return 'country';
  return 'local';
}

const DEG = Math.PI / 180;

export function angularDistanceDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = (lat2 - lat1) * DEG;
  const dl = (lng2 - lng1) * DEG;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / DEG;
}

export function maxLabelSpreadDeg(tier: GlobeZoomTier): number {
  switch (tier) {
    case 'world':
      return 180;
    case 'region':
      return 95;
    case 'country':
      return 52;
    case 'local':
      return 28;
  }
}

export function showAdminBoundaries(tier: GlobeZoomTier): boolean {
  return tier === 'country' || tier === 'local';
}

export function enableGlobePan(tier: GlobeZoomTier): boolean {
  return tier !== 'world';
}
