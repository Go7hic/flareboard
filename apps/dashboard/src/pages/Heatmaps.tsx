import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DateRangePicker } from '../components/DateRangePicker';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Panel } from '../components/ui/panel';
import { api, getToken, type Website } from '../lib/api';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { t } from '../lib/i18n';

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
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeLoadedRef = useRef(false);
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [urlPath, setUrlPath] = useState('/');
  const [kind, setKind] = useState<'click' | 'scroll'>('click');
  const [deviceClass, setDeviceClass] = useState('');
  const [range, setRange] = useState({
    preset: '30d' as DateRangePreset,
    ...presetToRange('30d'),
  });

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

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

  const rangeQs = rangeQueryString(range.startAt, range.endAt);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || overlay.max === 0) return;

    const displayW = Math.min(960, overlay.vw);
    const displayH = kind === 'scroll' ? 48 : Math.round((overlay.vh / overlay.vw) * displayW);
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
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
  }, [overlay, kind]);

  return (
    <div className="page">
      <WebsitePageShell websiteId={websiteId} />

      <Panel>
        <h2 className="section-title">{t('heatmaps')}</h2>
        <p className="section-lead">{t('heatmapsLead')}</p>

        {!heatmapsAllowed && billingQuery.data ? (
          <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
            {t('heatmapsRequiresUpgrade')}{' '}
            <Link to="/billing" className="shell-link">
              {t('upgradeTo')} Cloud
            </Link>
          </p>
        ) : null}

        <fieldset
          disabled={!heatmapsAllowed}
          style={{ border: 'none', margin: 0, padding: 0, opacity: heatmapsAllowed ? 1 : 0.6 }}
        >
        <div className="stats-toolbar" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <DateRangePicker value={range} onChange={setRange} />
          <div className="field" style={{ minWidth: '12rem' }}>
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
          <div className="field">
            <Label>{t('heatmapType')}</Label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                type="button"
                variant={kind === 'click' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setKind('click')}
              >
                {t('heatmapClicks')}
              </Button>
              <Button
                type="button"
                variant={kind === 'scroll' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setKind('scroll')}
              >
                {t('heatmapScroll')}
              </Button>
            </div>
          </div>
          <div className="field">
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
              className="heatmap-preview-wrap"
              style={{
                position: 'relative',
                maxWidth: '960px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                background: 'var(--bg-subtle)',
              }}
            >
              {previewUrl && (!iframeBlocked || iframeLoaded) ? (
                <iframe
                  title={t('heatmapPreview')}
                  src={previewUrl}
                  style={{
                    width: '100%',
                    height: kind === 'scroll' ? '120px' : '600px',
                    border: 'none',
                    opacity: 0.35,
                    pointerEvents: 'none',
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
                <div className="heatmap-iframe-fallback">
                  <p>{t('heatmapIframeBlocked')}</p>
                  <p className="text-muted">{t('heatmapIframeBlockedDetail')}</p>
                  <p className="text-muted">{t('heatmapOverlayOnly')}</p>
                </div>
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: kind === 'scroll' ? '48px' : '400px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.875rem',
                  }}
                >
                  {t('heatmapNoPreview')}
                </div>
              )}
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: kind === 'scroll' ? '48px' : 'auto',
                  pointerEvents: 'none',
                }}
                role="img"
                aria-label={t('heatmaps')}
              />
            </div>
            <div
              className="heatmap-legend"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginTop: '0.75rem',
                maxWidth: '960px',
                fontSize: '0.8125rem',
                color: 'var(--text-muted)',
              }}
            >
              <span>{t('heatmapLegendLow')}</span>
              <div
                style={{
                  flex: 1,
                  height: '8px',
                  borderRadius: '4px',
                  background: `linear-gradient(to right, transparent, var(--accent))`,
                }}
              />
              <span>{t('heatmapLegendHigh')}</span>
            </div>
            <p className="text-muted" style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
              {t('heatmapViewportHint').replace('{w}', String(overlay.vw)).replace('{h}', String(overlay.vh))}
            </p>
          </>
        )}
        </fieldset>
      </Panel>
    </div>
  );
}
