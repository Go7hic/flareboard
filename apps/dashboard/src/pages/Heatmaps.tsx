import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Flame, MousePointerClick } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { PlanUpgradeBanner } from '../components/PlanUpgradeBanner';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { InlineSelect, Segmented } from '../components/behavior/QueryCard';
import { formatRate } from '../components/behavior/format';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { api, type Website } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { cn } from '../lib/utils';

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
type HeatmapKind = 'click' | 'scroll';

const DEVICE_OPTIONS = [
  { value: '', labelKey: 'heatmapDeviceAll' },
  { value: 'desktop', labelKey: 'heatmapDeviceDesktop' },
  { value: 'mobile', labelKey: 'heatmapDeviceMobile' },
  { value: 'tablet', labelKey: 'heatmapDeviceTablet' },
] as const;

/** Steps of the overlay legend: the same slot-1 hue at rising strength, like the canvas. */
const LEGEND_STEPS = [0.15, 0.35, 0.55, 0.75, 0.9];
const PREVIEW_PREF_KEY = 'flareboard-heatmap-preview';

function readPreviewPref(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePreviewPref(on: boolean) {
  try {
    window.localStorage.setItem(PREVIEW_PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Private windows can refuse storage; the toggle still works for this visit.
  }
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
  const [kind, setKind] = useState<HeatmapKind>('click');
  const [deviceClass, setDeviceClass] = useState('');
  const [showPreview, setShowPreview] = useState(readPreviewPref);
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api<{
        hosted: boolean;
        plan?: { heatmapsEnabled?: boolean };
      }>('/api/billing/subscription'),
  });

  const heatmapsAllowed = !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.heatmapsEnabled);
  const planBlocked = !heatmapsAllowed && Boolean(billingQuery.data);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const pathsQuery = useQuery({
    queryKey: ['heatmap-paths', websiteId, range.startAt, range.endAt],
    enabled: Boolean(websiteId) && heatmapsAllowed,
    queryFn: () => api<HeatmapPath[]>(`/api/websites/${websiteId}/heatmap/paths?${rangeQs}`),
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
    placeholderData: keepPreviousData,
  });

  // A placeholder from another kind is not drawable (click cells vs scroll depths).
  const data = heatmapQuery.data?.kind === kind ? heatmapQuery.data : undefined;

  const overlay = useMemo(() => {
    const normSize = data?.normSize ?? 1000;
    const max = data?.maxCount ?? 0;
    const cells = data?.cells ?? [];
    const vw = data?.viewportW || 1280;
    const vh = data?.viewportH || 800;
    const total = cells.reduce((sum, cell) => sum + cell.count, 0);
    return { normSize, max, cells, vw, vh, total };
  }, [data]);

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

  // Unreachable sites (a typo, a staging host, DNS failure) would frame a browser error page;
  // a no-cors probe catches those so the overlay sits on a clean surface instead.
  const reachQuery = useQuery({
    queryKey: ['heatmap-preview-reach', previewUrl],
    enabled: Boolean(previewUrl) && showPreview && kind === 'click',
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        await fetch(previewUrl!, { mode: 'no-cors', credentials: 'omit', cache: 'no-store' });
        return true;
      } catch {
        return false;
      }
    },
  });

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
    const stageH = Math.max(240, overlay.vh);
    const scale = containerWidth / stageW;
    const displayW = Math.max(1, Math.round(stageW * scale));
    const displayH = Math.max(1, Math.round(stageH * scale));
    return { stageW, stageH, scale, displayW, displayH };
  }, [overlay.vw, overlay.vh, containerWidth]);

  const showClickStage = kind === 'click' && overlay.max > 0;

  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const update = () => setContainerWidth(Math.max(280, el.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showClickStage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showClickStage) return;

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
      getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim() ||
      getComputedStyle(document.documentElement).getPropertyValue('--geist-blue-700').trim() ||
      '#006bff';

    // One 8–16px mark per recorded spot; overlapping marks build up where clicks cluster.
    const radius = Math.min(16, Math.max(5, displayW * 0.012));
    for (const cell of overlay.cells) {
      const intensity = cell.count / overlay.max;
      const x = (cell.normX / overlay.normSize) * displayW;
      const y = (cell.normY / overlay.normSize) * displayH;
      ctx.fillStyle = accent;
      ctx.globalAlpha = Math.min(0.85, 0.08 + intensity * 0.77);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [overlay, stage, showClickStage]);

  const paths = pathsQuery.data ?? [];
  // Frame the page only once the probe answered; until then the overlay sits on a clean surface.
  const framePreview =
    showPreview && Boolean(previewUrl) && reachQuery.data === true && !(iframeBlocked && !iframeLoaded);
  const previewNote = !showPreview
    ? null
    : !previewUrl
      ? t('behaviorHeatmapNoPreview')
      : reachQuery.data === false || (iframeBlocked && !iframeLoaded)
        ? t('behaviorHeatmapPreviewBlocked')
        : null;
  const deviceLabel = t(DEVICE_OPTIONS.find((option) => option.value === deviceClass)?.labelKey ?? 'heatmapDeviceAll');

  const toolbar = heatmapsAllowed ? (
    <div className="behavior-toolbar">
      {paths.length ? (
        <InlineSelect
          className="behavior-heatmap-page"
          label={t('behaviorHeatmapPage')}
          value={urlPath}
          onChange={setUrlPath}
          options={paths.map((path) => ({ value: path.urlPath, label: `${path.urlPath}  ·  ${formatNumber(path.total)}` }))}
        />
      ) : (
        <Input
          className="behavior-toolbar-input mono"
          value={urlPath}
          onChange={(event) => setUrlPath(event.target.value)}
          placeholder="/"
          aria-label={t('heatmapPagePath')}
        />
      )}
      <Segmented
        value={kind}
        onChange={setKind}
        label={t('heatmapType')}
        options={[
          { value: 'click', label: t('heatmapClicks') },
          { value: 'scroll', label: t('heatmapScroll') },
        ]}
      />
      <InlineSelect
        label={t('heatmapDevice')}
        value={deviceClass}
        onChange={setDeviceClass}
        options={DEVICE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
      />
      {kind === 'click' ? (
        <>
          <span className="behavior-toolbar-spacer" />
          <label className="behavior-toolbar-switch">
            <Switch
              size="sm"
              checked={showPreview}
              onCheckedChange={(checked) => {
                setShowPreview(checked);
                writePreviewPref(checked);
              }}
            />
            {t('heatmapPreview')}
          </label>
        </>
      ) : null}
    </div>
  ) : null;

  const loading = heatmapQuery.isLoading && !data;
  const description =
    kind === 'click'
      ? t('behaviorHeatmapClickSummary')
          .replace('{n}', formatNumber(overlay.total))
          .replace('{device}', deviceLabel)
          .replace('{w}', String(overlay.vw))
          .replace('{h}', String(overlay.vh))
      : t('behaviorHeatmapScrollSummary').replace('{n}', formatNumber(overlay.total)).replace('{device}', deviceLabel);

  return (
    <Page className="page-heatmaps">
      <PageHeader
        title={t('heatmaps')}
        lead={t('behaviorHeatmapsLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
        toolbar={toolbar}
      />

      <PageBody className="stack">
        {planBlocked ? (
          <>
            <PlanUpgradeBanner message={t('heatmapsRequiresUpgrade')} />
            <EmptyState
              variant="rich"
              icon={<Flame strokeWidth={2} />}
              title={t('heatmaps')}
              description={t('behaviorHeatmapsLead')}
            />
          </>
        ) : (
          <SectionCard
            className={cn('behavior-heatmap-card', heatmapQuery.isPlaceholderData && 'behavior-refetching')}
            title={<span className="mono behavior-heatmap-title">{urlPath}</span>}
            description={loading || overlay.max === 0 ? undefined : description}
            actions={kind === 'click' && showClickStage ? <HeatmapLegend /> : undefined}
          >
            {loading ? (
              <Skeleton className="behavior-heatmap-skeleton w-full" />
            ) : heatmapQuery.isError ? (
              <EmptyState
                title={t('dataLoadFailed')}
                description={(heatmapQuery.error as Error).message}
                tone="danger"
              />
            ) : overlay.max === 0 ? (
              <EmptyState
                icon={<MousePointerClick strokeWidth={2} />}
                title={t('noHeatmapData')}
                description={t('behaviorHeatmapEmptyBody')}
              />
            ) : kind === 'scroll' ? (
              <ScrollDepthBars cells={overlay.cells} normSize={overlay.normSize} total={overlay.total} />
            ) : (
              <div className="behavior-heatmap-frame">
                <div className="behavior-heatmap-frame-bar">
                  <span className="behavior-heatmap-frame-url" title={previewUrl ?? urlPath}>
                    {(previewUrl ?? urlPath).replace(/^https?:\/\//, '')}
                  </span>
                  {previewNote ? (
                    <StatusBadge tone="neutral" dot={false} title={t('heatmapIframeBlockedDetail')}>
                      {previewNote}
                    </StatusBadge>
                  ) : null}
                </div>
                <div ref={previewWrapRef} className="behavior-heatmap-stage" style={{ height: `${stage.displayH}px` }}>
                  {framePreview && previewUrl ? (
                    <iframe
                      title={t('heatmapPreview')}
                      className="behavior-heatmap-iframe"
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
                  ) : null}
                  <canvas
                    ref={canvasRef}
                    className="behavior-heatmap-canvas"
                    style={{ width: `${stage.displayW}px`, height: `${stage.displayH}px` }}
                    role="img"
                    aria-label={`${t('heatmaps')}: ${urlPath}`}
                  />
                </div>
              </div>
            )}
          </SectionCard>
        )}
      </PageBody>
    </Page>
  );
}

function HeatmapLegend() {
  return (
    <span className="behavior-heatmap-legend">
      <span>{t('heatmapLegendLow')}</span>
      {LEGEND_STEPS.map((step) => (
        <span
          key={step}
          className="behavior-heatmap-legend-step"
          style={{ background: `color-mix(in srgb, var(--chart-1) ${Math.round(step * 100)}%, transparent)` }}
          aria-hidden
        />
      ))}
      <span>{t('heatmapLegendHigh')}</span>
    </span>
  );
}

/** Scroll heatmap: how many scroll events reached each 10% of the page, top to bottom. */
function ScrollDepthBars({ cells, normSize, total }: { cells: HeatmapCell[]; normSize: number; total: number }) {
  const rows = [...cells]
    .map((cell) => ({ depth: Math.round((cell.normY / normSize) * 100), count: cell.count }))
    .sort((a, b) => a.depth - b.depth);
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="behavior-scroll-depth" role="table" aria-label={t('heatmapScroll')}>
      <div className="behavior-scroll-depth-row behavior-scroll-depth-head" role="row">
        <span role="columnheader">{t('behaviorHeatmapDepth')}</span>
        <span role="columnheader" aria-hidden />
        <span role="columnheader">{t('behaviorHeatmapScrollEvents')}</span>
        <span role="columnheader">{t('behaviorShare')}</span>
      </div>
      {rows.map((row) => (
        <div key={row.depth} className="behavior-scroll-depth-row" role="row">
          <span role="cell" className="behavior-scroll-depth-label">
            {formatRate(row.depth)}
          </span>
          <span role="cell" className="behavior-scroll-depth-bar" aria-hidden>
            <span style={{ width: `${(row.count / max) * 100}%` }} />
          </span>
          <span role="cell" className="num">
            {formatNumber(row.count)}
          </span>
          <span role="cell" className="num behavior-scroll-depth-share">
            {formatRate(total > 0 ? (row.count / total) * 100 : null)}
          </span>
        </div>
      ))}
    </div>
  );
}
