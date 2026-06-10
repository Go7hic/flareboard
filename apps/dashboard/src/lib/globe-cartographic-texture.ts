import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const WIDTH = 4096;
const HEIGHT = 2048;

/** DataFast-style cartographic palette. */
const OCEAN_TOP = '#7ecdf2';
const OCEAN_MID = '#4a90e2';
const OCEAN_BOTTOM = '#3a7ec8';
const LAND = '#b4e197';
const BORDER = 'rgba(88, 102, 78, 0.32)';

let cachedUrl: string | null = null;
let pending: Promise<string> | null = null;

export async function getCartographicEarthTextureUrl(): Promise<string> {
  if (cachedUrl) return cachedUrl;
  if (pending) return pending;

  pending = (async () => {
    const topo = (await fetch(GEO_URL).then((res) => res.json())) as Topology;
    const countries = feature(
      topo,
      topo.objects.countries as Parameters<typeof feature>[1],
    ) as FeatureCollection<Geometry>;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');

    const ocean = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    ocean.addColorStop(0, OCEAN_TOP);
    ocean.addColorStop(0.5, OCEAN_MID);
    ocean.addColorStop(1, OCEAN_BOTTOM);
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const projection = geoEquirectangular().fitSize([WIDTH, HEIGHT], countries);
    const path = geoPath(projection, ctx);

    ctx.fillStyle = LAND;
    for (const land of countries.features) {
      ctx.beginPath();
      path(land);
      ctx.fill();
    }

    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 0.75;
    for (const land of countries.features) {
      ctx.beginPath();
      path(land);
      ctx.stroke();
    }

    cachedUrl = canvas.toDataURL('image/jpeg', 0.9);
    return cachedUrl;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}
