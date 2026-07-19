import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DateRangePicker } from '../components/DateRangePicker';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { DashboardSiteRanking } from '../components/DashboardSiteRanking';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../lib/api';
import { formatChartTimeLabel, isHourlyChartRange } from '../lib/chartTimeseries';
import { t } from '../lib/i18n';
import { useDashboardRange } from '../lib/useDashboardRange';
import { useChartColors } from '../lib/useChartColors';

interface SeriesPoint {
  x: string;
  y: number;
}

interface DashboardSite {
  id: string;
  name: string;
  domain?: string;
  pageviews: number;
  visitors: number;
  visits?: number;
  series: SeriesPoint[];
}

interface AggregateMetrics {
  pageviews: SeriesPoint[];
  visitors: SeriesPoint[];
  visits: SeriesPoint[];
}

interface DashboardOverview {
  websites: DashboardSite[];
  ranking: Array<{ id: string; name: string; pageviews: number; visitors: number }>;
  siteCount: number;
  cardsLimit: number;
  cardsTruncated: boolean;
  totals: { pageviews: number; visitors: number; visits: number };
  aggregateMetrics: AggregateMetrics;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function mergeAggregateMetrics(metrics: AggregateMetrics | undefined, hourly: boolean) {
  if (!metrics) return [];

  const byKey = new Map<
    string,
    { rawX: string; pageviews: number; visitors: number; visits: number }
  >();

  for (const point of metrics.pageviews) {
    const row = byKey.get(point.x) ?? { rawX: point.x, pageviews: 0, visitors: 0, visits: 0 };
    row.pageviews = point.y;
    byKey.set(point.x, row);
  }
  for (const point of metrics.visitors) {
    const row = byKey.get(point.x) ?? { rawX: point.x, pageviews: 0, visitors: 0, visits: 0 };
    row.visitors = point.y;
    byKey.set(point.x, row);
  }
  for (const point of metrics.visits) {
    const row = byKey.get(point.x) ?? { rawX: point.x, pageviews: 0, visitors: 0, visits: 0 };
    row.visits = point.y;
    byKey.set(point.x, row);
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.rawX.localeCompare(b.rawX))
    .map(({ rawX, pageviews, visitors, visits }) => ({
      x: formatChartTimeLabel(rawX, hourly),
      pageviews,
      visitors,
      visits,
    }));
}

type AggregateMetricKey = 'pageviews' | 'visitors' | 'visits';

const AGGREGATE_METRICS: AggregateMetricKey[] = ['pageviews', 'visitors', 'visits'];

export default function DashboardHome() {
  const chartColors = useChartColors();
  const { range, setRange, rangeQs } = useDashboardRange('24h');

  const overviewQuery = useQuery({
    queryKey: ['dashboard-overview', range],
    queryFn: () => api<DashboardOverview>(`/api/dashboard?${rangeQs}`),
  });

  const sites = overviewQuery.data?.websites ?? [];
  const ranking = overviewQuery.data?.ranking ?? [];
  const siteCount = overviewQuery.data?.siteCount ?? 0;
  const hasWebsites = siteCount > 0;
  const cardsTruncated = overviewQuery.data?.cardsTruncated ?? false;
  const totals = overviewQuery.data?.totals;
  const hourly = isHourlyChartRange(range.startAt, range.endAt);

  const aggregateChart = useMemo(
    () => mergeAggregateMetrics(overviewQuery.data?.aggregateMetrics, hourly),
    [overviewQuery.data?.aggregateMetrics, hourly],
  );

  const metricColors = useMemo(
    () => ({
      pageviews: chartColors.accent,
      visitors: cssVar('--geist-amber-800') || chartColors.muted,
      visits: cssVar('--chart-axis') || chartColors.muted,
    }),
    [chartColors],
  );

  const [visibleMetrics, setVisibleMetrics] = useState<Record<AggregateMetricKey, boolean>>({
    pageviews: true,
    visitors: true,
    visits: true,
  });

  const toggleMetric = useCallback((key: AggregateMetricKey) => {
    setVisibleMetrics((prev) => {
      const visibleCount = AGGREGATE_METRICS.filter((metric) => prev[metric]).length;
      if (prev[key] && visibleCount <= 1) return prev;
      return { ...prev, [key]: !prev[key] };
    });
  }, []);

  return (
    <div className="page page-dashboard">
      <PageHeader
        title={t('dashboard')}
        subtitle={t('dashboardAllSitesLead')}
        actions={<DateRangePicker value={range} onChange={setRange} popover />}
      />

      {overviewQuery.isLoading ? (
        <section className="panel dashboard-aggregate section-gap" aria-hidden>
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="dashboard-aggregate-chart mt-4 h-52 w-full" />
        </section>
      ) : null}

      {!overviewQuery.isLoading && hasWebsites ? (
        <section className="panel dashboard-aggregate section-gap" aria-labelledby="dashboard-total-traffic">
          <div className="dashboard-aggregate-head">
            <div>
              <h2 id="dashboard-total-traffic" className="section-title">
                {t('dashboardTotalTraffic')}
              </h2>
              {totals ? (
                <div className="dashboard-aggregate-kpis">
                  <div className="dashboard-aggregate-kpi">
                    <span className="dashboard-aggregate-kpi-label">{t('pageviews')}</span>
                    <span className="dashboard-aggregate-kpi-value">{totals.pageviews.toLocaleString()}</span>
                  </div>
                  <div className="dashboard-aggregate-kpi">
                    <span className="dashboard-aggregate-kpi-label">{t('visitors')}</span>
                    <span className="dashboard-aggregate-kpi-value">{totals.visitors.toLocaleString()}</span>
                  </div>
                  <div className="dashboard-aggregate-kpi">
                    <span className="dashboard-aggregate-kpi-label">{t('visits')}</span>
                    <span className="dashboard-aggregate-kpi-value">{totals.visits.toLocaleString()}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="dashboard-aggregate-body">
            <div className="dashboard-aggregate-chart">
              {aggregateChart.length > 0 ? (
                <>
                  <div className="dashboard-aggregate-chart-plot">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={aggregateChart}
                        margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                        className="dashboard-aggregate-area-chart"
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} />
                        <XAxis
                          dataKey="x"
                          tick={{ fontSize: 11, fill: chartColors.muted }}
                          stroke={chartColors.border}
                          interval="preserveStartEnd"
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: chartColors.muted }}
                          stroke={chartColors.border}
                          allowDecimals={false}
                          width={48}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: chartColors.panel,
                            border: `1px solid ${chartColors.border}`,
                            borderRadius: 8,
                            fontSize: 12,
                            color: chartColors.text,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="pageviews"
                          name={t('pageviews')}
                          hide={!visibleMetrics.pageviews}
                          stroke={metricColors.pageviews}
                          strokeWidth={2}
                          fill={metricColors.pageviews}
                          fillOpacity={0.14}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="visitors"
                          name={t('visitors')}
                          hide={!visibleMetrics.visitors}
                          stroke={metricColors.visitors}
                          strokeWidth={2}
                          fill={metricColors.visitors}
                          fillOpacity={0.14}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="visits"
                          name={t('visits')}
                          hide={!visibleMetrics.visits}
                          stroke={metricColors.visits}
                          strokeWidth={2}
                          fill={metricColors.visits}
                          fillOpacity={0.14}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="dashboard-aggregate-legend" role="group" aria-label={t('dashboardTotalTraffic')}>
                    {AGGREGATE_METRICS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`dashboard-aggregate-legend-item${visibleMetrics[key] ? '' : ' is-hidden'}`}
                        aria-pressed={visibleMetrics[key]}
                        onClick={() => toggleMetric(key)}
                      >
                        <span
                          className={`dashboard-aggregate-legend-swatch dashboard-aggregate-legend-swatch--${key}`}
                          aria-hidden
                        />
                        <span className="dashboard-aggregate-legend-label">{t(key)}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-muted dashboard-site-card-empty">{t('noDataInPeriod')}</p>
              )}
            </div>

            <DashboardSiteRanking ranking={ranking} siteCount={siteCount} />
          </div>
        </section>
      ) : null}

      {!overviewQuery.isLoading && hasWebsites ? (
        <>
          {cardsTruncated ? (
            <div className="dashboard-sites-section-head">
              <p className="text-muted dashboard-sites-truncated">
                {t('dashboardSitesTruncated')
                  .replace('{shown}', String(sites.length))
                  .replace('{total}', String(siteCount))}
                {' '}
                <Link to="/websites">{t('dashboardViewAllSites').replace('{count}', String(siteCount))}</Link>
              </p>
            </div>
          ) : null}
          <div className="dashboard-site-list section-gap">
            {sites.map((w) => {
              const chartData = w.series.map((p) => ({
                x: formatChartTimeLabel(p.x, hourly),
                y: p.y,
              }));
              return (
                <Link key={w.id} to={`/websites/${w.id}`} className="panel dashboard-site-card">
                  <span className="site-card-arrow" aria-hidden>
                    →
                  </span>
                  <div className="dashboard-site-card-head">
                    <div className="dashboard-site-card-identity">
                      <WebsiteNameLabel name={w.name} domain={w.domain} className="site-card-name" />
                      {w.domain ? <span className="site-card-domain">{w.domain}</span> : null}
                    </div>
                    <div className="dashboard-site-row-kpis">
                      <div className="dashboard-site-kpi dashboard-site-kpi-primary">
                        <span className="dashboard-site-kpi-label">{t('pageviews')}</span>
                        <span className="dashboard-site-kpi-value is-primary">
                          {w.pageviews.toLocaleString()}
                        </span>
                      </div>
                      <div className="dashboard-site-kpi">
                        <span className="dashboard-site-kpi-label">{t('visitors')}</span>
                        <span className="dashboard-site-kpi-value">{w.visitors.toLocaleString()}</span>
                      </div>
                      {w.visits != null ? (
                        <div className="dashboard-site-kpi">
                          <span className="dashboard-site-kpi-label">{t('visits')}</span>
                          <span className="dashboard-site-kpi-value">{w.visits.toLocaleString()}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="dashboard-site-card-chart" aria-hidden={chartData.length === 0}>
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={chartColors.border}
                            vertical={false}
                          />
                          <XAxis
                            dataKey="x"
                            tick={{ fontSize: 10, fill: chartColors.muted }}
                            stroke={chartColors.border}
                            interval="preserveStartEnd"
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis hide allowDecimals={false} />
                          <Tooltip
                            contentStyle={{
                              background: chartColors.panel,
                              border: `1px solid ${chartColors.border}`,
                              borderRadius: 8,
                              fontSize: 12,
                              color: chartColors.text,
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="y"
                            name={t('pageviews')}
                            stroke={chartColors.accent}
                            strokeWidth={2}
                            fill={chartColors.accent}
                            fillOpacity={0.12}
                            dot={false}
                            activeDot={{ r: 3 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-muted dashboard-site-card-empty">{t('noDataInPeriod')}</p>
                    )}
                  </div>
                  <div className="dashboard-site-card-foot">
                    <span className="dashboard-site-card-hint">{t('dashboardViewSite')}</span>
                    <span className="dashboard-site-card-compare">{t('dashboardCompareHint')}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {!overviewQuery.isLoading && !hasWebsites ? (
        <div className="panel empty-state-rich section-gap">
          <h3>{t('noWebsitesDashboard')}</h3>
          <p className="text-muted">{t('noWebsitesHint')}</p>
          <ol className="empty-state-steps">
            <li data-step="1">{t('emptyStep1')}</li>
            <li data-step="2">{t('emptyStep2')}</li>
            <li data-step="3">{t('emptyStep3')}</li>
          </ol>
          <Button asChild variant="primary" className="empty-state-cta">
            <Link to="/websites">{t('addWebsiteCta')}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
