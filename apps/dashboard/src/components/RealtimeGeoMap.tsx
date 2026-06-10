import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeRef } from 'react-globe.gl';
import { geoCentroid } from 'd3-geo';
import { AmbientLight, DirectionalLight } from 'three';
import type { Feature, Geometry } from 'geojson';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import type { RealtimeSession } from '../lib/api';
import { RealtimeGlobeOverlay } from './RealtimeGlobeOverlay';
import { getCountryCentroid, jitterCoords } from '../lib/country-centroids';
import { buildGlobeLabels } from '../lib/globe-labels';
import { loadAdminRegions, type AdminRegionLabel } from '../lib/globe-admin-regions';
import {
  enableGlobePan,
  showAdminBoundaries,
  zoomTierFromAltitude,
  angularDistanceDeg,
  maxLabelSpreadDeg,
  type GlobePov,
  type GlobeZoomTier,
} from '../lib/globe-zoom-levels';
import {
  GLOBE_ATMOSPHERE_ALTITUDE,
  GLOBE_ATMOSPHERE_COLOR,
  GLOBE_CANVAS_BG,
  GLOBE_CITY_LABEL_COLOR,
  GLOBE_COUNTRY_LABEL_COLOR,
  GLOBE_STARFIELD_URL,
  useCartographicEarthTexture,
  useGlobeLabelFont,
} from '../lib/globe-visual-config';
import { getCountryLabel } from '../lib/map-format';
import { t } from '../lib/i18n';
import { MapTooltip } from './MapTooltip';
import { isMapLibreGlobeEnabled } from '../lib/maplibre-config';
import { RealtimeMapLibreMap } from './RealtimeMapLibreMap';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

/** Camera distance in globe-radius units — lower = closer / larger globe. */
const GLOBE_CAMERA_ALTITUDE = 1.32;

type RealtimeGeoMapProps = {
  sessions: RealtimeSession[];
  visitors: number;
  siteName?: string;
};

type MarkerPoint = {
  key: string;
  country: string;
  coordinates: [number, number];
};

type CountryGlobePoint = {
  country: string;
  lat: number;
  lng: number;
  count: number;
};

type GlobeLabel = {
  lat: number;
  lng: number;
  text: string;
  size: number;
  includeDot: boolean;
};

const GLOBE_ADMIN_STROKE = 'rgba(190, 88, 72, 0.42)';
const INITIAL_POV: GlobePov = { lat: 25, lng: 10, altitude: GLOBE_CAMERA_ALTITUDE };

function adminFeaturesInView(
  features: Feature<Geometry>[],
  pov: GlobePov,
  spreadDeg: number,
): Feature<Geometry>[] {
  return features.filter((feature) => {
    try {
      const [lng, lat] = geoCentroid(feature);
      return angularDistanceDeg(lat, lng, pov.lat, pov.lng) <= spreadDeg;
    } catch {
      return false;
    }
  });
}

type TooltipState = {
  country: string;
  x: number;
  y: number;
};

function isWebGLAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

function readCssColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

function useGlobeTheme() {
  const [theme, setTheme] = useState(() => ({
    point: readCssColor('--accent', '#0d9488'),
    pointGlow: readCssColor('--accent-muted', 'rgba(13, 148, 136, 0.35)'),
  }));

  useEffect(() => {
    function refresh() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme({
        point: readCssColor('--accent', isDark ? '#2dd4bf' : '#0d9488'),
        pointGlow: readCssColor('--accent-muted', isDark ? 'rgba(45, 212, 191, 0.35)' : 'rgba(13, 148, 136, 0.35)'),
      });
    }

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function RealtimeMap2D({ sessions, visitors, siteName }: RealtimeGeoMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* fullscreen may be blocked */
    }
  }, []);

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
      onMouseLeave={clearTooltip}
    >
      <RealtimeGlobeOverlay
        visitors={visitors}
        siteName={siteName}
        sessions={sessions}
        controls={{
          isFullscreen,
          onToggleFullscreen: toggleFullscreen,
        }}
      />
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

function tuneGlobeMaterial(scene: { traverse: (cb: (obj: unknown) => void) => void }) {
  scene.traverse((obj) => {
    const material = (obj as { material?: Record<string, unknown> }).material;
    if (!material?.map) return;
    material.bumpScale = 0;
    if ('roughness' in material) material.roughness = 1;
    if ('metalness' in material) material.metalness = 0;
    const color = material.color as { set?: (hex: string) => void } | undefined;
    if (color?.set) color.set('#ffffff');
    const emissive = material.emissive as { set?: (hex: string) => void } | undefined;
    if (emissive?.set) {
      emissive.set('#000000');
      material.emissiveIntensity = 0;
    }
  });
}

const GLOBE_AUTO_ROTATE_SPEED = 0.3;

function RealtimeGlobe({ sessions, visitors, siteName }: RealtimeGeoMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeRef | null>(null);
  const [size, setSize] = useState({ width: 800, height: 480 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [autoRotating, setAutoRotating] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mouseRef = useRef({ x: 0, y: 0 });
  const theme = useGlobeTheme();
  const labelFont = useGlobeLabelFont();
  const earthTexture = useCartographicEarthTexture();
  const [pov, setPov] = useState<GlobePov>(INITIAL_POV);
  const [zoomTier, setZoomTier] = useState<GlobeZoomTier>(() =>
    zoomTierFromAltitude(GLOBE_CAMERA_ALTITUDE),
  );
  const [adminRegions, setAdminRegions] = useState<{
    features: Feature<Geometry>[];
    labels: AdminRegionLabel[];
  } | null>(null);
  const zoomTierRef = useRef(zoomTier);
  zoomTierRef.current = zoomTier;

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    function onMove(event: MouseEvent) {
      mouseRef.current = { x: event.clientX, y: event.clientY };
    }
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const points = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (!session.country) continue;
      const country = session.country.toUpperCase();
      counts.set(country, (counts.get(country) ?? 0) + 1);
    }

    const result: CountryGlobePoint[] = [];
    for (const [country, count] of counts) {
      const centroid = getCountryCentroid(country);
      if (!centroid) continue;
      result.push({
        country,
        lng: centroid[0],
        lat: centroid[1],
        count,
      });
    }
    return result;
  }, [sessions]);

  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of points) {
      counts.set(point.country, point.count);
    }
    return counts;
  }, [points]);

  const mapLabels = useMemo(
    () => buildGlobeLabels(zoomTier, pov, adminRegions?.labels ?? []),
    [zoomTier, pov, adminRegions?.labels],
  );

  const adminPolygons = useMemo(() => {
    if (!adminRegions || !showAdminBoundaries(zoomTier)) return [];
    const spread = maxLabelSpreadDeg(zoomTier) * 1.1;
    return adminFeaturesInView(adminRegions.features, pov, spread);
  }, [adminRegions, zoomTier, pov]);

  useEffect(() => {
    if (!showAdminBoundaries(zoomTier) || adminRegions) return;
    loadAdminRegions()
      .then(setAdminRegions)
      .catch(() => {
        /* province layer optional */
      });
  }, [zoomTier, adminRegions]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    function measure() {
      const rect = el!.getBoundingClientRect();
      if (rect.width > 0) {
        setSize({
          width: Math.round(rect.width),
          height: Math.max(480, Math.round(rect.width * 0.58)),
        });
      }
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const applyGlobeControls = useCallback((rotating: boolean, tier: GlobeZoomTier = zoomTierRef.current) => {
    const controls = globeRef.current?.controls?.();
    if (!controls) return;
    controls.autoRotate = rotating;
    controls.autoRotateSpeed = rotating ? GLOBE_AUTO_ROTATE_SPEED : 0;
    controls.enablePan = enableGlobePan(tier);
    controls.enableZoom = true;
  }, []);

  const configureGlobeScene = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;

    globe.pointOfView({ lat: INITIAL_POV.lat, lng: INITIAL_POV.lng, altitude: INITIAL_POV.altitude }, 0);
    applyGlobeControls(autoRotating, zoomTierRef.current);

    const ambient = new AmbientLight(0xffffff, 1.85);
    const key = new DirectionalLight(0xffffff, 0.12);
    key.position.set(2.2, 1.1, 2.4);
    const fill = new DirectionalLight(0xffffff, 0.08);
    fill.position.set(-2.4, 0.4, -1.6);

    const globeApi = globe as GlobeRef & {
      lights?: (value: (AmbientLight | DirectionalLight)[]) => void;
    };
    globeApi.lights?.([ambient, key, fill]);

    const scene = globe.scene?.();
    if (scene) tuneGlobeMaterial(scene);
  }, [applyGlobeControls, autoRotating]);

  const onGlobeReady = useCallback(() => {
    configureGlobeScene();
  }, [configureGlobeScene]);

  useEffect(() => {
    configureGlobeScene();
  }, [configureGlobeScene]);

  const onGlobeZoom = useCallback((nextPov: GlobePov) => {
    setPov(nextPov);
    const tier = zoomTierFromAltitude(nextPov.altitude);
    setZoomTier(tier);
    applyGlobeControls(autoRotating, tier);
  }, [applyGlobeControls, autoRotating]);

  const toggleRotate = useCallback(() => {
    setAutoRotating((prev) => {
      const next = !prev;
      applyGlobeControls(next, zoomTierRef.current);
      return next;
    });
  }, [applyGlobeControls]);

  const toggleFullscreen = useCallback(async () => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* fullscreen may be blocked */
    }
  }, []);

  const setTooltipFromEvent = useCallback((country: string, clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      country,
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }, []);

  const clearTooltip = useCallback(() => setTooltip(null), []);

  const tooltipCountry = tooltip?.country ?? null;
  const tooltipCount = tooltipCountry ? (countryCounts.get(tooltipCountry) ?? 0) : 0;

  return (
    <div
      ref={wrapRef}
      className="realtime-globe-wrap"
      onMouseLeave={clearTooltip}
    >
      <RealtimeGlobeOverlay
        visitors={visitors}
        siteName={siteName}
        sessions={sessions}
        controls={{
          showRotate: true,
          autoRotating,
          onToggleRotate: toggleRotate,
          isFullscreen,
          onToggleFullscreen: toggleFullscreen,
        }}
      />
      {earthTexture ? (
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        backgroundColor={GLOBE_CANVAS_BG}
        backgroundImageUrl={GLOBE_STARFIELD_URL}
        globeImageUrl={earthTexture}
        bumpImageUrl={null}
        globeCurvatureResolution={6}
        showAtmosphere
        atmosphereColor={GLOBE_ATMOSPHERE_COLOR}
        atmosphereAltitude={GLOBE_ATMOSPHERE_ALTITUDE}
        showGraticules={false}
        polygonsData={adminPolygons}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={() => 'rgba(0, 0, 0, 0)'}
        polygonStrokeColor={() => GLOBE_ADMIN_STROKE}
        polygonAltitude={0.001}
        labelsData={mapLabels}
        labelLat="lat"
        labelLng="lng"
        labelText="text"
        labelSize="size"
        labelTypeFace={labelFont}
        labelColor={(label) =>
          (label as GlobeLabel).includeDot ? GLOBE_CITY_LABEL_COLOR : GLOBE_COUNTRY_LABEL_COLOR
        }
        labelAltitude={0.022}
        labelResolution={4}
        labelIncludeDot={(label) => (label as GlobeLabel).includeDot}
        labelDotRadius={(label) => ((label as GlobeLabel).size / 12) * 0.35}
        labelsTransitionDuration={0}
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointAltitude={0.03}
        pointRadius={0.18}
        pointColor={() => theme.point}
        pointResolution={18}
        ringsData={points}
        ringLat="lat"
        ringLng="lng"
        ringColor={() => theme.pointGlow}
        ringAltitude={0.004}
        ringMaxRadius={0.28}
        ringPropagationSpeed={0}
        ringRepeatPeriod={0}
        onGlobeReady={onGlobeReady}
        onZoom={onGlobeZoom}
        onPointHover={(point: object | null) => {
          if (point) {
            const { country } = point as CountryGlobePoint;
            setTooltipFromEvent(country, mouseRef.current.x, mouseRef.current.y);
          } else {
            clearTooltip();
          }
        }}
      />
      ) : null}
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

function RealtimeGeoMapFallback({ sessions, visitors, siteName }: RealtimeGeoMapProps) {
  const [webglOk] = useState(isWebGLAvailable);
  if (webglOk) {
    return (
      <RealtimeGlobe
        sessions={sessions}
        visitors={visitors}
        siteName={siteName}
      />
    );
  }
  return (
    <RealtimeMap2D
      sessions={sessions}
      visitors={visitors}
      siteName={siteName}
    />
  );
}

export function RealtimeGeoMap({ sessions, visitors, siteName }: RealtimeGeoMapProps) {
  if (isMapLibreGlobeEnabled()) {
    return (
      <RealtimeMapLibreMap
        sessions={sessions}
        visitors={visitors}
        siteName={siteName}
      />
    );
  }

  return (
    <RealtimeGeoMapFallback
      sessions={sessions}
      visitors={visitors}
      siteName={siteName}
    />
  );
}
