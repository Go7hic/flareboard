import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CompareReportControls } from '../components/CompareReportControls';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { EmptyState } from '../components/EmptyState';
import { MetricsTable } from '../components/MetricsTable';
import { WebsitePageShell } from '../components/WebsitePageShell';
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

function CompareKpiCard({
  label,
  value,
  change,
  invertDelta = false,
}: {
  label: string;
  value: string;
  change: number;
  invertDelta?: boolean;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <StatChangeDelta change={change} invertColors={invertDelta} />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="stat-card stat-card-skeleton" aria-hidden>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="mt-[0.65rem] h-7 w-full" />
    </div>
  );
}

export default function WebsiteComparePage() {
  const chartColors = useChartColors();
  const { websiteId, range, setRange, segmentId, setSegmentId, segmentQs, segments, rangeQs } =
    useWebsiteReportContext('24h');
  const [compareMode, setCompareMode] = useState<CompareMode>('previous');
  const [metricTab, setMetricTab] = useState<MetricTab>('path');

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
    );
  }, [compareQuery.data]);

  const kpiMetrics = useMemo(() => {
    if (!compareQuery.data) return null;
    const { primary, compare } = compareQuery.data;
    const currentBounce = bounceRateFromStats(primary.stats);
    const previousBounce = bounceRateFromStats(compare.stats);
    const currentAvg = avgDurationSecFromStats(primary.stats);
    const previousAvg = avgDurationSecFromStats(compare.stats);
    return {
      visitors: {
        value: primary.stats.visitors.value.toLocaleString(),
        change: pctChange(primary.stats.visitors.value, compare.stats.visitors.value),
      },
      visits: {
        value: primary.stats.visits.value.toLocaleString(),
        change: pctChange(primary.stats.visits.value, compare.stats.visits.value),
      },
      pageviews: {
        value: primary.stats.pageviews.value.toLocaleString(),
        change: pctChange(primary.stats.pageviews.value, compare.stats.pageviews.value),
      },
      bounceRate: {
        value: `${currentBounce}%`,
        change: pctChange(currentBounce, previousBounce),
        invertDelta: true,
      },
      avgDuration: {
        value: formatDuration(currentAvg),
        change: pctChange(currentAvg, previousAvg),
      },
    };
  }, [compareQuery.data]);

  const visitorsCurrentFill = `color-mix(in srgb, ${chartColors.accent} 42%, var(--bg-elevated))`;
  const pageviewsPrevFill = `color-mix(in srgb, var(--text-muted) 55%, var(--accent))`;
  const visitorsPrevFill = `color-mix(in srgb, var(--text-muted) 80%, transparent)`;

  return (
    <div className="page page-compare">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <CompareReportControls
            range={range}
            onRangeChange={setRange}
            compareMode={compareMode}
            onCompareModeChange={setCompareMode}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
          />
        }
      />

      <section className="panel section-gap compare-panel">
        {compareQuery.isLoading ? (
          <>
            <div className="analytics-hero-stats">
              {Array.from({ length: 5 }).map((_, i) => (
                <KpiSkeleton key={i} />
              ))}
            </div>
            <div className="compare-chart chart-skeleton" aria-busy>
              <Skeleton className="h-64 w-full" />
            </div>
          </>
        ) : !compareQuery.data ? (
          <EmptyState title={t('noDataInPeriod')} />
        ) : (
          <>
            <div className="analytics-hero-stats">
              <CompareKpiCard label={t('visitors')} value={kpiMetrics!.visitors.value} change={kpiMetrics!.visitors.change} />
              <CompareKpiCard label={t('visits')} value={kpiMetrics!.visits.value} change={kpiMetrics!.visits.change} />
              <CompareKpiCard label={t('pageviews')} value={kpiMetrics!.pageviews.value} change={kpiMetrics!.pageviews.change} />
              <CompareKpiCard
                label={t('bounceRate')}
                value={kpiMetrics!.bounceRate.value}
                change={kpiMetrics!.bounceRate.change}
                invertDelta={kpiMetrics!.bounceRate.invertDelta}
              />
              <CompareKpiCard
                label={t('avgDuration')}
                value={kpiMetrics!.avgDuration.value}
                change={kpiMetrics!.avgDuration.change}
              />
            </div>

            <div className="compare-chart">
              {chartData.length > 0 ? (
                <div className="chart-wrap chart-wrap-hero">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={chartColors.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x"
                        tick={{ fill: chartColors.muted, fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: chartColors.border }}
                        interval="preserveStartEnd"
                        minTickGap={20}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: chartColors.muted, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                      />
                      <Tooltip
                        contentStyle={{
                          background: chartColors.panel,
                          border: `1px solid ${chartColors.border}`,
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8125rem',
                        }}
                        labelStyle={{ color: chartColors.text }}
                      />
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
                        fill={chartColors.accent}
                        maxBarSize={24}
                      />
                      <Bar
                        dataKey="pageviews"
                        name={t('compareChartPageviewsCurrent')}
                        stackId="current"
                        fill={visitorsCurrentFill}
                        radius={[2, 2, 0, 0]}
                        maxBarSize={24}
                      />
                    </BarChart>
                  </ResponsiveContainer>
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
        )}
      </section>
    </div>
  );
}
