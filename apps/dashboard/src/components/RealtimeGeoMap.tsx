import { useMemo, useRef, useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import type { RealtimeSession } from '../lib/api';
import { getCountryCentroid, jitterCoords } from '../lib/country-centroids';
import { getCountryLabel } from '../lib/map-format';
import { MapTooltip } from './MapTooltip';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

type RealtimeGeoMapProps = {
  sessions: RealtimeSession[];
};

type MarkerPoint = {
  key: string;
  country: string;
  coordinates: [number, number];
};

type TooltipState = {
  country: string;
  x: number;
  y: number;
};

export function RealtimeGeoMap({ sessions }: RealtimeGeoMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { markers, countryCounts } = useMemo(() => {
    const points: MarkerPoint[] = [];
    const perCountry = new Map<string, number>();
    const counts = new Map<string, number>();

    for (const session of sessions) {
      if (!session.country) continue;
      const country = session.country.toUpperCase();
      counts.set(country, (counts.get(country) ?? 0) + 1);
      const base = getCountryCentroid(country);
      if (!base) continue;
      const index = perCountry.get(country) ?? 0;
      perCountry.set(country, index + 1);
      points.push({
        key: session.sessionId,
        country,
        coordinates: jitterCoords(base, session.sessionId, index),
      });
    }

    return { markers: points, countryCounts: counts };
  }, [sessions]);

  function setTooltipFromEvent(country: string, clientX: number, clientY: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      country,
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }

  function clearTooltip() {
    setTooltip(null);
  }

  const tooltipCountry = tooltip?.country ?? null;
  const tooltipCount = tooltipCountry ? (countryCounts.get(tooltipCountry) ?? 0) : 0;

  return (
    <div
      ref={wrapRef}
      className="realtime-map-wrap"
      aria-hidden={!markers.length}
      onMouseLeave={clearTooltip}
    >
      <ComposableMap
        projectionConfig={{ scale: 140, center: [0, 20] }}
        width={800}
        height={360}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="var(--bg-subtle)"
                stroke="var(--border)"
                strokeWidth={0.35}
                style={{
                  default: { outline: 'none' },
                  hover: { outline: 'none' },
                  pressed: { outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>
        {markers.map((marker) => (
          <Marker key={marker.key} coordinates={marker.coordinates}>
            <circle
              r={10}
              fill="transparent"
              className="map-marker-hit"
              onMouseEnter={(e) => setTooltipFromEvent(marker.country, e.clientX, e.clientY)}
              onMouseMove={(e) => setTooltipFromEvent(marker.country, e.clientX, e.clientY)}
              onMouseLeave={clearTooltip}
            />
            <circle r={7} fill="var(--accent)" opacity={0.18} pointerEvents="none" />
            <circle r={4} fill="var(--accent)" opacity={0.92} pointerEvents="none" />
          </Marker>
        ))}
      </ComposableMap>
      {tooltip && tooltipCount > 0 ? (
        <MapTooltip
          label={getCountryLabel(tooltip.country)}
          value={tooltipCount}
          x={tooltip.x}
          y={tooltip.y}
        />
      ) : null}
    </div>
  );
}
