import {
  Activity,
  ArrowUpRight,
  Bug,
  CalendarDays,
  CirclePlay,
  Filter,
  Flag,
  LayoutDashboard,
  MousePointerClick,
  Repeat,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { getLocale, t } from '../../lib/i18n';
import { compactNumber, smoothPath } from './landing-format';

const DAYS = 30;
const WEEKLY = [0, 240, 360, 310, 250, -430, -570];

/** Deterministic sample traffic: weekly rhythm, slow growth, a little noise. */
const TRAFFIC = Array.from({ length: DAYS }, (_, i) => {
  const pageviews = Math.round(2650 + i * 31 + WEEKLY[i % 7] + 170 * Math.sin(i * 1.7));
  const visitors = Math.round(pageviews * 0.31 + 45 * Math.sin(i * 2.3));
  return { pageviews, visitors };
});

const TOP_PAGES = [
  { label: '/', value: 21480 },
  { label: '/pricing', value: 12930 },
  { label: '/docs/getting-started', value: 9870 },
  { label: '/blog/edge-analytics', value: 6120 },
];

const TOP_SOURCES = [
  { label: 'google.com', value: 11620 },
  { label: 'Direct', value: 9340 },
  { label: 'github.com', value: 4810 },
  { label: 'news.ycombinator.com', value: 3150 },
];

const NAV: { key: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'navOverview', icon: LayoutDashboard },
  { key: 'realtime', icon: Activity },
  { key: 'events', icon: MousePointerClick },
  { key: 'funnel', icon: Filter },
  { key: 'retention', icon: Repeat },
  { key: 'sessionReplay', icon: CirclePlay },
  { key: 'featureFlags', icon: Flag },
  { key: 'errors', icon: Bug },
];

const CHART_W = 600;
const CHART_H = 168;
const CHART_PAD = 6;

function chartScale(max: number) {
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = Math.ceil(max / step) * step;
  const toPoint = (v: number, i: number): [number, number] => [
    (i / (DAYS - 1)) * CHART_W,
    CHART_H - CHART_PAD - (v / niceMax) * (CHART_H - CHART_PAD * 2),
  ];
  return { niceMax, toPoint };
}

function TrafficChart() {
  const max = Math.max(...TRAFFIC.map((d) => d.pageviews));
  const { niceMax, toPoint } = chartScale(max);
  const pv = TRAFFIC.map((d, i) => toPoint(d.pageviews, i));
  const uv = TRAFFIC.map((d, i) => toPoint(d.visitors, i));
  const pvLine = smoothPath(pv);
  const uvLine = smoothPath(uv);
  const baseline = CHART_H - CHART_PAD;
  const pvArea = `${pvLine} L${CHART_W},${baseline} L0,${baseline} Z`;
  const ticks = [1, 0.5, 0];

  const locale = getLocale();
  const dayFormat = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const today = new Date();
  const labelDays = [DAYS - 1, 22, 15, 8, 0];
  const xLabels = labelDays.map((ago) => {
    const d = new Date(today);
    d.setDate(today.getDate() - ago);
    return dayFormat.format(d);
  });

  return (
    <div className="home-preview-chart">
      <div className="home-preview-chart-y" aria-hidden>
        {ticks.map((f) => (
          <span key={f}>{compactNumber(niceMax * f)}</span>
        ))}
      </div>
      <div className="home-preview-chart-plot">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden>
          {ticks.map((f) => {
            const y = CHART_H - CHART_PAD - f * (CHART_H - CHART_PAD * 2);
            return (
              <line
                key={f}
                x1={0}
                x2={CHART_W}
                y1={y}
                y2={y}
                className="home-preview-grid"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <path d={pvArea} className="home-preview-area" />
          <path
            d={uvLine}
            className="home-preview-line home-preview-line-visitors"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={pvLine}
            className="home-preview-line home-preview-line-pageviews"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="home-preview-chart-x" aria-hidden>
          {xLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function RankedList({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = rows[0]?.value ?? 1;
  return (
    <div className="home-preview-panel">
      <p className="home-preview-panel-title">{title}</p>
      <ul className="home-preview-ranked">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="home-preview-ranked-label">{row.label}</span>
            <span className="home-preview-ranked-value">{compactNumber(row.value)}</span>
            <span
              className="home-preview-ranked-bar"
              style={{ width: `${(row.value / max) * 100}%` }}
              aria-hidden
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingProductPreview() {
  const pageviews = TRAFFIC.reduce((sum, d) => sum + d.pageviews, 0);
  const visitors = TRAFFIC.reduce((sum, d) => sum + d.visitors, 0);
  const kpis = [
    { key: 'pageviews', value: compactNumber(pageviews), delta: '+12.4%', good: true },
    { key: 'visitors', value: compactNumber(visitors), delta: '+8.1%', good: true },
    { key: 'visits', value: compactNumber(Math.round(visitors * 1.27)), delta: '+9.6%', good: true },
    { key: 'bounceRate', value: '38.6%', delta: '-2.1%', good: true },
    { key: 'landingDataStatAvgSession', value: '2m 41s', delta: '+14s', good: true },
  ];

  return (
    <Link to="/demo" className="home-preview" aria-label={t('homePreviewAria')}>
      <div className="home-preview-top">
        <span className="home-preview-site">
          <img src="/logo.avif" alt="" width={16} height={16} />
          <span className="home-preview-site-name">Demo Store</span>
          <span className="home-preview-site-domain">demo-store.example</span>
        </span>
        <span className="home-preview-top-end">
          <span className="home-preview-sample">{t('landingHeroSample')}</span>
          <span className="home-preview-range">
            <CalendarDays aria-hidden />
            {t('datePreset30d')}
          </span>
        </span>
      </div>

      <div className="home-preview-body">
        <nav className="home-preview-nav" aria-hidden>
          {NAV.map(({ key, icon: Icon }, i) => (
            <span key={key} className={`home-preview-nav-item${i === 0 ? ' is-active' : ''}`}>
              <Icon />
              {t(key)}
            </span>
          ))}
        </nav>

        <div className="home-preview-main">
          <div className="home-preview-kpis">
            {kpis.map((kpi) => (
              <div key={kpi.key} className="home-preview-kpi">
                <span className="home-preview-kpi-label">{t(kpi.key)}</span>
                <span className="home-preview-kpi-value">{kpi.value}</span>
                <span className={`home-preview-kpi-delta${kpi.good ? ' is-good' : ''}`}>{kpi.delta}</span>
              </div>
            ))}
          </div>

          <div className="home-preview-panel home-preview-panel-chart">
            <div className="home-preview-panel-head">
              <p className="home-preview-panel-title">{t('pageviewsOverTime')}</p>
              <span className="home-preview-legend" aria-hidden>
                <span className="home-preview-legend-item home-preview-legend-pageviews">{t('pageviews')}</span>
                <span className="home-preview-legend-item home-preview-legend-visitors">{t('visitors')}</span>
              </span>
            </div>
            <TrafficChart />
          </div>

          <div className="home-preview-split">
            <RankedList title={t('overviewCardPages')} rows={TOP_PAGES} />
            <RankedList title={t('overviewCardSources')} rows={TOP_SOURCES} />
          </div>
        </div>
      </div>

      <span className="home-preview-open" aria-hidden>
        {t('homePreviewOpen')}
        <ArrowUpRight />
      </span>
    </Link>
  );
}
