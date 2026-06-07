import { ComposableMap, Geographies, Geography } from 'react-simple-maps';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

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
}

export function CountryMap({ rows, accent = '#6366f1' }: CountryMapProps) {
  const max = Math.max(1, ...rows.map((r) => r.y));
  const byGeoId = new Map<string, number>();

  for (const row of rows) {
    const geoId = countryCodeToGeoId(row.x);
    if (geoId) byGeoId.set(geoId, row.y);
  }

  function fillForGeoId(geoId: string) {
    const count = byGeoId.get(geoId);
    if (!count) return 'var(--panel-muted, #e5e7eb)';
    const intensity = 0.2 + (count / max) * 0.8;
    return `color-mix(in srgb, ${accent} ${Math.round(intensity * 100)}%, transparent)`;
  }

  return (
    <div className="country-map-wrap">
      <ComposableMap projectionConfig={{ scale: 140 }} width={800} height={400} style={{ width: '100%', height: 'auto' }}>
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const geoId = String(geo.id);
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fillForGeoId(geoId)}
                  stroke="var(--border, #d1d5db)"
                  strokeWidth={0.4}
                  style={{
                    default: { outline: 'none' },
                    hover: { outline: 'none', fill: accent, opacity: 0.85 },
                    pressed: { outline: 'none' },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
    </div>
  );
}
