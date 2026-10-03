import { formatDayBucketLabel } from '@flareboard/shared/timezone';
import { ArrowUpRight, Calendar, ChevronDown, Download, Funnel } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { MetricRow, WebsiteStats } from '../../lib/api';
import { niceTicks } from '../../lib/chartTicks';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { BrandLogo } from '../BrandLogo';
import { ChartLegend } from '../ChartLegend';
import { MetricsTable } from '../MetricsTable';
import { OverviewKpiStrip } from '../OverviewKpiStrip';
import { SidebarNavIcon } from '../SidebarNavIcon';
import { websiteNavGroups } from '../WebsiteSidebar';
import { smoothPath } from './landing-format';

/*
 * A still of the console's website overview, built from the console's components and classes,
 * so it changes when the console does. Everything is static: the whole preview is one link to the
 * live demo, and the sample numbers follow the Demo Store's last 30 days.
 */

const PAGEVIEWS = [
  1614, 1293, 1367, 1562, 1638, 1730, 1583, 1472, 1163, 1298, 1592, 1734, 1648, 2401, 1713, 1327, 1407,
  1624, 1659, 1555, 1504, 1523, 1143, 1340, 1515, 1757, 1591, 1642, 1518, 1255,
];
const VISITORS = [
  581, 484, 494, 617, 619, 629, 596, 557, 453, 486, 583, 643, 625, 957, 679, 509, 541, 617, 631, 592,
  587, 586, 476, 534, 591, 638, 603, 623, 562, 468,
];

const STATS: WebsiteStats = {
  visitors: { value: 14_007, change: 4.2 },
  visits: { value: 17_847, change: 3.1 },
  pageviews: { value: 46_168, change: 5.6 },
  bounces: { value: 7_496, change: 0.7 },
  totaltime: { value: 1_142_208, change: 9.3 },
};

/** Visitors per page. */
const TOP_PAGES: MetricRow[] = [
  { x: '/', y: 7_698 },
  { x: '/cart', y: 4_244 },
  { x: '/checkout', y: 2_582 },
  { x: '/collections/apparel', y: 1_957 },
  { x: '/products/linen-overshirt', y: 1_757 },
];

/** Pageviews per referrer. */
const TOP_SOURCES: MetricRow[] = [
  { x: 'Direct', y: 21_895 },
  { x: 'google.com', y: 12_356 },
  { x: 'm.facebook.com', y: 3_174 },
  { x: 'l.instagram.com', y: 2_558 },
  { x: 'pinterest.com', y: 1_473 },
];

const PLOT_W = 600;
const PLOT_H = 200;
/** Weekly date ticks, counted back from today. */
const X_TICKS = [1, 8, 15, 22, 29];

function dayLabel(index: number) {
  const day = new Date();
  day.setDate(day.getDate() - (PAGEVIEWS.length - 1 - index));
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return formatDayBucketLabel(`${day.getFullYear()}-${month}-${date}`);
}

/** The overview trend chart (AnalyticsChart look) as plain SVG: no tooltip or focus stop inside the link. */
function TrafficChart() {
  const ticks = niceTicks(Math.max(...PAGEVIEWS), 4);
  const top = ticks[ticks.length - 1];
  const x = (index: number) => (index / (PAGEVIEWS.length - 1)) * PLOT_W;
  const y = (value: number) => PLOT_H - (value / top) * PLOT_H;
  const line = (series: number[]) => smoothPath(series.map((value, index) => [x(index), y(value)]));
  const percentFromTop = (value: number) => `${(1 - value / top) * 100}%`;

  return (
    <div className="home-preview-chart">
      <div className="home-preview-chart-y">
        {ticks.map((tick) => (
          <span key={tick} style={{ top: percentFromTop(tick) }}>
            {formatNumber(tick)}
          </span>
        ))}
      </div>
      <div className="home-preview-chart-plot">
        {ticks.map((tick) => (
          <span key={tick} className="home-preview-chart-grid" style={{ top: percentFromTop(tick) }} />
        ))}
        <svg viewBox={`0 0 ${PLOT_W} ${PLOT_H}`} preserveAspectRatio="none">
          <path d={line(PAGEVIEWS)} className="home-preview-line is-pageviews" vectorEffect="non-scaling-stroke" />
          <path d={line(VISITORS)} className="home-preview-line is-visitors" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="home-preview-chart-x">
        {X_TICKS.map((index) => (
          <span key={index} style={{ left: `${(index / (PAGEVIEWS.length - 1)) * 100}%` }}>
            {dayLabel(index)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** SectionCard's markup with the title as a paragraph: the landing page owns the headings. */
function PreviewCard({ title, actions, children }: { title: string; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      <div className="card-header">
        <div className="card-header-copy">
          <p className="card-title">{title}</p>
        </div>
        <div className="card-actions">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/** Overview dimension card with its tabs drawn as plain text (OverviewDimensionCard's look). */
function DimensionCard({
  title,
  tabs,
  rows,
  primaryMetric,
}: {
  title: string;
  tabs: string[];
  rows: MetricRow[];
  primaryMetric: 'views' | 'visitors';
}) {
  return (
    <PreviewCard
      title={title}
      actions={
        <span className="segment-tabs segment-tabs--sm">
          {tabs.map((tab, index) => (
            <span key={tab} className={index === 0 ? 'segment-tab is-active' : 'segment-tab'}>
              {tab}
            </span>
          ))}
        </span>
      }
    >
      <MetricsTable embedded hideTitle sortable={false} title={title} rows={rows} primaryMetric={primaryMetric} />
    </PreviewCard>
  );
}

export function LandingProductPreview() {
  return (
    <Link to="/demo" className="home-preview" aria-label={t('homePreviewAria')}>
      <div className="home-preview-app" aria-hidden>
        <div className="home-preview-sidebar">
          <div className="home-preview-sidebar-inner">
            <div className="home-preview-brand">
              <BrandLogo size={24} />
            </div>
            <div className="home-preview-nav">
              {websiteNavGroups('/demo', true).map((group) => (
                <div key={group.items[0]?.to} className="website-sidebar-group">
                  {group.labelKey ? <div className="website-sidebar-group-label">{t(group.labelKey)}</div> : null}
                  <div className="website-sidebar-group-links">
                    {group.items.map((item) => (
                      <span key={item.to} className={item.end ? 'sidebar-link active' : 'sidebar-link'}>
                        <SidebarNavIcon name={item.icon} />
                        <span className="sidebar-link-label">{t(item.labelKey)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="home-preview-main">
          <div className="website-content-header">
            <span className="website-breadcrumb">
              <span className="website-breadcrumb-link">{t('allWebsites')}</span>
              <span className="website-breadcrumb-sep">/</span>
              <span className="website-switcher-trigger">
                <span className="website-switcher-name">Demo Store</span>
                <ChevronDown className="website-switcher-chevron" size={12} />
              </span>
            </span>
            <span className="badge home-preview-sample">{t('demoSampleBadge')}</span>
          </div>

          <div className="page-header">
            <div className="page-header-row">
              <div className="page-header-copy">
                <p className="page-title">{t('navOverview')}</p>
                <p className="page-subtitle">{t('overviewPageLead')}</p>
              </div>
              <div className="page-header-actions">
                <div className="stats-header-row">
                  <span className="realtime-online-badge">
                    <span className="live-dot" />
                    <span className="realtime-online-badge-text">
                      {t('realtimeOnlineCount').replace('{count}', '4')}
                    </span>
                  </span>
                  <span className="stats-header-controls">
                    <span className="segment-filter-menu-trigger home-preview-wide-only">
                      <Funnel className="segment-filter-menu-icon" size={14} />
                      {t('allVisitors')}
                      <ChevronDown className="segment-filter-menu-chevron" size={12} />
                    </span>
                    <span className="date-range-picker-trigger">
                      <Calendar className="date-range-picker-trigger-icon" size={14} />
                      {t('datePreset30d')}
                      <ChevronDown className="date-range-picker-trigger-chevron" size={12} />
                    </span>
                    <span className="export-menu-trigger home-preview-wide-only">
                      <Download className="export-menu-icon" size={14} />
                      {t('export')}
                      <ChevronDown className="export-menu-chevron" size={12} />
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="stack">
            <OverviewKpiStrip
              stats={STATS}
              compareLabel=""
              pageviewsColor="var(--chart-pageviews)"
              visitorsColor="var(--chart-visitors)"
            />
            <PreviewCard
              title={t('trafficOverTime')}
              actions={
                <ChartLegend
                  items={[
                    { label: t('visitors'), color: 'var(--chart-visitors)' },
                    { label: t('pageviews'), color: 'var(--chart-pageviews)' },
                  ]}
                />
              }
            >
              <TrafficChart />
            </PreviewCard>
            <div className="home-preview-split">
              <DimensionCard
                title={t('overviewCardPages')}
                tabs={[t('segmentField_path'), t('overviewTabEntry'), t('overviewTabExit')]}
                rows={TOP_PAGES}
                primaryMetric="visitors"
              />
              <DimensionCard
                title={t('overviewCardSources')}
                tabs={[t('segmentField_referrer'), t('overviewTabChannel')]}
                rows={TOP_SOURCES}
                primaryMetric="views"
              />
            </div>
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
