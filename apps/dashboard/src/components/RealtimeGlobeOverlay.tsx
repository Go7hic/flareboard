import { Check, Maximize2, Minimize2, Pause, Play, Share2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { RealtimeSession } from '../lib/api';
import { formatNumber } from '../lib/format';
import { BrandLogo } from './BrandLogo';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';
import { countryFlagEmoji } from '../lib/session-display';

const TOP_LIMIT = 4;

type PillRow = { key: string; label: string; count: number; flag?: string };

function rank(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_LIMIT);
}

function topReferrers(sessions: RealtimeSession[]): PillRow[] {
  return rank(sessions.map((session) => session.referrerDomain?.trim() || t('realtimeGlobeDirect'))).map(
    ([label, count]) => ({ key: label, label, count }),
  );
}

function topCountries(sessions: RealtimeSession[]): PillRow[] {
  return rank(sessions.filter((session) => session.country).map((session) => session.country!.toUpperCase())).map(
    ([code, count]) => ({ key: code, label: getCountryLabel(code), count, flag: countryFlagEmoji(code) }),
  );
}

function PillRowList({ label, rows }: { label: string; rows: PillRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="realtime-globe-overlay-grid-row">
      <span className="realtime-globe-overlay-grid-label">{label}</span>
      <div className="realtime-globe-overlay-pills">
        {rows.map((row) => (
          <span key={row.key} className="realtime-globe-overlay-pill">
            {row.flag ? (
              <span className="realtime-globe-overlay-pill-flag" aria-hidden>
                {row.flag}
              </span>
            ) : null}
            <span className="realtime-globe-overlay-pill-label">{row.label}</span>
            <span className="realtime-globe-overlay-pill-count">{formatNumber(row.count)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export type RealtimeGlobeOverlayControls = {
  showRotate?: boolean;
  autoRotating?: boolean;
  onToggleRotate?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
};

/**
 * Map chrome. On the page the KPI strip and breakdown cards carry the numbers, so the map only
 * shows its controls (share, rotate, fullscreen). In fullscreen (a wall display) it adds the
 * live summary card: brand, who is online, top referrers and countries.
 */
export function RealtimeGlobeOverlay({
  visitors,
  siteName,
  sessions,
  controls,
}: {
  visitors: number;
  siteName?: string;
  sessions: RealtimeSession[];
  controls?: RealtimeGlobeOverlayControls;
}) {
  const [shareCopied, setShareCopied] = useState(false);
  const fullscreen = Boolean(controls?.isFullscreen);
  const referrers = useMemo(() => (fullscreen ? topReferrers(sessions) : []), [fullscreen, sessions]);
  const countries = useMemo(() => (fullscreen ? topCountries(sessions) : []), [fullscreen, sessions]);

  const visitorCount = formatNumber(visitors);
  const statusLine = siteName
    ? t('realtimeGlobeVisitorsOn').replace('{count}', visitorCount).replace('{siteName}', siteName)
    : t('realtimeGlobeVisitorsCount').replace('{count}', visitorCount);

  const onShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }, []);

  const autoRotating = controls?.autoRotating ?? true;

  return (
    <>
      <div className="traffic-map-controls" role="toolbar" aria-label={t('realtime')}>
        <button
          type="button"
          className="traffic-map-control"
          onClick={onShare}
          aria-label={shareCopied ? t('shareCopied') : t('realtimeGlobeShare')}
          title={shareCopied ? t('shareCopied') : t('realtimeGlobeShare')}
        >
          {shareCopied ? <Check aria-hidden /> : <Share2 aria-hidden />}
        </button>
        {controls?.showRotate ? (
          <button
            type="button"
            className="traffic-map-control"
            onClick={controls.onToggleRotate}
            aria-pressed={!autoRotating}
            aria-label={autoRotating ? t('realtimeGlobeStopRotation') : t('realtimeGlobeStartRotation')}
            title={autoRotating ? t('realtimeGlobeStopRotation') : t('realtimeGlobeStartRotation')}
          >
            {autoRotating ? <Pause aria-hidden /> : <Play aria-hidden />}
          </button>
        ) : null}
        <button
          type="button"
          className="traffic-map-control"
          onClick={controls?.onToggleFullscreen}
          aria-pressed={fullscreen}
          aria-label={fullscreen ? t('realtimeGlobeExitFullscreen') : t('realtimeGlobeFullscreen')}
          title={fullscreen ? t('realtimeGlobeExitFullscreen') : t('realtimeGlobeFullscreen')}
        >
          {fullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </button>
      </div>

      {fullscreen ? (
        <div className="realtime-globe-overlay" role="region" aria-label={t('realtime')}>
          <div className="realtime-globe-overlay-header">
            <div className="realtime-globe-overlay-brand">
              <BrandLogo showWordmark={false} size={22} className="realtime-globe-overlay-logo" />
              <span className="realtime-globe-overlay-brand-text">
                <span className="realtime-globe-overlay-brand-name">Flareboard</span>
                <span className="realtime-globe-overlay-brand-sep" aria-hidden>
                  |
                </span>
                <span className="realtime-globe-overlay-brand-badge">{t('realtime')}</span>
              </span>
            </div>
          </div>
          <div className="realtime-globe-overlay-status">
            <span className="live-dot live-dot--accent" aria-hidden="true" />
            <p className="realtime-globe-overlay-status-text">{statusLine}</p>
          </div>
          <div className="realtime-globe-overlay-grid">
            <PillRowList label={t('realtimeGlobeReferrers')} rows={referrers} />
            <PillRowList label={t('realtimeGlobeCountries')} rows={countries} />
          </div>
        </div>
      ) : null}
    </>
  );
}
