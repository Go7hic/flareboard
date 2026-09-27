import { ArrowRight, MousePointer2, Play } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Switch } from '../ui/switch';
import { t } from '../../lib/i18n';

const LIVE_MINUTES = [
  9, 12, 10, 14, 13, 17, 15, 19, 16, 21, 18, 22, 20, 24, 19, 23, 26, 22, 25, 28, 24, 27, 31, 26, 29, 33, 30,
  34, 32, 37,
];

const LIVE_FEED = [
  { event: 'pageview', path: '/pricing', country: 'DE', ago: 0 },
  { event: 'signup_click', path: '/pricing', country: 'US', ago: 3 },
  { event: 'pageview', path: '/docs/getting-started', country: 'JP', ago: 7 },
  { event: 'checkout_start', path: '/checkout', country: 'FR', ago: 12 },
];

const FUNNEL = [
  { key: 'homeFunnelVisit', pct: 100 },
  { key: 'homeFunnelPricing', pct: 46 },
  { key: 'homeFunnelSignup', pct: 18 },
  { key: 'homeFunnelActivated', pct: 11 },
];

const RETENTION = [
  [100, 42, 31, 26, 22, 20, 18],
  [100, 45, 33, 27, 24, 21],
  [100, 39, 29, 24, 21],
  [100, 47, 35, 29],
  [100, 44, 32],
  [100, 41],
];

const FLAGS = [
  { key: 'new-checkout', rollout: 50, on: true },
  { key: 'pricing-page-v2', rollout: 100, on: true },
  { key: 'ai-summaries', rollout: 10, on: false },
];

const ISSUES = [
  {
    type: 'TypeError',
    message: "Cannot read properties of undefined (reading 'id')",
    events: 128,
    users: 34,
    level: 'error',
  },
  { type: 'ChunkLoadError', message: 'Loading chunk 7 failed', events: 41, users: 19, level: 'error' },
  { type: 'UnhandledRejection', message: '429 Too Many Requests', events: 12, users: 5, level: 'warning' },
];

const MORE_FEATURES = [
  'featHeatmapsTitle',
  'featWebVitalsTitle',
  'featUtmTitle',
  'featAttributionTitle',
  'featGoalsTitle',
  'featCohortsTitle',
  'featJourneysTitle',
  'featSurveysTitle',
  'featWorkflowsTitle',
  'featWarehouseTitle',
  'featAiObservabilityTitle',
  'featLogsTitle',
  'featRevenueTitle',
  'featEmailReportsTitle',
  'featShareLinksTitle',
  'featBoardsTitle',
  'featDataImportTitle',
  'featTeamsTitle',
];

function CellHead({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  return (
    <header className="home-cell-head">
      <h3 className="home-cell-title">{t(titleKey)}</h3>
      <p className="home-cell-body">{t(bodyKey)}</p>
    </header>
  );
}

function RealtimeVisual() {
  const max = Math.max(...LIVE_MINUTES);
  return (
    <div className="home-rt">
      <div className="home-rt-summary">
        <p className="home-rt-count">
          <span className="home-live-dot" aria-hidden />
          <span className="home-rt-number">{LIVE_MINUTES[LIVE_MINUTES.length - 1]}</span>
          <span className="home-rt-label">{t('homeBentoOnline')}</span>
        </p>
        <div className="home-rt-bars" aria-hidden>
          {LIVE_MINUTES.map((v, i) => (
            <span key={i} style={{ height: `${(v / max) * 100}%` }} />
          ))}
        </div>
      </div>
      <ul className="home-rt-feed">
        {LIVE_FEED.map((row) => (
          <li key={`${row.event}-${row.ago}`}>
            <span className="home-rt-event">{row.event}</span>
            <span className="home-rt-path">{row.path}</span>
            <span className="home-rt-country">{row.country}</span>
            <span className="home-rt-ago">{row.ago === 0 ? t('homeBentoNow') : `${row.ago}s`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FunnelVisual() {
  return (
    <ol className="home-funnel">
      {FUNNEL.map((step) => (
        <li key={step.key}>
          <span className="home-funnel-pct">{step.pct}%</span>
          <span className="home-funnel-track" aria-hidden>
            <span className="home-funnel-bar" style={{ height: `${step.pct}%` }} />
          </span>
          <span className="home-funnel-label">{t(step.key)}</span>
        </li>
      ))}
    </ol>
  );
}

function RetentionVisual() {
  return (
    <div className="home-retention" role="img" aria-label={t('homeRetentionCaption')}>
      {RETENTION.map((row, r) => (
        <div key={r} className="home-retention-row">
          {row.map((v, c) => (
            <span
              key={c}
              className={`home-retention-cell${v >= 60 ? ' is-strong' : ''}`}
              style={{ '--p': `${v}%` } as CSSProperties}
            >
              {v}
            </span>
          ))}
        </div>
      ))}
      <p className="home-retention-caption">{t('homeRetentionCaption')}</p>
    </div>
  );
}

function ReplayVisual() {
  return (
    <div className="home-replay" aria-hidden>
      <div className="home-replay-screen">
        <div className="home-replay-page">
          <span className="home-replay-line home-replay-line-nav" />
          <span className="home-replay-line home-replay-line-title" />
          <span className="home-replay-line" />
          <span className="home-replay-line home-replay-line-short" />
          <span className="home-replay-button" />
        </div>
        <span className="home-replay-cursor">
          <MousePointer2 />
          <span className="home-replay-click" />
        </span>
      </div>
      <div className="home-replay-controls">
        <Play className="home-replay-play" />
        <span className="home-replay-track">
          <span className="home-replay-progress" />
          <span className="home-replay-marker" style={{ left: '18%' }} />
          <span className="home-replay-marker" style={{ left: '37%' }} />
          <span className="home-replay-marker is-error" style={{ left: '64%' }} />
        </span>
        <span className="home-replay-time">0:42 / 1:38</span>
      </div>
    </div>
  );
}

function FlagsVisual() {
  const [state, setState] = useState(() => FLAGS.map((f) => f.on));
  return (
    <ul className="home-flags">
      {FLAGS.map((flag, i) => (
        <li key={flag.key}>
          <code className="home-flag-key">{flag.key}</code>
          <span className="home-flag-rollout">
            {state[i] ? t('homeFlagRollout').replace('{pct}', String(flag.rollout)) : t('homeFlagOff')}
          </span>
          <Switch
            checked={state[i]}
            onCheckedChange={(checked) =>
              setState((prev) => prev.map((v, j) => (j === i ? checked : v)))
            }
            aria-label={flag.key}
          />
        </li>
      ))}
    </ul>
  );
}

function IssuesVisual() {
  return (
    <table className="home-issues">
      <thead>
        <tr>
          <th scope="col">{t('homeBentoIssue')}</th>
          <th scope="col">{t('events')}</th>
          <th scope="col">{t('users')}</th>
        </tr>
      </thead>
      <tbody>
        {ISSUES.map((issue) => (
          <tr key={issue.type} className={`is-${issue.level}`}>
            <td>
              <span className="home-issue-type">{issue.type}</span>
              <span className="home-issue-message">{issue.message}</span>
            </td>
            <td className="home-issue-num">{issue.events}</td>
            <td className="home-issue-num">{issue.users}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LandingCapabilities() {
  return (
    <div className="home-bento">
      <article className="home-cell home-cell-realtime home-cell-tint">
        <CellHead titleKey="featRealtimeTitle" bodyKey="homeBentoRealtimeBody" />
        <RealtimeVisual />
      </article>
      <article className="home-cell home-cell-funnel">
        <CellHead titleKey="featFunnelTitle" bodyKey="homeBentoFunnelBody" />
        <FunnelVisual />
      </article>
      <article className="home-cell home-cell-retention">
        <CellHead titleKey="featRetentionTitle" bodyKey="homeBentoRetentionBody" />
        <RetentionVisual />
      </article>
      <article className="home-cell home-cell-replay home-cell-tint">
        <CellHead titleKey="featReplayTitle" bodyKey="homeBentoReplayBody" />
        <ReplayVisual />
      </article>
      <article className="home-cell home-cell-flags">
        <CellHead titleKey="homeBentoFlagsTitle" bodyKey="homeBentoFlagsBody" />
        <FlagsVisual />
      </article>
      <article className="home-cell home-cell-issues">
        <CellHead titleKey="featErrorsTitle" bodyKey="homeBentoErrorsBody" />
        <IssuesVisual />
      </article>
      <article className="home-cell home-cell-more home-cell-tint">
        <h3 className="home-cell-title">{t('homeBentoMoreTitle')}</h3>
        <ul className="home-chips">
          {MORE_FEATURES.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <Link to="/features" className="home-text-link">
          {t('featuresViewAll')}
          <ArrowRight aria-hidden />
        </Link>
      </article>
    </div>
  );
}
