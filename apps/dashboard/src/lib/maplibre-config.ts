/** MapLibre GL — open-source vector globe (no Mapbox token). */

/** CARTO Voyager — free GL style, detailed labels when zoomed in. */
export const DEFAULT_MAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

export function getMapStyleUrl(): string {
  const custom = import.meta.env.VITE_MAP_STYLE_URL?.trim();
  return custom || DEFAULT_MAP_STYLE_URL;
}

/** Set `VITE_DISABLE_MAPLIBRE_GLOBE=true` to force the legacy globe.gl fallback. */
export function isMapLibreGlobeEnabled(): boolean {
  return import.meta.env.VITE_DISABLE_MAPLIBRE_GLOBE !== 'true';
}
