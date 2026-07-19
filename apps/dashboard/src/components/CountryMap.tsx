import { useRef, useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { getCountryLabel } from '../lib/map-format';
import { MapTooltip } from './MapTooltip';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const MAP_WIDTH = 800;
const MAP_HEIGHT = 480;
const MAP_SCALE = 175;
const MAP_CENTER: [number, number] = [0, 20];

type MapPosition = {
  coordinates: [number, number];
  zoom: number;
};

const DEFAULT_POSITION: MapPosition = {
  coordinates: MAP_CENTER,
  zoom: 1,
};

function mapZoomFilter(event: Event) {
  if (event.type === 'wheel') return true;
  const e = event as MouseEvent;
  return !e.ctrlKey && !e.button;
}

/** ISO 3166-1 alpha-2 → numeric id used by world-atlas 110m */
const ISO_NUMERIC: Record<string, string> = {
  US: '840',
  CN: '156',
  GB: '826',
  DE: '276',
  FR: '250',
  IN: '356',
  BR: '076',
  CA: '124',
  AU: '036',
  JP: '392',
  KR: '410',
  RU: '643',
  MX: '484',
  ES: '724',
  IT: '380',
  NL: '528',
  SE: '752',
  PL: '616',
  TR: '792',
  ID: '360',
  TH: '764',
  VN: '704',
  PH: '608',
  MY: '458',
  SG: '702',
  HK: '344',
  TW: '158',
  AR: '032',
  CL: '152',
  CO: '170',
  PE: '604',
  ZA: '710',
  EG: '818',
  NG: '566',
  KE: '404',
  AE: '784',
  SA: '682',
  IL: '376',
  UA: '804',
  RO: '642',
  CZ: '203',
  AT: '040',
  CH: '756',
  BE: '056',
  PT: '620',
  IE: '372',
  DK: '208',
  FI: '246',
  NO: '578',
  NZ: '554',
};

function countryCodeToGeoId(code: string): string | null {
  const upper = code.toUpperCase();
  if (ISO_NUMERIC[upper]) return ISO_NUMERIC[upper];
  if (/^\d+$/.test(code)) return code;
  return null;
}

export interface CountryMapProps {
  rows: Array<{ x: string; y: number }>;
  accent?: string;
  loading?: boolean;
}

type TooltipState = {
  label: string;
  value: number;
  x: number;
  y: number;
};

export function CountryMap({ rows, accent = 'var(--accent)', loading }: CountryMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [position, setPosition] = useState<MapPosition>(DEFAULT_POSITION);

  if (loading) {
    return <div className="country-map-wrap country-map-skeleton" aria-busy />;
  }

  const max = Math.max(1, ...rows.map((r) => r.y));
  const byGeoId = new Map<string, number>();
  const codeByGeoId = new Map<string, string>();

  for (const row of rows) {
    const geoId = countryCodeToGeoId(row.x);
    if (!geoId) continue;
    byGeoId.set(geoId, row.y);
    codeByGeoId.set(geoId, row.x.toUpperCase());
  }

  function fillForGeoId(geoId: string) {
    const count = byGeoId.get(geoId);
    if (!count) return 'var(--bg-subtle)';
    const intensity = 0.2 + (count / max) * 0.8;
    return `color-mix(in srgb, ${accent} ${Math.round(intensity * 100)}%, transparent)`;
  }

  function setTooltipFromEvent(label: string, value: number, clientX: number, clientY: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      label,
      value,
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }

  function clearTooltip() {
    setTooltip(null);
  }

  return (
    <div ref={wrapRef} className="country-map-wrap country-map-wrap--pan" onMouseLeave={clearTooltip}>
      <ComposableMap
        projectionConfig={{ scale: MAP_SCALE, center: MAP_CENTER }}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          minZoom={1}
          maxZoom={6}
          filterZoomEvent={mapZoomFilter}
          onMoveEnd={(next) => {
            setPosition({
              coordinates: next.coordinates as [number, number],
              zoom: next.zoom,
            });
          }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const geoId = String(geo.id);
                const count = byGeoId.get(geoId);
                const code = codeByGeoId.get(geoId);
                const name = code
                  ? getCountryLabel(code)
                  : ((geo.properties as { name?: string } | undefined)?.name ?? geoId);

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fillForGeoId(geoId)}
                    stroke="var(--border)"
                    strokeWidth={0.4}
                    style={{
                      default: { outline: 'none' },
                      hover: {
                        outline: 'none',
                        fill: count ? accent : fillForGeoId(geoId),
                        opacity: count ? 0.85 : 1,
                        cursor: count ? 'pointer' : 'inherit',
                      },
                      pressed: { outline: 'none' },
                    }}
                    onMouseEnter={
                      count
                        ? (e) => setTooltipFromEvent(name, count, e.clientX, e.clientY)
                        : undefined
                    }
                    onMouseMove={
                      count
                        ? (e) => setTooltipFromEvent(name, count, e.clientX, e.clientY)
                        : undefined
                    }
                    onMouseLeave={count ? clearTooltip : undefined}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
      {tooltip ? (
        <MapTooltip label={tooltip.label} value={tooltip.value} x={tooltip.x} y={tooltip.y} />
      ) : null}
    </div>
  );
}
