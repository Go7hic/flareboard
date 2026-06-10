import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import { Skeleton } from '../components/ui/skeleton';
import {
  api,
  type MetricRow,
  type Segment,
  type WebsiteStats,
} from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsiteExport } from '../lib/useWebsiteExport';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { useChartColors } from '../lib/useChartColors';

function StatCard({
  label,
  stat,
  primary,
}: {
  label: string;
  stat?: { value: number; change?: number };
  primary?: boolean;
}) {
  if (!stat) return null;
  return (
    <div className={`stat-card${primary ? ' stat-card-primary' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{stat.value.toLocaleString()}</div>
      {stat.change !== undefined ? <StatChangeDelta change={stat.change} /> : null}
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="stat-card stat-card-skeleton" aria-hidden>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="mt-[0.65rem] h-7 w-full" />
    </div>
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
  const { range, setRange, rangeQs } = useWebsiteRange(websiteId, '24h');
  const exportCsv = useWebsiteExport(websiteId, rangeQs);
  const segmentQs = activeSegmentId ? `&segmentId=${encodeURIComponent(activeSegmentId)}` : '';
  const cohortQs = cohortId ? `&cohort=${encodeURIComponent(cohortId)}` : '';
  const qs = `${rangeQs}${segmentQs}${cohortQs}`;

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

  const useDataFilter = Boolean(activeSegmentId || cohortId);

  const overviewQuery = useQuery({
    queryKey: ['overview', websiteId, range, activeSegmentId, cohortId],
    enabled: Boolean(websiteId) && !useDataFilter,
    queryFn: () =>
      api<{
        stats: WebsiteStats;
        pageviews: { pageviews: { x: string; y: number }[] };
      }>(`/api/websites/${websiteId}/stats/overview?unit=day&type=path&${rangeQs}`),
  });

  const statsQuery = useQuery({
    queryKey: ['stats', websiteId, activeSegmentId, cohortId, range],
    enabled: Boolean(websiteId) && useDataFilter,
    queryFn: () => api<WebsiteStats>(`/api/websites/${websiteId}/stats?${qs}`),
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

  const pageviewsQuery = useQuery({
    queryKey: ['pageviews', websiteId, activeSegmentId, cohortId, range],
    enabled: Boolean(websiteId) && useDataFilter,
    queryFn: () =>
      api<{ pageviews: { x: string; y: number }[] }>(
        `/api/websites/${websiteId}/pageviews?unit=day&${qs}`,
      ),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<MetricRow[]>(`/api/websites/${websiteId}/events`),
  });

  const stats = useDataFilter ? statsQuery.data : overviewQuery.data?.stats;
  const chartData = useDataFilter
    ? (pageviewsQuery.data?.pageviews ?? [])
    : (overviewQuery.data?.pageviews.pageviews ?? []);
  const chartLoading = useDataFilter ? pageviewsQuery.isLoading : overviewQuery.isLoading;
  const statsLoading =
    (useDataFilter ? statsQuery.isLoading : overviewQuery.isLoading) && !stats;

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
              segmentId={activeSegmentId}
              onSegmentChange={handleSegmentChange}
              segments={segmentsQuery.data ?? []}
              compareEnabled={compareEnabled}
              onCompareChange={setCompareEnabled}
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

      <section className="analytics-hero panel section-gap" aria-labelledby="analytics-overview">
        <h2 id="analytics-overview" className="visually-hidden">
          {t('pageviewsOverTime')}
        </h2>
        <div className="analytics-hero-stats">
          {statsLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : stats ? (
            <>
              <StatCard label={t('pageviews')} stat={stats.pageviews} primary />
              <StatCard label={t('visitors')} stat={stats.visitors} />
              <StatCard label={t('visits')} stat={stats.visits} />
              <StatCard label={t('bounces')} stat={stats.bounces} />
              <StatCard label={t('totalTime')} stat={stats.totaltime} />
            </>
          ) : null}
        </div>

        {compareEnabled && compareQuery.data ? (
          <div className="analytics-compare-strip">
            <StatCard label={t('comparePageviews')} stat={compareQuery.data.compare.stats.pageviews} />
            <StatCard label={t('compareVisitors')} stat={compareQuery.data.compare.stats.visitors} />
          </div>
        ) : null}

        <div className="analytics-hero-chart">
          <h3 className="section-title">{t('pageviewsOverTime')}</h3>
          {chartLoading ? (
            <div className="chart-wrap chart-wrap-hero chart-skeleton" aria-busy>
              <div className="skeleton skeleton-block" />
            </div>
          ) : chartData.length > 0 ? (
            <div className="chart-wrap chart-wrap-hero">
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} />
                  <XAxis dataKey="x" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: chartColors.muted }}
                    stroke={chartColors.border}
                  />
                  <Tooltip
                    contentStyle={{
                      background: chartColors.panel,
                      border: `1px solid ${chartColors.border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      color: chartColors.text,
                    }}
                  />
                  <Line type="monotone" dataKey="y" stroke={chartColors.accent} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title={t('chartNoData')} description={t('noDataInPeriodHint')} />
          )}
        </div>
      </section>

      {websiteId ? (
        <OverviewDimensions
          websiteId={websiteId}
          qs={qs}
          rangeQs={rangeQs}
          segmentQs={`${segmentQs}${cohortQs}`}
        />
      ) : null}

      {eventsQuery.isLoading || (eventsQuery.data?.length ?? 0) > 0 ? (
        <section className="panel section-gap custom-events-panel">
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
  );
}
