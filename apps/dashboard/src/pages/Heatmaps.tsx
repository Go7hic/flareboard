import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { SegmentTabs } from '../components/SegmentTabs';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Panel } from '../components/ui/panel';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';

type HeatmapCell = { normX: number; normY: number; count: number };

type HeatmapResponse = {
  kind: 'click' | 'scroll';
  normSize: number;
  urlPath: string;
  maxCount: number;
  viewportW: number;
  viewportH: number;
  cells: HeatmapCell[];
};

type HeatmapPath = { urlPath: string; total: number };

const DEVICE_OPTIONS = [
  { value: '', labelKey: 'heatmapDeviceAll' as const },
  { value: 'desktop', labelKey: 'heatmapDeviceDesktop' as const },
  { value: 'mobile', labelKey: 'heatmapDeviceMobile' as const },
  { value: 'tablet', labelKey: 'heatmapDeviceTablet' as const },
];

function heatColor(intensity: number): string {
  const alpha = Math.round(intensity * 0.85 * 100) / 100;
  return `color-mix(in srgb, var(--accent) ${Math.round(alpha * 100)}%, transparent)`;
}

export default function HeatmapsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
    const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(960);
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeLoadedRef = useRef(false);
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [urlPath, setUrlPath] = useState('/');
  const [kind, setKind] = useState<'click' | 'scroll'>('click');
  const [deviceClass, setDeviceClass] = useState('');
  const { range, setRange, rangeQs } = useWebsiteRange(websiteId, '24h');

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api<{
        hosted: boolean;
        plan?: { heatmapsEnabled?: boolean };
      }>('/api/billing/subscription'),
  });

  const heatmapsAllowed =
    !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.heatmapsEnabled);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const pathsQuery = useQuery({
    queryKey: ['heatmap-paths', websiteId, range.startAt, range.endAt],
    enabled: Boolean(websiteId) && heatmapsAllowed,
    queryFn: () =>
      api<HeatmapPath[]>(`/api/websites/${websiteId}/heatmap/paths?${rangeQs}`),
  });

  useEffect(() => {
    const paths = pathsQuery.data ?? [];
    if (paths.length && !paths.some((p) => p.urlPath === urlPath)) {
      setUrlPath(paths[0]!.urlPath);
    }
  }, [pathsQuery.data, urlPath]);

  const deviceQs = deviceClass ? `&deviceClass=${deviceClass}` : '';
  const heatmapQuery = useQuery({
    queryKey: ['heatmap', websiteId, urlPath, kind, deviceClass, range.startAt, range.endAt],
    enabled: Boolean(websiteId) && heatmapsAllowed,
    queryFn: () =>
      api<HeatmapResponse>(
        `/api/websites/${websiteId}/heatmap?urlPath=${encodeURIComponent(urlPath)}&kind=${kind}&${rangeQs}${deviceQs}`,
      ),
  });

  const overlay = useMemo(() => {
    const data = heatmapQuery.data;
    const normSize = data?.normSize ?? 1000;
    const max = data?.maxCount ?? 0;
    const cells = data?.cells ?? [];
    const vw = data?.viewportW || 1280;
    const vh = data?.viewportH || 800;
    return { normSize, max, cells, vw, vh };
  }, [heatmapQuery.data]);

  const previewUrl = useMemo(() => {
    const heatmapConfig = (websiteQuery.data as { heatmapConfig?: { previewUrl?: string } } | undefined)
      ?.heatmapConfig;
    if (heatmapConfig?.previewUrl?.trim()) {
      return heatmapConfig.previewUrl.trim();
    }
    const domain = websiteQuery.data?.domain;
    if (!domain) return null;
    const base = domain.startsWith('http') ? domain : `https://${domain}`;
    try {
      const u = new URL(urlPath, base);
      return u.href;
    } catch {
      return null;
    }
  }, [websiteQuery.data, urlPath]);

  useEffect(() => {
    setIframeBlocked(false);
    setIframeLoaded(false);
    iframeLoadedRef.current = false;
    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    if (!previewUrl) return;
    iframeTimerRef.current = setTimeout(() => {
      if (!iframeLoadedRef.current) setIframeBlocked(true);
    }, 8000);
    return () => {
      if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    };
  }, [previewUrl, urlPath]);

  const stage = useMemo(() => {
    const stageW = Math.max(320, overlay.vw);
    const stageH = kind === 'scroll' ? 48 : Math.max(240, overlay.vh);
    const scale = containerWidth / stageW;
    const displayW = Math.max(1, Math.round(stageW * scale));
    const displayH = Math.max(1, Math.round(stageH * scale));
    return { stageW, stageH, scale, displayW, displayH };
  }, [overlay.vw, overlay.vh, kind, containerWidth]);

  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;

    const update = () => setContainerWidth(Math.max(320, el.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || overlay.max === 0) return;

    const { displayW, displayH } = stage;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayW, displayH);

    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0d9488';

    for (const cell of overlay.cells) {
      const intensity = cell.count / overlay.max;
      const x = (cell.normX / overlay.normSize) * displayW;
      const y = (cell.normY / overlay.normSize) * displayH;
      const radius = kind === 'scroll' ? displayW * 0.5 : Math.max(6, displayW * 0.025);
      ctx.fillStyle = accent;
      ctx.globalAlpha = Math.min(0.9, intensity * 0.85);
      ctx.beginPath();
      if (kind === 'scroll') {
        ctx.fillRect(0, y - 2, displayW, 4);
      } else {
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }, [overlay, kind, stage]);

  return (
    <div className="page">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} />
        }
      />

      <Panel>
        <p className="section-lead">{t('heatmapsLead')}</p>

        {!heatmapsAllowed && billingQuery.data ? (
          <PlanUpgradeBanner message={t('heatmapsRequiresUpgrade')} />
        ) : null}

        <fieldset
          disabled={!heatmapsAllowed}
          style={{ border: 'none', margin: 0, padding: 0, opacity: heatmapsAllowed ? 1 : 0.6 }}
        >
        <div className="heatmap-toolbar">
          <div className="field heatmap-toolbar-path">
            <Label htmlFor="heatmap-path">{t('heatmapPagePath')}</Label>
            {(pathsQuery.data ?? []).length > 0 ? (
              <select
                id="heatmap-path"
                className="select"
                value={urlPath}
                onChange={(e) => setUrlPath(e.target.value)}
              >
                {(pathsQuery.data ?? []).map((p) => (
                  <option key={p.urlPath} value={p.urlPath}>
                    {p.urlPath} ({p.total})
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="heatmap-path"
                value={urlPath}
                onChange={(e) => setUrlPath(e.target.value)}
                placeholder="/"
              />
            )}
          </div>
          <div className="field heatmap-toolbar-type">
            <Label>{t('heatmapType')}</Label>
            <SegmentTabs
              tabs={[
                { id: 'click', label: t('heatmapClicks') },
                { id: 'scroll', label: t('heatmapScroll') },
              ]}
              value={kind}
              onChange={(id) => setKind(id as 'click' | 'scroll')}
              aria-label={t('heatmapType')}
            />
          </div>
          <div className="field heatmap-toolbar-device">
            <Label htmlFor="heatmap-device">{t('heatmapDevice')}</Label>
            <select
              id="heatmap-device"
              className="select"
              value={deviceClass}
              onChange={(e) => setDeviceClass(e.target.value)}
            >
              {DEVICE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {t(d.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {heatmapQuery.isLoading ? (
          <p className="text-muted">{t('loading')}</p>
        ) : overlay.max === 0 ? (
          <p className="text-muted">{t('noHeatmapData')}</p>
        ) : (
          <>
            <div
              ref={previewWrapRef}
              className="heatmap-preview-wrap"
              style={{ height: `${stage.displayH}px` }}
            >
              <div className="heatmap-preview-scaler">
                {previewUrl && (!iframeBlocked || iframeLoaded) ? (
                  <iframe
                    title={t('heatmapPreview')}
                    className="heatmap-preview-iframe"
                    src={previewUrl}
                    style={{
                      width: `${stage.stageW}px`,
                      height: `${stage.stageH}px`,
                      transform: `scale(${stage.scale})`,
                    }}
                    sandbox="allow-same-origin"
                    onLoad={() => {
                      iframeLoadedRef.current = true;
                      setIframeLoaded(true);
                      setIframeBlocked(false);
                      if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
                    }}
                    onError={() => setIframeBlocked(true)}
                  />
                ) : previewUrl && iframeBlocked && !iframeLoaded ? (
                  <div
                    className="heatmap-preview-fallback heatmap-preview-iframe"
                    style={{
                      width: `${stage.stageW}px`,
                      height: `${stage.stageH}px`,
                      transform: `scale(${stage.scale})`,
                    }}
                  >
                    <p>{t('heatmapIframeBlocked')}</p>
                    <p className="text-muted">{t('heatmapIframeBlockedDetail')}</p>
                    <p className="text-muted">{t('heatmapOverlayOnly')}</p>
                  </div>
                ) : (
                  <div
                    className="heatmap-preview-empty heatmap-preview-iframe"
                    style={{
                      width: `${stage.stageW}px`,
                      height: `${stage.stageH}px`,
                      transform: `scale(${stage.scale})`,
                    }}
                  >
                    {t('heatmapNoPreview')}
                  </div>
                )}
                <canvas
                  ref={canvasRef}
                  className="heatmap-preview-canvas"
                  style={{
                    width: `${stage.displayW}px`,
                    height: `${stage.displayH}px`,
                  }}
                  role="img"
                  aria-label={t('heatmaps')}
                />
              </div>
            </div>
            <div className="heatmap-legend">
              <span>{t('heatmapLegendLow')}</span>
              <div className="heatmap-legend-steps" aria-hidden>
                {[0.15, 0.4, 0.7, 1].map((intensity) => (
                  <span
                    key={intensity}
                    className="heatmap-legend-step"
                    style={{ background: heatColor(intensity) }}
                  />
                ))}
              </div>
              <span>{t('heatmapLegendHigh')}</span>
            </div>
            <p className="heatmap-viewport-hint text-muted">
              {t('heatmapViewportHint').replace('{w}', String(overlay.vw)).replace('{h}', String(overlay.vh))}
            </p>
          </>
        )}
        </fieldset>
      </Panel>
    </div>
  );
}
