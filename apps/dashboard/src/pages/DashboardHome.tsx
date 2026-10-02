import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Globe, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DashboardSiteRanking, DashboardSiteRankingSkeleton, type DashboardSiteTotals } from '../components/DashboardSiteRanking';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { OverviewTrendCard } from '../components/OverviewTrendCard';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { changePercent, safeRatio } from '../components/workspace/workspace-format';
import { api } from '../lib/api';
import { isHourlyChartRange, mergePageviewsVisitors } from '../lib/chartTimeseries';
import { computeCompareRange } from '../lib/compare-utils';
import { rangeQueryString } from '../lib/dateRange';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useDashboardRange } from '../lib/useDashboardRange';
import { useDemoSession } from '../lib/useDemoSession';

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

interface DashboardOverview {
  websites: DashboardSite[];
  siteCount: number;
  cardsLimit: number;
  cardsTruncated: boolean;
  totals: { pageviews: number; visitors: number; visits: number };
  aggregateMetrics: { pageviews: SeriesPoint[]; visitors: SeriesPoint[]; visits: SeriesPoint[] };
}

/** Delta chip vs the previous period; a chip-sized skeleton while that period loads. */
function deltaFor(current: number | undefined, previous: number | undefined, show: boolean, pending = false) {
  if (pending) return <Skeleton className="ws-delta-skeleton" />;
  if (!show || current === undefined) return undefined;
  const change = changePercent(current, previous);
  return change === undefined ? undefined : <StatChangeDelta change={change} />;
}

export default function DashboardHome() {
  const chartColors = useChartColors();
  const { isDemo } = useDemoSession();
  const { range, setRange, rangeQs } = useDashboardRange('24h');
  // Deltas compare with the period of the same length just before (as the overview does).
  const previousRange = useMemo(
    () => computeCompareRange(range.startAt, range.endAt, 'previous'),
    [range.startAt, range.endAt],
  );

  const overviewQuery = useQuery({
    queryKey: ['dashboard-overview', range],
    queryFn: () => api<DashboardOverview>(`/api/dashboard?${rangeQs}`),
    placeholderData: keepPreviousData,
  });
  const hasWebsites = (overviewQuery.data?.siteCount ?? 0) > 0;

  const previousQuery = useQuery({
    queryKey: ['dashboard-overview', 'previous', previousRange.compareStartAt, previousRange.compareEndAt],
    enabled: hasWebsites,
    queryFn: () =>
      api<DashboardOverview>(
        `/api/dashboard?${rangeQueryString(previousRange.compareStartAt, previousRange.compareEndAt)}`,
      ),
    placeholderData: keepPreviousData,
  });

  const data = overviewQuery.data;
  const totals = data?.totals;
  const hourly = isHourlyChartRange(range.startAt, range.endAt);
  // Deltas only when both periods belong to the selected range (not a kept previous render).
  const showDeltas =
    Boolean(previousQuery.data) && !previousQuery.isPlaceholderData && !overviewQuery.isPlaceholderData;
  const previousTotals = showDeltas ? previousQuery.data?.totals : undefined;
  const deltasPending = hasWebsites && !showDeltas && (previousQuery.isFetching || overviewQuery.isFetching);

  const trend = useMemo(
    () =>
      data
        ? mergePageviewsVisitors(
            { pageviews: data.aggregateMetrics.pageviews, visitors: data.aggregateMetrics.visitors },
            hourly,
          )
        : [],
    [data, hourly],
  );

  const previousBySite = useMemo(() => {
    if (!showDeltas || !previousQuery.data) return undefined;
    return new Map<string, DashboardSiteTotals>(
      previousQuery.data.websites.map((site) => [
        site.id,
        { pageviews: site.pageviews, visitors: site.visitors, visits: site.visits },
      ]),
    );
  }, [previousQuery.data, showDeltas]);

  const pagesPerVisit = totals ? safeRatio(totals.pageviews, totals.visits) : undefined;
  const previousPagesPerVisit = previousTotals ? safeRatio(previousTotals.pageviews, previousTotals.visits) : undefined;

  const loadingFallback = (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={4} />
      <SectionCard title={t('trafficOverTime')}>
        <Skeleton className="h-[300px] w-full" />
      </SectionCard>
      <DashboardSiteRankingSkeleton />
    </div>
  );

  return (
    <Page className="ws-page-dashboard">
      <PageHeader
        title={t('dashboard')}
        lead={t('dashboardAllSitesLead')}
        actions={<DateRangePicker value={range} onChange={setRange} popover />}
      />

      <PageBody className="stack">
        <DataViewState
          loading={overviewQuery.isLoading && !data}
          error={overviewQuery.isError && !data ? overviewQuery.error : null}
          onRetry={() => overviewQuery.refetch()}
          loadingFallback={loadingFallback}
        >
          {!hasWebsites ? (
            <EmptyState
              variant="rich"
              icon={<Globe />}
              title={t('noWebsitesDashboard')}
              description={t('noWebsitesHint')}
            >
              <ol className="empty-state-steps">
                <li data-step="1">{t('emptyStep1')}</li>
                <li data-step="2">{t('emptyStep2')}</li>
                <li data-step="3">{t('emptyStep3')}</li>
              </ol>
              {isDemo ? null : (
                <div className="empty-state-actions">
                  <Button variant="primary" render={<Link to="/websites?new=1" />}>
                    <Plus aria-hidden />
                    {t('addWebsiteCta')}
                  </Button>
                </div>
              )}
            </EmptyState>
          ) : (
            <>
              <section aria-labelledby="ws-dashboard-kpis">
                <h2 id="ws-dashboard-kpis" className="visually-hidden">
                  {t('dashboardTotalTraffic')}
                </h2>
                {totals ? (
                  <KpiStrip columns={4}>
                    <KpiCell
                      label={t('visitors')}
                      keyColor={chartColors.series.visitors}
                      value={formatNumber(totals.visitors)}
                      delta={deltaFor(totals.visitors, previousTotals?.visitors, showDeltas, deltasPending)}
                    />
                    <KpiCell
                      label={t('visits')}
                      value={formatNumber(totals.visits)}
                      delta={deltaFor(totals.visits, previousTotals?.visits, showDeltas, deltasPending)}
                    />
                    <KpiCell
                      label={t('pageviews')}
                      keyColor={chartColors.series.pageviews}
                      value={formatNumber(totals.pageviews)}
                      delta={deltaFor(totals.pageviews, previousTotals?.pageviews, showDeltas, deltasPending)}
                    />
                    <KpiCell
                      label={t('workspacePagesPerVisit')}
                      value={pagesPerVisit === undefined ? '–' : formatNumber(pagesPerVisit, { maximumFractionDigits: 2 })}
                      delta={deltaFor(pagesPerVisit, previousPagesPerVisit, showDeltas, deltasPending)}
                    />
                  </KpiStrip>
                ) : null}
              </section>

              <OverviewTrendCard data={trend} hourly={hourly} />

              <DashboardSiteRanking
                sites={data?.websites ?? []}
                previous={previousBySite}
                deltasPending={deltasPending}
                siteCount={data?.siteCount ?? 0}
              />
            </>
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}
