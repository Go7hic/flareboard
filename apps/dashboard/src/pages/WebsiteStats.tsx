import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '../components/EmptyState';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { MetricsTable } from '../components/MetricsTable';
import { OverviewDimensions } from '../components/OverviewDimensions';
import { OverviewMapHeatmapPanel } from '../components/OverviewMapHeatmapPanel';
import { WebsiteStatsControls } from '../components/WebsiteStatsControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { StatCard, StatCardSkeleton, type StatCardSize } from '../components/ui/stat-card';
import {
  api,
  type MetricRow,
  type Segment,
  type WebsiteStats,
} from '../lib/api';
import {
  isHourlyChartRange,
  mergePageviewsVisitors,
  type MetricsSeries,
} from '../lib/chartTimeseries';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsiteExport } from '../lib/useWebsiteExport';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { useChartColors } from '../lib/useChartColors';
import { chartTooltipStyle } from '../lib/chartStyles';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function OverviewKpi({
  label,
  stat,
  size = 'default',
}: {
  label: string;
  stat?: { value: number; change?: number };
  size?: StatCardSize;
}) {
  if (!stat) return null;
  return (
    <StatCard
      size={size}
      label={label}
      value={formatNumber(stat.value)}
      delta={stat.change !== undefined ? <StatChangeDelta change={stat.change} /> : undefined}
    />
  );
}

export default function WebsiteStatsPage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [segmentId, setSegmentId] = useState('');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const segmentFromUrl = searchParams.get('segment') ?? '';
  const activeSegmentId = segmentFromUrl || segmentId;
  const cohortId = searchParams.get('cohort') ?? '';
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const exportCsv = useWebsiteExport(websiteId, rangeQs);
  const segmentQs = activeSegmentId ? `&segmentId=${encodeURIComponent(activeSegmentId)}` : '';
  const cohortQs = cohortId ? `&cohort=${encodeURIComponent(cohortId)}` : '';
  const qs = `${rangeQs}${segmentQs}${cohortQs}`;
  const hourly = isHourlyChartRange(range.startAt, range.endAt);

  const metricColors = useMemo(
    () => ({
      pageviews: chartColors.accent,
      visitors: cssVar('--chart-axis') || chartColors.muted,
    }),
    [chartColors],
  );

  useEffect(() => {
    if (segmentFromUrl) setSegmentId(segmentFromUrl);
  }, [segmentFromUrl]);

  const segmentsQuery = useQuery({
    queryKey: ['segments', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Segment[]>(`/api/websites/${websiteId}/segments`),
  });

  const segmentQuery = useQuery({
    queryKey: ['segment', websiteId, activeSegmentId],
    enabled: Boolean(websiteId && activeSegmentId),
    queryFn: () => api<Segment>(`/api/websites/${websiteId}/segments/${activeSegmentId}`),
  });

  const cohortQuery = useQuery({
    queryKey: ['cohort', websiteId, cohortId],
    enabled: Boolean(websiteId && cohortId),
    queryFn: () =>
      api<{ id: string; name: string }>(`/api/websites/${websiteId}/cohorts/${cohortId}`),
  });

  const overviewQuery = useQuery({
    queryKey: ['overview', websiteId, range, activeSegmentId, cohortId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{
        stats: WebsiteStats;
        timeseries: MetricsSeries;
      }>(`/api/websites/${websiteId}/stats/overview?type=path&${qs}`),
  });

  const compareQuery = useQuery({
    queryKey: ['stats-compare', websiteId, activeSegmentId, cohortId, range, compareEnabled],
    enabled: Boolean(websiteId) && compareEnabled,
    queryFn: () =>
      api<{
        primary: { stats: WebsiteStats };
        compare: { stats: WebsiteStats };
      }>(`/api/websites/${websiteId}/stats/compare?${qs}`),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<MetricRow[]>(`/api/websites/${websiteId}/events`),
  });

  const billingQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api<{
        hosted: boolean;
        plan?: { dataPortabilityEnabled?: boolean };
      }>('/api/billing/subscription'),
  });

  const exportAllowed =
    !billingQuery.data?.hosted || Boolean(billingQuery.data?.plan?.dataPortabilityEnabled);

  const stats = overviewQuery.data?.stats;
  const chartData = useMemo(
    () => mergePageviewsVisitors(overviewQuery.data?.timeseries, hourly, timezone),
    [overviewQuery.data?.timeseries, hourly, timezone],
  );
  const chartLoading = overviewQuery.isLoading;
  const statsLoading = overviewQuery.isLoading && !stats;

  function clearCohortFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete('cohort');
    setSearchParams(next, { replace: true });
  }

  function clearSegmentFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete('segment');
    setSearchParams(next, { replace: true });
    setSegmentId('');
  }

  function handleSegmentChange(nextId: string) {
    setSegmentId(nextId);
    const next = new URLSearchParams(searchParams);
    if (nextId) {
      next.set('segment', nextId);
    } else {
      next.delete('segment');
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="page page-stats">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          websiteId ? (
            <WebsiteStatsControls
              websiteId={websiteId}
              range={range}
              onRangeChange={setRange}
              onExport={exportCsv}
              exportAllowed={exportAllowed}
              segmentId={activeSegmentId}
              onSegmentChange={handleSegmentChange}
              segments={segmentsQuery.data ?? []}
              compareEnabled={compareEnabled}
              onCompareChange={setCompareEnabled}
              timezone={timezone}
            />
          ) : null
        }
      />

      {activeSegmentId ? (
        <div className="cohort-filter-banner section-gap">
          <span>
            {t('segmentFilterActive').replace(
              '{name}',
              segmentQuery.data?.name ?? activeSegmentId,
            )}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={clearSegmentFilter}>
            {t('segmentClearFilter')}
          </Button>
        </div>
      ) : null}

      {cohortId ? (
        <div className="cohort-filter-banner section-gap">
          <span>
            {t('cohortFilterActive').replace('{name}', cohortQuery.data?.name ?? cohortId)}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={clearCohortFilter}>
            {t('cohortClearFilter')}
          </Button>
        </div>
      ) : null}

      <section className="page-stats-kpis section-gap" aria-labelledby="analytics-overview">
        <h2 id="analytics-overview" className="visually-hidden">
          {t('trafficOverTime')}
        </h2>

        <div className="analytics-hero-kpis">
          {statsLoading ? (
            <>
              <StatCardSkeleton size="hero" />
              <StatCardSkeleton size="hero" />
            </>
          ) : stats ? (
            <>
              <OverviewKpi label={t('pageviews')} stat={stats.pageviews} size="hero" />
              <OverviewKpi label={t('visitors')} stat={stats.visitors} size="hero" />
            </>
          ) : null}
        </div>

        <div className="analytics-hero-stats-secondary">
          {statsLoading ? (
            <>
              <StatCardSkeleton size="secondary" />
              <StatCardSkeleton size="secondary" />
              <StatCardSkeleton size="secondary" />
            </>
          ) : stats ? (
            <>
              <OverviewKpi label={t('visits')} stat={stats.visits} size="secondary" />
              <OverviewKpi label={t('bounces')} stat={stats.bounces} size="secondary" />
              <OverviewKpi label={t('totalTime')} stat={stats.totaltime} size="secondary" />
            </>
          ) : null}
        </div>

        {compareEnabled && compareQuery.data ? (
          <div className="analytics-compare-strip">
            <OverviewKpi
              label={t('comparePageviews')}
              stat={compareQuery.data.compare.stats.pageviews}
              size="secondary"
            />
            <OverviewKpi
              label={t('compareVisitors')}
              stat={compareQuery.data.compare.stats.visitors}
              size="secondary"
            />
          </div>
        ) : null}
      </section>

      <section className="panel page-stats-chart section-gap" aria-labelledby="traffic-chart-title">
        <h2 id="traffic-chart-title" className="section-title">
          {t('trafficOverTime')}
        </h2>
        {chartLoading ? (
          <div className="chart-wrap chart-wrap-hero chart-skeleton" aria-busy>
            <div className="skeleton skeleton-block" />
          </div>
        ) : chartData.length > 0 ? (
          <>
            <div className="chart-wrap chart-wrap-hero">
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} />
                  <XAxis
                    dataKey="x"
                    tick={{ fontSize: 11, fill: chartColors.muted }}
                    stroke={chartColors.border}
                    interval={hourly ? 'preserveStartEnd' : undefined}
                    minTickGap={hourly ? 24 : 8}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: chartColors.muted }}
                    stroke={chartColors.border}
                  />
                  <Tooltip contentStyle={chartTooltipStyle(chartColors, { fontSize: 13 })} />
                  <Line
                    type="monotone"
                    dataKey="pageviews"
                    name={t('pageviews')}
                    stroke={metricColors.pageviews}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="visitors"
                    name={t('visitors')}
                    stroke={metricColors.visitors}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="dashboard-aggregate-legend analytics-chart-legend" aria-hidden>
              <span className="dashboard-aggregate-legend-item">
                <span className="dashboard-aggregate-legend-swatch dashboard-aggregate-legend-swatch--pageviews" />
                <span className="dashboard-aggregate-legend-label">{t('pageviews')}</span>
              </span>
              <span className="dashboard-aggregate-legend-item">
                <span className="dashboard-aggregate-legend-swatch dashboard-aggregate-legend-swatch--visitors" />
                <span className="dashboard-aggregate-legend-label">{t('visitors')}</span>
              </span>
            </div>
          </>
        ) : (
          <EmptyState title={t('chartNoData')} description={t('noDataInPeriodHint')} />
        )}
      </section>

      {websiteId ? (
        <OverviewDimensions
          websiteId={websiteId}
          qs={qs}
          rangeQs={rangeQs}
          segmentQs={`${segmentQs}${cohortQs}`}
        />
      ) : null}

      {eventsQuery.isLoading ||
      (eventsQuery.data?.length ?? 0) > 0 ||
      websiteId ? (
        <div className="overview-secondary">
          {eventsQuery.isLoading || (eventsQuery.data?.length ?? 0) > 0 ? (
            <section className="panel custom-events-panel">
              <MetricsTable
                embedded
                title={t('customEvents')}
                rows={eventsQuery.data ?? []}
                loading={eventsQuery.isLoading}
              />
            </section>
          ) : null}

          {websiteId ? <OverviewMapHeatmapPanel websiteId={websiteId} qs={qs} /> : null}
        </div>
      ) : null}
    </div>
  );
}
