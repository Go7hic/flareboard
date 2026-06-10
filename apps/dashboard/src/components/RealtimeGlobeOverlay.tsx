import { useCallback, useMemo, useState } from 'react';
import type { RealtimeSession } from '../lib/api';
import { BrandLogo } from './BrandLogo';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';

const TOP_LIMIT = 4;

type BreakdownRow = { key: string; label: string; count: number; icon?: 'direct' | 'referrer' | 'desktop' | 'mobile' | 'tablet' | 'flag'; flagCode?: string };

function countryFlagEmoji(code: string): string {
  const cc = code.toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function topReferrers(sessions: RealtimeSession[], limit: number): BreakdownRow[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const raw = session.referrerDomain?.trim();
    const label = raw || t('realtimeGlobeDirect');
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      key: label,
      label,
      count,
      icon: label === t('realtimeGlobeDirect') ? 'direct' : 'referrer',
    }));
}

function topCountries(sessions: RealtimeSession[], limit: number): BreakdownRow[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (!session.country) continue;
    const code = session.country.toUpperCase();
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, count]) => ({
      key: code,
      label: getCountryLabel(code),
      count,
      icon: 'flag' as const,
      flagCode: code,
    }));
}

function topDevices(_sessions: RealtimeSession[], _limit: number): BreakdownRow[] {
  // RealtimeSession has no device field; realtime KV stores urlPath, referrer, country only.
  return [];
}

function PillIcon({ row }: { row: BreakdownRow }) {
  if (row.icon === 'flag' && row.flagCode) {
    const flag = countryFlagEmoji(row.flagCode);
    return flag ? <span className="realtime-globe-overlay-pill-flag" aria-hidden>{flag}</span> : null;
  }
  if (row.icon === 'direct') {
    return (
      <svg className="realtime-globe-overlay-pill-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  if (row.icon === 'desktop') {
    return (
      <svg className="realtime-globe-overlay-pill-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  if (row.icon === 'mobile') {
    return (
      <svg className="realtime-globe-overlay-pill-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  if (row.icon === 'tablet') {
    return (
      <svg className="realtime-globe-overlay-pill-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  return (
    <svg className="realtime-globe-overlay-pill-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function BreakdownGridRow({ label, rows }: { label: string; rows: BreakdownRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="realtime-globe-overlay-grid-row">
      <span className="realtime-globe-overlay-grid-label">{label}</span>
      <div className="realtime-globe-overlay-pills">
        {rows.map((row) => (
          <span key={row.key} className="realtime-globe-overlay-pill">
            <PillIcon row={row} />
            <span className="realtime-globe-overlay-pill-label">{row.label}</span>
            <span className="realtime-globe-overlay-pill-count">({row.count})</span>
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

  const referrers = useMemo(() => topReferrers(sessions, TOP_LIMIT), [sessions]);
  const countries = useMemo(() => topCountries(sessions, TOP_LIMIT), [sessions]);
  const devices = useMemo(() => topDevices(sessions, TOP_LIMIT), [sessions]);

  const statusLine = siteName
    ? t('realtimeGlobeVisitorsOn')
        .replace('{count}', visitors.toLocaleString())
        .replace('{siteName}', siteName)
    : t('realtimeGlobeVisitorsCount').replace('{count}', visitors.toLocaleString());

  const onShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }, []);

  const showRotate = controls?.showRotate ?? false;
  const autoRotating = controls?.autoRotating ?? true;

  return (
    <div className="realtime-globe-overlay" role="region" aria-label={t('realtime')}>
      <div className="realtime-globe-overlay-header">
        <div className="realtime-globe-overlay-brand">
          <BrandLogo showWordmark={false} size={22} className="realtime-globe-overlay-logo" />
          <span className="realtime-globe-overlay-brand-text">
            <span className="realtime-globe-overlay-brand-name">Flareboard</span>
            <span className="realtime-globe-overlay-brand-sep" aria-hidden>
              |
            </span>
            <span className="realtime-globe-overlay-brand-badge">{t('realtimeGlobeBadge')}</span>
          </span>
        </div>
        <div className="realtime-globe-overlay-actions">
          <button
            type="button"
            className="realtime-globe-overlay-action"
            onClick={onShare}
            aria-label={t('realtimeGlobeShare')}
            title={shareCopied ? t('shareCopied') : t('realtimeGlobeShare')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
            </svg>
          </button>
          {showRotate ? (
            <button
              type="button"
              className={`realtime-globe-overlay-action${autoRotating ? '' : ' is-active'}`}
              onClick={controls?.onToggleRotate}
              aria-label={autoRotating ? t('realtimeGlobeStopRotation') : t('realtimeGlobeStartRotation')}
              title={autoRotating ? t('realtimeGlobeStopRotation') : t('realtimeGlobeStartRotation')}
            >
              {autoRotating ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M21 12a9 9 0 1 1-9-9" />
                  <path d="M21 3v6h-6" />
                </svg>
              )}
            </button>
          ) : null}
          <button
            type="button"
            className={`realtime-globe-overlay-action${controls?.isFullscreen ? ' is-active' : ''}`}
            onClick={controls?.onToggleFullscreen}
            aria-label={controls?.isFullscreen ? t('realtimeGlobeExitFullscreen') : t('realtimeGlobeFullscreen')}
            title={controls?.isFullscreen ? t('realtimeGlobeExitFullscreen') : t('realtimeGlobeFullscreen')}
          >
            {controls?.isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {shareCopied ? (
        <p className="realtime-globe-overlay-toast" role="status">
          {t('shareCopied')}
        </p>
      ) : null}

      <div className="realtime-globe-overlay-status">
        <span className="live-dot live-dot--accent" aria-hidden="true" />
        <p className="realtime-globe-overlay-status-text">{statusLine}</p>
      </div>

      <div className="realtime-globe-overlay-grid">
        <BreakdownGridRow label={t('realtimeGlobeReferrers')} rows={referrers} />
        <BreakdownGridRow label={t('realtimeGlobeCountries')} rows={countries} />
        <BreakdownGridRow label={t('realtimeGlobeDevices')} rows={devices} />
      </div>
    </div>
  );
}
