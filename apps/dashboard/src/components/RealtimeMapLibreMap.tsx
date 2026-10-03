import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Point } from 'geojson';
import type { RealtimeSession } from '../lib/api';
import { getCountryCentroid, jitterCoords } from '../lib/country-centroids';
import { getCountryLabel } from '../lib/map-format';
import { getMapStyleUrl } from '../lib/maplibre-config';
import {
  MAPLIBRE_GLOBE_BG,
  MAPLIBRE_GLOBE_FOG,
} from '../lib/globe-visual-config';
import { t } from '../lib/i18n';
import { createSessionAvatarElement } from '../lib/session-avatar';
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

type VisitorMarkerPoint = {
  sessionId: string;
  country: string;
  lng: number;
  lat: number;
};

/** Degrees of longitude the globe turns per animation frame (about one turn every two minutes). */
const AUTO_SPIN_DEG_PER_FRAME = 0.05;
/** Latitude the camera looks at: the northern half, where most visitors are, stays in view. */
const DEFAULT_CENTER_LAT = 25;
/** Share of the container's shorter side the whole globe should take up. */
const GLOBE_FIT = 0.9;

/**
 * Zoom at which the whole globe fits the container: with the globe projection its diameter is
 * worldSize / π, and worldSize is 512 · 2^zoom.
 */
function globeFitZoom(container: HTMLElement) {
  const side = Math.min(container.clientWidth, container.clientHeight) || 460;
  return Math.log2((side * GLOBE_FIT * Math.PI) / 512);
}

/** Average longitude of the visitors (on the circle, so 170° and -170° average to 180°). */
function meanLongitude(points: VisitorMarkerPoint[]) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += Math.cos((point.lng * Math.PI) / 180);
    y += Math.sin((point.lng * Math.PI) / 180);
  }
  return (Math.atan2(y, x) * 180) / Math.PI;
}
const AVATAR_MARKER_SIZE = 36;

function sessionsToMarkerPoints(sessions: RealtimeSession[]): VisitorMarkerPoint[] {
  const perCountry = new Map<string, number>();
  const points: VisitorMarkerPoint[] = [];

  for (const session of sessions) {
    if (!session.country) continue;
    const country = session.country.toUpperCase();
    const base = getCountryCentroid(country);
    if (!base) continue;
    const index = perCountry.get(country) ?? 0;
    perCountry.set(country, index + 1);
    const [lng, lat] = jitterCoords(base, session.sessionId, index);
    points.push({ sessionId: session.sessionId, country, lng, lat });
  }

  return points;
}

function sessionsToGeoJson(points: VisitorMarkerPoint[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      properties: { country: point.country, sessionId: point.sessionId },
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    })),
  };
}

function collapseMapAttribution(container: HTMLElement | null) {
  const attrib = container?.querySelector('.maplibregl-ctrl-attrib');
  if (!(attrib instanceof HTMLElement)) return;
  attrib.classList.remove('maplibregl-compact-show');
  attrib.removeAttribute('open');
}

function applyGlobeAtmosphere(map: MapLibreMap) {
  map.setProjection({ type: 'globe' });
  // atmosphere-blend > 0 draws a bright rim at high zoom — disable on our light sky.
  map.setSky({
    'sky-color': MAPLIBRE_GLOBE_BG,
    'horizon-color': MAPLIBRE_GLOBE_BG,
    'fog-color': MAPLIBRE_GLOBE_FOG,
    'fog-ground-blend': 0,
    'horizon-fog-blend': 0,
    'sky-horizon-blend': 0,
    'atmosphere-blend': 0,
  });
  map.setPadding({ top: 0, bottom: 12, left: 0, right: 0 });
}

function createAvatarMarkerElement(
  point: VisitorMarkerPoint,
  onHover: (country: string, clientX: number, clientY: number) => void,
  onLeave: () => void,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'realtime-map-avatar-marker';
  wrap.appendChild(createSessionAvatarElement(point.sessionId, AVATAR_MARKER_SIZE));

  wrap.addEventListener('mouseenter', (event) => {
    onHover(point.country, event.clientX, event.clientY);
  });
  wrap.addEventListener('mousemove', (event) => {
    onHover(point.country, event.clientX, event.clientY);
  });
  wrap.addEventListener('mouseleave', onLeave);

  return wrap;
}

export function RealtimeMapLibreMap({ sessions, visitors, siteName }: RealtimeMapLibreMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const autoRotatingRef = useRef(true);
  const userInteractingRef = useRef(false);
  const rotateFrameRef = useRef<number | null>(null);

  const [autoRotating, setAutoRotating] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [mapReady, setMapReady] = useState(false);

  autoRotatingRef.current = autoRotating;

  const markerPoints = useMemo(() => sessionsToMarkerPoints(sessions), [sessions]);
  const visitorGeoJson = useMemo(() => sessionsToGeoJson(markerPoints), [markerPoints]);

  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of markerPoints) {
      counts.set(point.country, (counts.get(point.country) ?? 0) + 1);
    }
    return counts;
  }, [markerPoints]);

  const showMarkerTooltip = useCallback((country: string, clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      country,
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }, []);

  const clearMarkerTooltip = useCallback(() => setTooltip(null), []);

  const syncAvatarMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const nextIds = new Set<string>();
    for (const point of markerPoints) {
      nextIds.add(point.sessionId);
      const lngLat: [number, number] = [point.lng, point.lat];
      const existing = markersRef.current.get(point.sessionId);

      if (existing) {
        existing.setLngLat(lngLat);
        continue;
      }

      const element = createAvatarMarkerElement(point, showMarkerTooltip, clearMarkerTooltip);
      const marker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(map);
      markersRef.current.set(point.sessionId, marker);
    }

    for (const [sessionId, marker] of markersRef.current) {
      if (nextIds.has(sessionId)) continue;
      marker.remove();
      markersRef.current.delete(sessionId);
    }
  }, [markerPoints, showMarkerTooltip, clearMarkerTooltip]);

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
        // Spin around the poles (changing the bearing only turned the view in place).
        const center = map.getCenter();
        map.setCenter([center.lng + AUTO_SPIN_DEG_PER_FRAME, center.lat]);
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
      center: [10, DEFAULT_CENTER_LAT],
      zoom: globeFitZoom(container),
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');

    map.on('load', () => {
      applyGlobeAtmosphere(map);
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

    return () => {
      stopRotationLoop();
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [stopRotationLoop]);

  useEffect(() => {
    if (!mapReady) return;
    syncAvatarMarkers();
  }, [mapReady, syncAvatarMarkers]);

  // The first time visitors show up, turn the globe toward them (the spin carries on from there).
  const facedVisitorsRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || facedVisitorsRef.current || !markerPoints.length) return;
    facedVisitorsRef.current = true;
    if (userInteractingRef.current) return;
    // A jump, not easeTo: the spin sets the center every frame and would cancel an animation.
    map.jumpTo({ center: [meanLongitude(markerPoints), DEFAULT_CENTER_LAT] });
  }, [mapReady, markerPoints]);

  useEffect(() => {
    if (!mapReady) return;
    if (autoRotating) startRotationLoop();
    else stopRotationLoop();
    return stopRotationLoop;
  }, [autoRotating, mapReady, startRotationLoop, stopRotationLoop]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new ResizeObserver(() => {
      map.resize();
      if (mapContainerRef.current) map.setZoom(globeFitZoom(mapContainerRef.current));
    });
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
  const geoSessionCount = visitorGeoJson.features.length;
  const showGeoHint = mapReady && visitors > 0 && geoSessionCount === 0;

  return (
    <div
      ref={wrapRef}
      className="realtime-globe-wrap realtime-vector-map-wrap"
      onMouseLeave={clearMarkerTooltip}
    >
      <div className={`realtime-vector-map-sky${mapReady ? ' is-hidden' : ''}`} aria-hidden />
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
      {showGeoHint ? (
        <p className="realtime-globe-geo-hint" role="status">
          {t('realtimeGlobeLocationUnknown')}
        </p>
      ) : null}
      {tooltip && tooltipCount > 0 ? (
        <MapTooltip label={getCountryLabel(tooltip.country)} value={tooltipCount} x={tooltip.x} y={tooltip.y} />
      ) : null}
    </div>
  );
}
