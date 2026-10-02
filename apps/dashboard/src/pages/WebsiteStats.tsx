import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LineChart, Line } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { ChartLegend } from '../components/ChartLegend';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { MetricsTable } from '../components/MetricsTable';
import { OverviewDimensions } from '../components/OverviewDimensions';
import { OverviewCountryMapCard, OverviewTrafficHeatmapCard } from '../components/OverviewMapHeatmapPanel';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { WebsiteStatsControls } from '../components/WebsiteStatsControls';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
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
import { computeCompareRange, type CompareMode } from '../lib/compare-utils';
import { lineMark } from '../lib/chartMarks';
import { formatDurationSeconds, formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsiteExport } from '../lib/useWebsiteExport';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { useChartColors } from '../lib/useChartColors';

type StatValue = { value: number; change?: number };

/** The previous period's value implied by a value and its % change (undefined when unknown). */
function previousValue(stat: StatValue | undefined): number | undefined {
  if (!stat || stat.change === undefined) return undefined;
  const factor = 1 + stat.change / 100;
  return factor > 0 ? stat.value / factor : undefined;
}

function percentChange(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/**
 * Headline metrics for the KPI strip. Bounce rate and average visit duration are derived from
 * counts (bounces ÷ visits, total time ÷ visits): the raw totals mean little on their own.
 */
function overviewMetrics(stats: WebsiteStats) {
  const visits = stats.visits.value;
  const bounceRate = visits > 0 ? (stats.bounces.value / visits) * 100 : 0;
  const avgDuration = visits > 0 ? stats.totaltime.value / visits : 0;
  const prevVisits = previousValue(stats.visits);
  const prevBounces = previousValue(stats.bounces);
  const prevTotal = previousValue(stats.totaltime);
  const prevBounceRate =
    prevVisits && prevBounces !== undefined ? (prevBounces / prevVisits) * 100 : undefined;
  const prevAvgDuration = prevVisits && prevTotal !== undefined ? prevTotal / prevVisits : undefined;
  return {
    bounceRate,
    bounceRateChange: percentChange(bounceRate, prevBounceRate),
    avgDuration,
    avgDurationChange: percentChange(avgDuration, prevAvgDuration),
  };
}

function compareHint(label: string, value: string) {
  return `${label} ${value}`;
}

export default function WebsiteStatsPage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [segmentId, setSegmentId] = useState('');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareMode>('previous');
  const segmentFromUrl = searchParams.get('segment') ?? '';
  const activeSegmentId = segmentFromUrl || segmentId;
  const cohortId = searchParams.get('cohort') ?? '';
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const segmentQs = activeSegmentId ? `&segmentId=${encodeURIComponent(activeSegmentId)}` : '';
  const cohortQs = cohortId ? `&cohort=${encodeURIComponent(cohortId)}` : '';
  const qs = `${rangeQs}${segmentQs}${cohortQs}`;
  // Export exactly what the page shows, including the active segment and cohort.
  const exportCsv = useWebsiteExport(websiteId, qs);
  const compareRange = useMemo(
    () => computeCompareRange(range.startAt, range.endAt, compareMode),
    [range.startAt, range.endAt, compareMode],
  );
  const compareQs = `${qs}&compareStartAt=${compareRange.compareStartAt}&compareEndAt=${compareRange.compareEndAt}`;
  const compareModeLabel =
    compareMode === 'year' ? t('compareModeYear') : t('compareModePrevious');
  const comparePageTo = useMemo(() => {
    if (!websiteId) return '';
    const params = new URLSearchParams();
    if (activeSegmentId) params.set('segment', activeSegmentId);
    if (cohortId) params.set('cohort', cohortId);
    params.set('compare', compareMode);
    const q = params.toString();
    return `/websites/${websiteId}/compare${q ? `?${q}` : ''}`;
  }, [websiteId, activeSegmentId, cohortId, compareMode]);
  const hourly = isHourlyChartRange(range.startAt, range.endAt);

  const metricColors = useMemo(
    () => ({
      pageviews: chartColors.series.pageviews,
      visitors: chartColors.series.visitors,
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
    queryKey: ['stats-compare', websiteId, activeSegmentId, cohortId, range, compareMode, compareEnabled],
    enabled: Boolean(websiteId) && compareEnabled,
    queryFn: () =>
      api<{
        primary: { stats: WebsiteStats };
        compare: { stats: WebsiteStats };
      }>(`/api/websites/${websiteId}/stats/compare?${compareQs}`),
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
  const chartLoading = overviewQuery.isLoading && !overviewQuery.data;
  const statsLoading = overviewQuery.isLoading && !stats;
  const overviewInitialLoading = overviewQuery.isLoading && !overviewQuery.data;

  const overviewLoadingFallback = (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={5} />
      <SectionCard title={t('trafficOverTime')}>
        <Skeleton className="h-[300px] w-full" />
      </SectionCard>
    </div>
  );

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
    <Page className="page-stats">
      <PageHeader
        title={t('navOverview')}
        lead={t('overviewPageLead')}
        actions={
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
              compareMode={compareMode}
              onCompareModeChange={setCompareMode}
              timezone={timezone}
            />
          ) : null
        }
      />

      <PageBody className="stack">
      {activeSegmentId ? (
        <div className="cohort-filter-banner">
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
        <div className="cohort-filter-banner">
          <span>
            {t('cohortFilterActive').replace('{name}', cohortQuery.data?.name ?? cohortId)}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={clearCohortFilter}>
            {t('cohortClearFilter')}
          </Button>
        </div>
      ) : null}

      <DataViewState
        loading={overviewInitialLoading}
        error={overviewQuery.isError ? overviewQuery.error : null}
        onRetry={() => overviewQuery.refetch()}
        loadingFallback={overviewLoadingFallback}
      >
        <section aria-labelledby="analytics-overview">
          <h2 id="analytics-overview" className="visually-hidden">
            {t('trafficOverTime')}
          </h2>
          {statsLoading ? (
            <KpiStripSkeleton cells={5} />
          ) : stats ? (
            <OverviewKpiStrip
              stats={stats}
              compare={compareEnabled ? compareQuery.data?.compare.stats : undefined}
              compareLabel={compareModeLabel}
              pageviewsColor={metricColors.pageviews}
              visitorsColor={metricColors.visitors}
            />
          ) : null}
          {compareEnabled && compareQuery.data ? (
            <p className="overview-compare-note">
              <span>{compareModeLabel}</span>
              <Link className="shell-link" to={comparePageTo}>
                {t('overviewCompareOpenFull')}
              </Link>
            </p>
          ) : null}
        </section>

        <SectionCard
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
          {chartLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chartData.length > 0 ? (
            <div className="overview-trend-chart">
              <AnalyticsChart
                Chart={LineChart}
                data={chartData}
                responsive={{ height: 300 }}
                xAxis={{
                  dataKey: 'x',
                  interval: 'preserveStartEnd',
                  minTickGap: hourly ? 32 : 24,
                }}
              >
                <Line
                  dataKey="pageviews"
                  name={t('pageviews')}
                  stroke={metricColors.pageviews}
                  {...lineMark(chartColors.panel)}
                />
                <Line
                  dataKey="visitors"
                  name={t('visitors')}
                  stroke={metricColors.visitors}
                  {...lineMark(chartColors.panel)}
                />
              </AnalyticsChart>
            </div>
          ) : (
            <EmptyState title={t('chartNoData')} description={t('noDataInPeriodHint')} />
          )}
        </SectionCard>
      </DataViewState>

      {websiteId ? (
        <OverviewDimensions
          websiteId={websiteId}
          qs={qs}
          rangeQs={rangeQs}
          segmentQs={`${segmentQs}${cohortQs}`}
        />
      ) : null}

      {websiteId ? (
        <div className="layout-grid layout-grid--stretch">
          <OverviewCountryMapCard websiteId={websiteId} qs={qs} className="span-7" />
          <SectionCard className="span-5" title={t('customEvents')}>
            <MetricsTable
              embedded
              hideTitle
              title={t('customEvents')}
              rows={eventsQuery.data ?? []}
              loading={eventsQuery.isLoading}
              maxRows={8}
            />
          </SectionCard>
          <OverviewTrafficHeatmapCard websiteId={websiteId} qs={qs} className="span-12" />
        </div>
      ) : null}
      </PageBody>
    </Page>
  );
}

function OverviewKpiStrip({
  stats,
  compare,
  compareLabel,
  pageviewsColor,
  visitorsColor,
}: {
  stats: WebsiteStats;
  compare?: WebsiteStats;
  compareLabel: string;
  pageviewsColor: string;
  visitorsColor: string;
}) {
  const derived = overviewMetrics(stats);
  const compareDerived = compare ? overviewMetrics(compare) : undefined;
  const delta = (change: number | undefined, invert = false) =>
    change === undefined ? undefined : <StatChangeDelta change={change} invertColors={invert} />;
  const hint = (value: string | undefined) => (value === undefined ? undefined : compareHint(compareLabel, value));

  return (
    <KpiStrip columns={5}>
      <KpiCell
        label={t('visitors')}
        keyColor={visitorsColor}
        value={formatNumber(stats.visitors.value)}
        delta={delta(stats.visitors.change)}
        hint={hint(compare ? formatNumber(compare.visitors.value) : undefined)}
      />
      <KpiCell
        label={t('visits')}
        value={formatNumber(stats.visits.value)}
        delta={delta(stats.visits.change)}
        hint={hint(compare ? formatNumber(compare.visits.value) : undefined)}
      />
      <KpiCell
        label={t('pageviews')}
        keyColor={pageviewsColor}
        value={formatNumber(stats.pageviews.value)}
        delta={delta(stats.pageviews.change)}
        hint={hint(compare ? formatNumber(compare.pageviews.value) : undefined)}
      />
      <KpiCell
        label={t('bounceRate')}
        value={formatPercent(derived.bounceRate, { digits: derived.bounceRate < 10 ? 1 : 0 })}
        delta={delta(derived.bounceRateChange, true)}
        hint={hint(compareDerived ? formatPercent(compareDerived.bounceRate) : undefined)}
      />
      <KpiCell
        label={t('avgDuration')}
        value={formatDurationSeconds(derived.avgDuration)}
        delta={delta(derived.avgDurationChange)}
        hint={hint(compareDerived ? formatDurationSeconds(compareDerived.avgDuration) : undefined)}
      />
    </KpiStrip>
  );
}
