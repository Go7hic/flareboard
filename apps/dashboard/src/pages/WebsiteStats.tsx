import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { EmptyState } from '../components/EmptyState';
import { EventDataPanel } from '../components/EventDataPanel';
import { MetricsTable } from '../components/MetricsTable';
import { RealtimeWidget } from '../components/RealtimeWidget';
import { StatsToolbar } from '../components/StatsToolbar';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { SegmentsPanel } from '../components/SegmentsPanel';
import { ShareManage } from '../components/ShareManage';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import {
  api,
  authenticatedFetch,
  type MetricRow,
  type RevenueSummary,
  type Segment,
  type ShareLink,
  type Website,
  type WebsiteStats,
} from '../lib/api';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { defaultRange, loadWebsiteRange, saveWebsiteRange } from '../lib/websiteRangeStorage';

const METRIC_TABS = ['path', 'referrer', 'country', 'region', 'city', 'browser', 'os', 'device', 'language'] as const;
type PathSortBy = 'views' | 'visitors' | 'time';

const CountryMap = lazy(() =>
  import('../components/CountryMap').then((m) => ({ default: m.CountryMap })),
);

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
  const change = stat.change ?? 0;
  const deltaClass = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
  return (
    <div className={`stat-card${primary ? ' stat-card-primary' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{stat.value.toLocaleString()}</div>
      {stat.change !== undefined ? (
        <div className={`stat-delta ${deltaClass}`}>
          {change > 0 ? '+' : ''}
          {change}% vs prev period
        </div>
      ) : null}
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
  const queryClient = useQueryClient();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState('');
  const [metricTab, setMetricTab] = useState<(typeof METRIC_TABS)[number]>('path');
  const [pathSortBy, setPathSortBy] = useState<PathSortBy>('views');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [range, setRange] = useState(() => {
    if (websiteId) {
      const stored = loadWebsiteRange(websiteId);
      if (stored) return stored;
    }
    return defaultRange('24h');
  });

  useEffect(() => {
    if (!websiteId) return;
    const stored = loadWebsiteRange(websiteId);
    if (stored) setRange(stored);
    else setRange(defaultRange('24h'));
  }, [websiteId]);

  function onRangeChange(next: { preset: DateRangePreset; startAt: number; endAt: number }) {
    setRange(next);
    if (websiteId) saveWebsiteRange(websiteId, next);
  }

  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const segmentQs = segmentId ? `&segmentId=${encodeURIComponent(segmentId)}` : '';
  const qs = `${rangeQs}${segmentQs}`;

  const segmentsQuery = useQuery({
    queryKey: ['segments', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Segment[]>(`/api/websites/${websiteId}/segments`),
  });

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const useSegmentFilter = Boolean(segmentId);

  const overviewQuery = useQuery({
    queryKey: ['overview', websiteId, metricTab, pathSortBy, range],
    enabled: Boolean(websiteId) && !useSegmentFilter,
    queryFn: () => {
      const sortQs = metricTab === 'path' ? `&sortBy=${pathSortBy}` : '';
      return api<{
        stats: WebsiteStats;
        pageviews: { pageviews: { x: string; y: number }[] };
        metrics: MetricRow[];
      }>(`/api/websites/${websiteId}/stats/overview?unit=day&type=${metricTab}&${rangeQs}${sortQs}`);
    },
  });

  const statsQuery = useQuery({
    queryKey: ['stats', websiteId, segmentId, range],
    enabled: Boolean(websiteId) && useSegmentFilter,
    queryFn: () => api<WebsiteStats>(`/api/websites/${websiteId}/stats?${qs}`),
  });

  const compareQuery = useQuery({
    queryKey: ['stats-compare', websiteId, segmentId, range, compareEnabled],
    enabled: Boolean(websiteId) && compareEnabled,
    queryFn: () =>
      api<{
        primary: { stats: WebsiteStats };
        compare: { stats: WebsiteStats };
      }>(`/api/websites/${websiteId}/stats/compare?${qs}`),
  });

  const pageviewsQuery = useQuery({
    queryKey: ['pageviews', websiteId, segmentId, range],
    enabled: Boolean(websiteId) && useSegmentFilter,
    queryFn: () =>
      api<{ pageviews: { x: string; y: number }[] }>(
        `/api/websites/${websiteId}/pageviews?unit=day&${qs}`,
      ),
  });

  const metricsQuery = useQuery({
    queryKey: ['metrics', websiteId, metricTab, pathSortBy, segmentId, range],
    enabled: Boolean(websiteId) && useSegmentFilter,
    queryFn: () => {
      const sortQs = metricTab === 'path' ? `&sortBy=${pathSortBy}` : '';
      return api<MetricRow[]>(`/api/websites/${websiteId}/metrics?type=${metricTab}&${qs}${sortQs}`);
    },
  });

  const eventsQuery = useQuery({
    queryKey: ['events', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<MetricRow[]>(`/api/websites/${websiteId}/events`),
  });

  const revenueQuery = useQuery({
    queryKey: ['revenue', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<RevenueSummary>(`/api/websites/${websiteId}/revenue/sessions`),
  });

  const shareMutation = useMutation({
    mutationFn: () =>
      api<ShareLink>('/api/share', {
        method: 'POST',
        body: JSON.stringify({ websiteId, name: `${websiteQuery.data?.name ?? t('website')} stats` }),
      }),
    onSuccess: (share) => {
      const url = `${window.location.origin}/share/${share.slug}`;
      setShareUrl(url);
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
  });

  function exportCsv(type: 'events' | 'pageviews') {
    const path = `/api/websites/${websiteId}/export?type=${type}&${rangeQs}`;
    authenticatedFetch(path)
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${websiteId}-${type}.csv`;
        a.click();
      });
  }

  const stats = useSegmentFilter ? statsQuery.data : overviewQuery.data?.stats;
  const chartData = useSegmentFilter
    ? (pageviewsQuery.data?.pageviews ?? [])
    : (overviewQuery.data?.pageviews.pageviews ?? []);
  const metricsRows = useSegmentFilter ? (metricsQuery.data ?? []) : (overviewQuery.data?.metrics ?? []);
  const chartLoading = useSegmentFilter ? pageviewsQuery.isLoading : overviewQuery.isLoading;
  const statsLoading =
    (useSegmentFilter ? statsQuery.isLoading : overviewQuery.isLoading) && !stats;
  const metricsLoading = useSegmentFilter ? metricsQuery.isLoading : overviewQuery.isLoading;

  return (
    <div className="page page-stats">
      <WebsitePageShell
        websiteId={websiteId}
        toolbar={
          <StatsToolbar
            range={range}
            onRangeChange={onRangeChange}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segmentsQuery.data ?? []}
            compareEnabled={compareEnabled}
            onCompareChange={setCompareEnabled}
            onExportPageviews={() => exportCsv('pageviews')}
            onExportEvents={() => exportCsv('events')}
          />
        }
      />

      {websiteId ? <RealtimeWidget websiteId={websiteId} /> : null}

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

      {revenueQuery.data?.summary?.length ? (
        <section className="report-block section-gap">
          <h2 className="section-title">{t('revenue')}</h2>
          <ul className="list-plain">
            {revenueQuery.data.summary.map((row) => (
              <li key={row.currency} className="list-item list-row">
                <span>{row.currency}</span>
                <span className="list-row-value">
                  {row.total.toFixed(2)} ({row.transactions} tx)
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel breakdown-panel section-gap-lg">
        <div className="breakdown-panel-head">
          <h2 className="section-title">{t('breakdownMetrics')}</h2>
          <div className="metric-tabs" role="tablist">
            {METRIC_TABS.map((tab) => (
              <Button
                key={tab}
                type="button"
                role="tab"
                aria-selected={metricTab === tab}
                size="sm"
                variant={metricTab === tab ? 'primary' : 'secondary'}
                onClick={() => setMetricTab(tab)}
              >
                {tab === 'region' ? t('topRegion') : tab === 'city' ? t('topCity') : tab}
              </Button>
            ))}
          </div>
        </div>
        {metricTab === 'path' ? (
          <div className="path-sort-toolbar" role="group" aria-label={t('pagesSortBy')}>
            <span className="path-sort-toolbar-label">{t('pagesSortBy')}:</span>
            <div className="path-sort-toolbar-pills">
              {(['views', 'visitors', 'time'] as PathSortBy[]).map((sort) => (
                <Button
                  key={sort}
                  type="button"
                  size="sm"
                  variant={pathSortBy === sort ? 'primary' : 'secondary'}
                  onClick={() => setPathSortBy(sort)}
                >
                  {t(`pagesSort_${sort}`)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {metricTab === 'country' ? (
          <div className="breakdown-map">
            <h3 className="section-title">{t('countryMap')}</h3>
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <CountryMap rows={metricsRows} />
            </Suspense>
          </div>
        ) : null}
        <MetricsTable
          embedded
          title={
            metricTab === 'country'
              ? t('topCountry')
              : metricTab === 'region'
                ? t('topRegion')
                : metricTab === 'city'
                  ? t('topCity')
                  : `${t('topMetric')} ${metricTab}`
          }
          rows={metricsRows}
          loading={metricsLoading}
          showPageStats={metricTab === 'path'}
        />
      </section>

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

      <CollapsibleSection title={t('moreDetails')} summary={t('shareLinks')}>
        {websiteId ? <EventDataPanel websiteId={websiteId} /> : null}
        {websiteId ? <SegmentsPanel websiteId={websiteId} /> : null}
        {websiteId ? <ShareManage websiteId={websiteId} /> : null}
        <div className="share-create-block">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={shareMutation.isPending}
            onClick={() => shareMutation.mutate()}
          >
            {t('createShareLink')}
          </Button>
          {shareUrl ? (
            <p className="share-create-url">
              <a href={shareUrl}>{shareUrl}</a>
            </p>
          ) : null}
          {shareMutation.error ? <p className="text-danger">{(shareMutation.error as Error).message}</p> : null}
        </div>
      </CollapsibleSection>
    </div>
  );
}
