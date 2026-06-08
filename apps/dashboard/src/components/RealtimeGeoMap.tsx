import { useMemo } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import type { RealtimeSession } from '../lib/api';
import { getCountryCentroid, jitterCoords } from '../lib/country-centroids';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

type RealtimeGeoMapProps = {
  sessions: RealtimeSession[];
};

export function RealtimeGeoMap({ sessions }: RealtimeGeoMapProps) {
  const markers = useMemo(() => {
    const points: Array<{ key: string; coordinates: [number, number] }> = [];
    const perCountry = new Map<string, number>();

    for (const session of sessions) {
      if (!session.country) continue;
      const country = session.country.toUpperCase();
      const base = getCountryCentroid(country);
      if (!base) continue;
      const index = perCountry.get(country) ?? 0;
      perCountry.set(country, index + 1);
      points.push({
        key: session.sessionId,
        coordinates: jitterCoords(base, session.sessionId, index),
      });
    }

    return points;
  }, [sessions]);

  return (
    <div className="realtime-map-wrap" aria-hidden={!markers.length}>
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
            <circle r={7} fill="var(--accent)" opacity={0.18} />
            <circle r={4} fill="var(--accent)" opacity={0.92} />
          </Marker>
        ))}
      </ComposableMap>
    </div>
  );
}
