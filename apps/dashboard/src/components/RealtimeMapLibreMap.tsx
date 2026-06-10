import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import { MaplibreStarfieldLayer } from '@geoql/maplibre-gl-starfield';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Point } from 'geojson';
import type { RealtimeSession } from '../lib/api';
import { getCountryCentroid, jitterCoords } from '../lib/country-centroids';
import { getCountryLabel } from '../lib/map-format';
import { getMapStyleUrl } from '../lib/maplibre-config';
import { GLOBE_STARFIELD_URL } from '../lib/globe-visual-config';
import { t } from '../lib/i18n';
import { MapTooltip } from './MapTooltip';
import { RealtimeGlobeOverlay } from './RealtimeGlobeOverlay';

type RealtimeMapLibreMapProps = {
  sessions: RealtimeSession[];
  visitors: number;
  siteName?: string;
};

type TooltipState = {
  country: string;
  x: number;
  y: number;
};

const VISITOR_SOURCE = 'flareboard-visitors';
const VISITOR_GLOW_LAYER = 'flareboard-visitors-glow';
const VISITOR_DOT_LAYER = 'flareboard-visitors-dot';
const AUTO_ROTATE_DEG_PER_FRAME = 0.04;
/** Higher zoom = larger globe on screen (MapLibre globe projection). */
const DEFAULT_GLOBE_ZOOM = 2.45;

function sessionsToGeoJson(sessions: RealtimeSession[]): FeatureCollection<Point> {
  const perCountry = new Map<string, number>();
  const features: FeatureCollection<Point>['features'] = [];

  for (const session of sessions) {
    if (!session.country) continue;
    const country = session.country.toUpperCase();
    const base = getCountryCentroid(country);
    if (!base) continue;
    const index = perCountry.get(country) ?? 0;
    perCountry.set(country, index + 1);
    const [lng, lat] = jitterCoords(base, session.sessionId, index);
    features.push({
      type: 'Feature',
      properties: { country, sessionId: session.sessionId },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });
  }

  return { type: 'FeatureCollection', features };
}

function collapseMapAttribution(container: HTMLElement | null) {
  const attrib = container?.querySelector('.maplibregl-ctrl-attrib');
  if (!(attrib instanceof HTMLElement)) return;
  attrib.classList.remove('maplibregl-compact-show');
  attrib.removeAttribute('open');
}

function applyGlobeAtmosphere(map: MapLibreMap) {
  map.setProjection({ type: 'globe' });
  map.setSky({
    'horizon-color': '#89cff0',
    'fog-ground-blend': 0.12,
    'horizon-fog-blend': 0.05,
    'sky-horizon-blend': 0.5,
    'atmosphere-blend': 0.78,
  });
  map.setPadding({ top: 8, bottom: 36, left: 8, right: 8 });
}

function addStarfieldLayer(map: MapLibreMap) {
  const starfield = new MaplibreStarfieldLayer({
    galaxyTextureUrl: GLOBE_STARFIELD_URL,
    galaxyBrightness: 0.42,
    starCount: 3500,
    starSize: 1.8,
  });
  const firstLayerId = map.getStyle().layers?.[0]?.id;
  map.addLayer(starfield, firstLayerId);
}

function addVisitorLayers(map: MapLibreMap, data: FeatureCollection<Point>) {
  if (map.getSource(VISITOR_SOURCE)) {
    (map.getSource(VISITOR_SOURCE) as GeoJSONSource).setData(data);
    return;
  }

  map.addSource(VISITOR_SOURCE, { type: 'geojson', data });
  map.addLayer({
    id: VISITOR_GLOW_LAYER,
    type: 'circle',
    source: VISITOR_SOURCE,
    paint: {
      'circle-radius': 14,
      'circle-color': '#0d9488',
      'circle-opacity': 0.2,
      'circle-blur': 0.85,
    },
  });
  map.addLayer({
    id: VISITOR_DOT_LAYER,
    type: 'circle',
    source: VISITOR_SOURCE,
    paint: {
      'circle-radius': 5,
      'circle-color': '#0d9488',
      'circle-opacity': 0.92,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.85,
    },
  });
}

export function RealtimeMapLibreMap({ sessions, visitors, siteName }: RealtimeMapLibreMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef(sessions);
  const autoRotatingRef = useRef(true);
  const userInteractingRef = useRef(false);
  const rotateFrameRef = useRef<number | null>(null);

  const [autoRotating, setAutoRotating] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [mapReady, setMapReady] = useState(false);

  sessionsRef.current = sessions;
  autoRotatingRef.current = autoRotating;

  const visitorGeoJson = useMemo(() => sessionsToGeoJson(sessions), [sessions]);

  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (!session.country) continue;
      const country = session.country.toUpperCase();
      counts.set(country, (counts.get(country) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  const stopRotationLoop = useCallback(() => {
    if (rotateFrameRef.current !== null) {
      cancelAnimationFrame(rotateFrameRef.current);
      rotateFrameRef.current = null;
    }
  }, []);

  const startRotationLoop = useCallback(() => {
    stopRotationLoop();
    const tick = () => {
      const map = mapRef.current;
      if (map && autoRotatingRef.current && !userInteractingRef.current) {
        map.setBearing(map.getBearing() + AUTO_ROTATE_DEG_PER_FRAME);
      }
      rotateFrameRef.current = requestAnimationFrame(tick);
    };
    rotateFrameRef.current = requestAnimationFrame(tick);
  }, [stopRotationLoop]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: getMapStyleUrl(),
      center: [10, 22],
      zoom: DEFAULT_GLOBE_ZOOM,
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');

    map.on('load', () => {
      applyGlobeAtmosphere(map);
      addStarfieldLayer(map);
      addVisitorLayers(map, sessionsToGeoJson(sessionsRef.current));
      collapseMapAttribution(mapContainerRef.current);
      setMapReady(true);
    });

    map.on('mousedown', () => {
      userInteractingRef.current = true;
    });
    map.on('mouseup', () => {
      userInteractingRef.current = false;
    });
    map.on('dragend', () => {
      userInteractingRef.current = false;
    });
    map.on('zoomend', () => {
      userInteractingRef.current = false;
    });

    map.on('mousemove', (event: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: [VISITOR_DOT_LAYER] });
      const country = hits[0]?.properties?.country as string | undefined;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!country || !rect) {
        setTooltip(null);
        return;
      }
      setTooltip({
        country,
        x: event.originalEvent.clientX - rect.left,
        y: event.originalEvent.clientY - rect.top,
      });
    });
    map.on('mouseleave', () => setTooltip(null));

    return () => {
      stopRotationLoop();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [stopRotationLoop]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.getSource(VISITOR_SOURCE)) return;
    (map.getSource(VISITOR_SOURCE) as GeoJSONSource).setData(visitorGeoJson);
  }, [mapReady, visitorGeoJson]);

  useEffect(() => {
    if (!mapReady) return;
    if (autoRotating) startRotationLoop();
    else stopRotationLoop();
    return stopRotationLoop;
  }, [autoRotating, mapReady, startRotationLoop, stopRotationLoop]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new ResizeObserver(() => map.resize());
    if (mapContainerRef.current) observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, [mapReady]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleRotate = useCallback(() => {
    setAutoRotating((prev) => !prev);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* fullscreen may be blocked */
    }
  }, []);

  const tooltipCountry = tooltip?.country ?? null;
  const tooltipCount = tooltipCountry ? (countryCounts.get(tooltipCountry) ?? 0) : 0;

  return (
    <div
      ref={wrapRef}
      className="realtime-globe-wrap realtime-vector-map-wrap"
      style={{ ['--globe-starfield' as string]: `url(${GLOBE_STARFIELD_URL})` }}
      onMouseLeave={() => setTooltip(null)}
    >
      <div className={`realtime-vector-map-starfield${mapReady ? ' is-hidden' : ''}`} aria-hidden />
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
      <div ref={mapContainerRef} className="realtime-vector-map" aria-label={t('realtime')} />
      {!mapReady ? <div className="realtime-vector-map-loading skeleton" aria-hidden /> : null}
      {tooltip && tooltipCount > 0 ? (
        <MapTooltip label={getCountryLabel(tooltip.country)} value={tooltipCount} x={tooltip.x} y={tooltip.y} />
      ) : null}
    </div>
  );
}
