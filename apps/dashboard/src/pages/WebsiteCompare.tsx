import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, Legend } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { CompareReportControls } from '../components/CompareReportControls';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { EmptyState } from '../components/EmptyState';
import { MetricsTable } from '../components/MetricsTable';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { StatCard, StatCardSkeleton } from '../components/ui/stat-card';
import { Skeleton } from '../components/ui/skeleton';
import { useBreakdownMetrics } from '../hooks/useBreakdownMetrics';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api, type WebsiteStats } from '../lib/api';
import {
  isMetricTab,
  METRIC_TABS,
  metricTabLabel,
  type MetricTab,
} from '../lib/breakdown-dimensions';
import {
  avgDurationSecFromStats,
  bounceRateFromStats,
  computeCompareRange,
  formatCompareRangeLabel,
  formatDuration,
  mergeCompareChartData,
  pctChange,
  type CompareMode,
  type MetricsSeries,
} from '../lib/compare-utils';
import { rangeQueryString } from '../lib/dateRange';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

type CompareResponse = {
  primary: { startAt: number; endAt: number; stats: WebsiteStats };
  compare: { startAt: number; endAt: number; stats: WebsiteStats };
  unit: string;
  series: {
    primary: MetricsSeries;
    compare: MetricsSeries;
  };
};

export default function WebsiteComparePage() {
  const chartColors = useChartColors();
  const [searchParams] = useSearchParams();
  const compareFromUrl = searchParams.get('compare');
  const segmentFromUrl = searchParams.get('segment') ?? '';
  const { websiteId, range, setRange, segmentId, setSegmentId, segmentQs, segments, rangeQs, timezone } =
    useWebsiteReportContext('24h');
  const [compareMode, setCompareMode] = useState<CompareMode>(() =>
    compareFromUrl === 'year' ? 'year' : 'previous',
  );
  const [metricTab, setMetricTab] = useState<MetricTab>('path');

  useEffect(() => {
    if (segmentFromUrl) setSegmentId(segmentFromUrl);
  }, [segmentFromUrl, setSegmentId]);

  useEffect(() => {
    if (compareFromUrl === 'year' || compareFromUrl === 'previous') {
      setCompareMode(compareFromUrl);
    }
  }, [compareFromUrl]);

  const compareRange = useMemo(
    () => computeCompareRange(range.startAt, range.endAt, compareMode),
    [range.startAt, range.endAt, compareMode],
  );

  const compareQs = useMemo(() => {
    const base = `${rangeQs}&compareStartAt=${compareRange.compareStartAt}&compareEndAt=${compareRange.compareEndAt}${segmentQs}`;
    return base;
  }, [rangeQs, compareRange, segmentQs]);

  const compareRangeQs = rangeQueryString(compareRange.compareStartAt, compareRange.compareEndAt);

  const compareQuery = useQuery({
    queryKey: ['stats-compare', websiteId, segmentId, range, compareMode],
    enabled: Boolean(websiteId),
    queryFn: () => api<CompareResponse>(`/api/websites/${websiteId}/stats/compare?${compareQs}`),
  });

  const currentBreakdown = useBreakdownMetrics({
    websiteId,
    rangeQs,
    segmentQs,
    metricTab,
    enabled: Boolean(websiteId),
  });

  const previousBreakdown = useBreakdownMetrics({
    websiteId,
    rangeQs: compareRangeQs,
    segmentQs,
    metricTab,
    enabled: Boolean(websiteId),
  });

  const chartData = useMemo(() => {
    if (!compareQuery.data?.series) return [];
    return mergeCompareChartData(
      compareQuery.data.series.primary,
      compareQuery.data.series.compare,
      compareQuery.data.unit,
      timezone,
    );
  }, [compareQuery.data, timezone]);

  const kpiMetrics = useMemo(() => {
    if (!compareQuery.data) return null;
    const { primary, compare } = compareQuery.data;
    const currentBounce = bounceRateFromStats(primary.stats);
    const previousBounce = bounceRateFromStats(compare.stats);
    const currentAvg = avgDurationSecFromStats(primary.stats);
    const previousAvg = avgDurationSecFromStats(compare.stats);
    return {
      visitors: {
        value: formatNumber(primary.stats.visitors.value),
        change: pctChange(primary.stats.visitors.value, compare.stats.visitors.value),
      },
      visits: {
        value: formatNumber(primary.stats.visits.value),
        change: pctChange(primary.stats.visits.value, compare.stats.visits.value),
      },
      pageviews: {
        value: formatNumber(primary.stats.pageviews.value),
        change: pctChange(primary.stats.pageviews.value, compare.stats.pageviews.value),
      },
      bounceRate: {
        value: formatPercent(currentBounce),
        change: pctChange(currentBounce, previousBounce),
        invertDelta: true,
      },
      avgDuration: {
        value: formatDuration(currentAvg),
        change: pctChange(currentAvg, previousAvg),
      },
    };
  }, [compareQuery.data]);

  const pageviewsCurrentFill = chartColors.series.pageviews;
  const visitorsCurrentFill = chartColors.series.visitors;
  const pageviewsPrevFill = `color-mix(in srgb, ${chartColors.series.pageviews} 40%, var(--bg-elevated))`;
  const visitorsPrevFill = `color-mix(in srgb, ${chartColors.series.visitors} 40%, var(--bg-elevated))`;

  return (
    <Page className="page-compare">
      <PageHeader
        title={t('navCompare')}
        lead={t('websiteComparePageLead')}
        actions={
          <CompareReportControls
            range={range}
            onRangeChange={setRange}
            compareMode={compareMode}
            onCompareModeChange={setCompareMode}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
            timezone={timezone}
          />
        }
      />

      <PageBody>
      {compareQuery.isLoading ? (
        <section className="panel section-gap compare-panel">
          <div className="analytics-hero-stats">
            {Array.from({ length: 5 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <div className="compare-chart chart-skeleton" aria-busy>
            <Skeleton className="h-64 w-full" />
          </div>
        </section>
      ) : !compareQuery.data ? (
        <div className="section-gap">
          <EmptyState title={t('noDataInPeriod')} />
        </div>
      ) : (
      <section className="panel section-gap compare-panel">
          <>
            <div className="analytics-hero-stats">
              <StatCard
                label={t('visitors')}
                value={kpiMetrics!.visitors.value}
                delta={<StatChangeDelta change={kpiMetrics!.visitors.change} />}
              />
              <StatCard
                label={t('visits')}
                value={kpiMetrics!.visits.value}
                delta={<StatChangeDelta change={kpiMetrics!.visits.change} />}
              />
              <StatCard
                label={t('pageviews')}
                value={kpiMetrics!.pageviews.value}
                delta={<StatChangeDelta change={kpiMetrics!.pageviews.change} />}
              />
              <StatCard
                label={t('bounceRate')}
                value={kpiMetrics!.bounceRate.value}
                delta={
                  <StatChangeDelta
                    change={kpiMetrics!.bounceRate.change}
                    invertColors={kpiMetrics!.bounceRate.invertDelta}
                  />
                }
              />
              <StatCard
                label={t('avgDuration')}
                value={kpiMetrics!.avgDuration.value}
                delta={<StatChangeDelta change={kpiMetrics!.avgDuration.change} />}
              />
            </div>

            <div className="compare-chart">
              {chartData.length > 0 ? (
                <div className="chart-wrap chart-wrap-hero">
                  <AnalyticsChart
                    Chart={BarChart}
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    responsive={{ width: '100%', height: 280 }}
                    xAxis={{
                      dataKey: 'x',
                      tickLine: false,
                      axisLine: { stroke: chartColors.border },
                      interval: 'preserveStartEnd',
                      minTickGap: 20,
                    }}
                    yAxis={{
                      tickLine: false,
                      axisLine: false,
                      width: 32,
                    }}
                    tooltip={{ labelStyle: { color: chartColors.text } }}
                  >
                    <Legend
                      verticalAlign="bottom"
                      height={32}
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: '0.8125rem', color: chartColors.muted }}
                    />
                    <Bar
                      dataKey="visitorsPrev"
                      name={t('compareChartVisitorsPrev')}
                      stackId="previous"
                      fill={visitorsPrevFill}
                      maxBarSize={24}
                    />
                    <Bar
                      dataKey="pageviewsPrev"
                      name={t('compareChartPageviewsPrev')}
                      stackId="previous"
                      fill={pageviewsPrevFill}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={24}
                    />
                    <Bar
                      dataKey="visitors"
                      name={t('compareChartVisitorsCurrent')}
                      stackId="current"
                      fill={visitorsCurrentFill}
                      maxBarSize={24}
                    />
                    <Bar
                      dataKey="pageviews"
                      name={t('compareChartPageviewsCurrent')}
                      stackId="current"
                      fill={pageviewsCurrentFill}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={24}
                    />
                  </AnalyticsChart>
                </div>
              ) : (
                <EmptyState title={t('chartNoData')} description={t('noDataInPeriodHint')} />
              )}
            </div>

            <div className="compare-dimension-section">
              <div className="compare-dimension-head">
                <h3 className="section-title">{t('compareSection')}</h3>
                <label className="compare-dimension-select-wrap">
                  <span className="visually-hidden">{t('topMetric')}</span>
                  <select
                    className="compare-dimension-select"
                    value={metricTab}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (isMetricTab(next)) setMetricTab(next);
                    }}
                  >
                    {METRIC_TABS.map((tab) => (
                      <option key={tab} value={tab}>
                        {metricTabLabel(tab)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="compare-dimension-grid">
                <div className="compare-dimension-col">
                  <header className="compare-dimension-col-head">
                    <h4 className="compare-dimension-col-title">{t('comparePrevious')}</h4>
                    <p className="compare-dimension-col-range">
                      {formatCompareRangeLabel(
                        compareQuery.data.compare.startAt,
                        compareQuery.data.compare.endAt,
                      )}
                    </p>
                  </header>
                  <MetricsTable
                    embedded
                    hideTitle
                    title={metricTabLabel(metricTab)}
                    rows={previousBreakdown.rows}
                    loading={previousBreakdown.isLoading}
                    showPageStats={metricTab === 'path'}
                    maxRows={10}
                  />
                </div>
                <div className="compare-dimension-col">
                  <header className="compare-dimension-col-head">
                    <h4 className="compare-dimension-col-title">{t('compareCurrent')}</h4>
                    <p className="compare-dimension-col-range">
                      {formatCompareRangeLabel(
                        compareQuery.data.primary.startAt,
                        compareQuery.data.primary.endAt,
                      )}
                    </p>
                  </header>
                  <MetricsTable
                    embedded
                    hideTitle
                    title={metricTabLabel(metricTab)}
                    rows={currentBreakdown.rows}
                    loading={currentBreakdown.isLoading}
                    showPageStats={metricTab === 'path'}
                    maxRows={10}
                  />
                </div>
              </div>
            </div>
          </>
      </section>
      )}
      </PageBody>
    </Page>
  );
}
