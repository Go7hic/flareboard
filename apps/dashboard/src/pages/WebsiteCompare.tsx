import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { GitCompareArrows } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Line, LineChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { BreakdownList } from '../components/BreakdownList';
import { ChartLegend } from '../components/ChartLegend';
import { CompareReportControls } from '../components/CompareReportControls';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatChangeDelta } from '../components/StatChangeDelta';
import { StatusBadge } from '../components/StatusBadge';
import { percentChange } from '../components/traffic/format';
import { alignCompareSeries, bucketLabel, type SeriesPoint, type SeriesUnit } from '../components/traffic/series';
import { ShowMoreToggle } from '../components/traffic/ShowMoreToggle';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api, type MetricRow, type WebsiteStats } from '../lib/api';
import { isMetricTab, METRIC_TABS, metricTabLabel, type MetricTab } from '../lib/breakdown-dimensions';
import { lineMark, previousLineMark } from '../lib/chartMarks';
import { computeCompareRange, type CompareMode } from '../lib/compare-utils';
import { rangeQueryString } from '../lib/dateRange';
import { formatDurationSeconds, formatNumber, formatPercent, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';
import { formatMetricLabel } from '../lib/metric-labels';
import { countryFlagEmoji } from '../lib/session-display';
import { useChartColors } from '../lib/useChartColors';

type CompareResponse = {
  primary: { startAt: number; endAt: number; stats: WebsiteStats };
  compare: { startAt: number; endAt: number; stats: WebsiteStats };
  unit: SeriesUnit | string;
  series: {
    primary: { pageviews: SeriesPoint[]; visitors: SeriesPoint[] };
    compare: { pageviews: SeriesPoint[]; visitors: SeriesPoint[] };
  };
};

type ChartMetric = 'visitors' | 'pageviews';

/** Rows per dimension request; the table shows the top ones and can expand. */
const DIMENSION_LIMIT = 50;
const DIMENSION_ROWS = 10;

function derived(stats: WebsiteStats) {
  const visits = stats.visits.value;
  return {
    bounceRate: visits > 0 ? (stats.bounces.value / visits) * 100 : 0,
    avgDuration: visits > 0 ? stats.totaltime.value / visits : 0,
  };
}

function periodLabel(startAt: number, endAt: number) {
  const start = formatShortDate(startAt);
  // The end is exclusive at midnight for calendar ranges; step back a second for the label.
  const end = formatShortDate(endAt - 1000);
  return start === end ? start : `${start} – ${end}`;
}

function ComparePageSkeleton() {
  return (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={5} />
      <SectionCard title={<Skeleton className="h-4 w-40" />}>
        <Skeleton className="h-[280px] w-full" />
      </SectionCard>
    </div>
  );
}

export default function WebsiteComparePage() {
  const chartColors = useChartColors();
  const [searchParams] = useSearchParams();
  const compareFromUrl = searchParams.get('compare');
  const segmentFromUrl = searchParams.get('segment') ?? '';
  const { websiteId, range, setRange, segmentId, setSegmentId, segmentQs, segments, rangeQs, timezone } =
    useWebsiteReportContext('24h');
  const [compareMode, setCompareMode] = useState<CompareMode>(() => (compareFromUrl === 'year' ? 'year' : 'previous'));
  const [chartMetric, setChartMetric] = useState<ChartMetric>('visitors');
  const [metricTab, setMetricTab] = useState<MetricTab>('path');
  const [showAllRows, setShowAllRows] = useState(false);

  useEffect(() => {
    if (segmentFromUrl) setSegmentId(segmentFromUrl);
  }, [segmentFromUrl, setSegmentId]);

  useEffect(() => {
    if (compareFromUrl === 'year' || compareFromUrl === 'previous') setCompareMode(compareFromUrl);
  }, [compareFromUrl]);

  const compareRange = useMemo(
    () => computeCompareRange(range.startAt, range.endAt, compareMode),
    [range.startAt, range.endAt, compareMode],
  );
  const compareRangeQs = rangeQueryString(compareRange.compareStartAt, compareRange.compareEndAt);
  const compareLabel = compareMode === 'year' ? t('compareModeYear') : t('compareModePrevious');
  const deltaLabel = compareMode === 'year' ? t('trafficVsLastYear') : t('vsPreviousPeriod');

  const compareQuery = useQuery({
    queryKey: ['stats-compare', websiteId, segmentId, rangeQs, compareMode],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<CompareResponse>(
        `/api/websites/${websiteId}/stats/compare?${rangeQs}&compareStartAt=${compareRange.compareStartAt}&compareEndAt=${compareRange.compareEndAt}${segmentQs}`,
      ),
  });

  const metricsUrl = (qs: string) =>
    `/api/websites/${websiteId}/metrics?type=${metricTab}&${qs}${segmentQs}&limit=${DIMENSION_LIMIT}`;
  const currentRowsQuery = useQuery({
    queryKey: ['compare-dimension', websiteId, metricTab, rangeQs, segmentQs],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () => api<MetricRow[]>(metricsUrl(rangeQs)),
  });
  const previousRowsQuery = useQuery({
    queryKey: ['compare-dimension', websiteId, metricTab, compareRangeQs, segmentQs],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () => api<MetricRow[]>(metricsUrl(compareRangeQs)),
  });

  const data = compareQuery.data;
  const unit: SeriesUnit = data?.unit === 'hour' || data?.unit === 'month' ? data.unit : 'day';

  const chartData = useMemo(() => {
    if (!data) return [];
    return alignCompareSeries({
      current: data.series.primary[chartMetric],
      previous: data.series.compare[chartMetric],
      unit,
      startAt: data.primary.startAt,
      endAt: data.primary.endAt,
      previousStartAt: data.compare.startAt,
      timeZone: timezone,
    }).map((point) => ({
      label: bucketLabel(point.key, unit, timezone),
      previousLabel: bucketLabel(point.previousKey, unit, timezone),
      current: point.current,
      previous: point.previous,
    }));
  }, [data, chartMetric, unit, timezone]);

  /** Current vs previous per row. A row missing from a full (limit-sized) list is unknown, not zero. */
  const dimensionRows = useMemo(() => {
    const current = currentRowsQuery.data ?? [];
    const previous = previousRowsQuery.data ?? [];
    const currentComplete = current.length < DIMENSION_LIMIT;
    const previousComplete = previous.length < DIMENSION_LIMIT;
    const currentBy = new Map(current.map((row) => [row.x, row.y]));
    const previousBy = new Map(previous.map((row) => [row.x, row.y]));
    const keys = new Set([...currentBy.keys(), ...previousBy.keys()]);
    return [...keys]
      .map((key) => ({
        key,
        current: currentBy.get(key) ?? (currentComplete ? 0 : null),
        previous: previousBy.get(key) ?? (previousComplete ? 0 : null),
      }))
      .sort((a, b) => (b.current ?? 0) - (a.current ?? 0) || (b.previous ?? 0) - (a.previous ?? 0));
  }, [currentRowsQuery.data, previousRowsQuery.data]);

  const visibleRows = showAllRows ? dimensionRows : dimensionRows.slice(0, DIMENSION_ROWS);
  const maxRow = Math.max(1, ...visibleRows.map((row) => Math.max(row.current ?? 0, row.previous ?? 0)));
  const seriesColor = chartColors.series[chartMetric];
  const legendVar = chartMetric === 'visitors' ? 'var(--chart-visitors)' : 'var(--chart-pageviews)';

  function kpi(label: string, current: number, previous: number, format: (value: number) => string, invert = false) {
    const change = percentChange(current, previous);
    return (
      <KpiCell
        label={label}
        value={format(current)}
        delta={change === undefined ? undefined : <StatChangeDelta change={change} invertColors={invert} label={deltaLabel} />}
        hint={t('trafficPreviousValue').replace('{value}', format(previous))}
      />
    );
  }

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

      <PageBody className="stack">
        <DataViewState
          loading={compareQuery.isLoading && !data}
          error={compareQuery.isError && !data ? compareQuery.error : null}
          onRetry={() => compareQuery.refetch()}
          loadingFallback={<ComparePageSkeleton />}
        >
          {!data ? (
            <EmptyState variant="rich" icon={<GitCompareArrows />} title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
          ) : (
            <>
              <KpiStrip columns={5}>
                {kpi(t('visitors'), data.primary.stats.visitors.value, data.compare.stats.visitors.value, (v) => formatNumber(v))}
                {kpi(t('visits'), data.primary.stats.visits.value, data.compare.stats.visits.value, (v) => formatNumber(v))}
                {kpi(t('pageviews'), data.primary.stats.pageviews.value, data.compare.stats.pageviews.value, (v) => formatNumber(v))}
                {kpi(
                  t('bounceRate'),
                  derived(data.primary.stats).bounceRate,
                  derived(data.compare.stats).bounceRate,
                  (v) => formatPercent(v, { digits: v > 0 && v < 10 ? 1 : 0 }),
                  true,
                )}
                {kpi(
                  t('avgDuration'),
                  derived(data.primary.stats).avgDuration,
                  derived(data.compare.stats).avgDuration,
                  (v) => formatDurationSeconds(v),
                )}
              </KpiStrip>

              <SectionCard
                title={chartMetric === 'visitors' ? t('visitors') : t('pageviews')}
                description={t('trafficComparePeriods')
                  .replace('{current}', periodLabel(data.primary.startAt, data.primary.endAt))
                  .replace('{previous}', periodLabel(data.compare.startAt, data.compare.endAt))}
                actions={
                  <>
                    <ChartLegend
                      items={[
                        { label: t('compareCurrent'), color: legendVar },
                        { label: compareLabel, color: `color-mix(in srgb, ${legendVar} 35%, transparent)` },
                      ]}
                    />
                    <div className="segmented" role="group" aria-label={t('trafficChartMetric')}>
                      {(['visitors', 'pageviews'] as const).map((key) => (
                        <button key={key} type="button" aria-pressed={chartMetric === key} onClick={() => setChartMetric(key)}>
                          {key === 'visitors' ? t('visitors') : t('pageviews')}
                        </button>
                      ))}
                    </div>
                  </>
                }
              >
                {chartData.some((point) => point.current > 0 || (point.previous ?? 0) > 0) ? (
                  <div className="traffic-chart">
                    <AnalyticsChart
                      Chart={LineChart}
                      data={chartData}
                      responsive={{ height: 280 }}
                      xAxis={{ dataKey: 'label', interval: 'preserveStartEnd', minTickGap: unit === 'hour' ? 32 : 24 }}
                      tooltip={{
                        formatter: (value: unknown, name: unknown, entry: { dataKey?: unknown; payload?: { previousLabel?: string } }) => {
                          const formatted = typeof value === 'number' ? formatNumber(value) : '-';
                          if (entry?.dataKey === 'previous') {
                            return [formatted, `${compareLabel} · ${entry.payload?.previousLabel ?? ''}`];
                          }
                          return [formatted, String(name ?? '')];
                        },
                      }}
                    >
                      <Line
                        dataKey="previous"
                        name={compareLabel}
                        stroke={seriesColor}
                        connectNulls={false}
                        {...previousLineMark(chartColors.panel)}
                      />
                      <Line dataKey="current" name={t('compareCurrent')} stroke={seriesColor} {...lineMark(chartColors.panel)} />
                    </AnalyticsChart>
                  </div>
                ) : (
                  <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
                )}
              </SectionCard>

              <SectionCard
                title={t('trafficCompareByDimension')}
                description={t('trafficCompareByDimensionLead')}
                actions={
                  <Select
                    value={metricTab}
                    onValueChange={(next) => {
                      if (typeof next === 'string' && isMetricTab(next)) {
                        setMetricTab(next);
                        setShowAllRows(false);
                      }
                    }}
                    items={METRIC_TABS.map((tab) => ({ value: tab, label: metricTabLabel(tab) }))}
                  >
                    <SelectTrigger size="sm" className="traffic-select" aria-label={t('topMetric')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRIC_TABS.map((tab) => (
                        <SelectItem key={tab} value={tab}>
                          {metricTabLabel(tab)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              >
                {currentRowsQuery.isLoading && !currentRowsQuery.data ? (
                  <div className="traffic-skeleton-rows" aria-hidden>
                    {Array.from({ length: 5 }, (_, index) => (
                      <Skeleton key={index} className="h-8 w-full" />
                    ))}
                  </div>
                ) : visibleRows.length ? (
                  <>
                    <BreakdownList
                      labelHeader={metricTabLabel(metricTab)}
                      columns={[
                        { label: t('compareCurrent') },
                        { label: compareLabel },
                        { label: t('trafficChange') },
                      ]}
                      items={visibleRows.map((row) => {
                        const label =
                          metricTab === 'country' ? getCountryLabel(row.key) : formatMetricLabel(metricTab, row.key);
                        const flag = metricTab === 'country' ? countryFlagEmoji(row.key) : '';
                        const change =
                          row.current != null && row.previous != null ? percentChange(row.current, row.previous) : undefined;
                        return {
                          id: row.key,
                          label: label || '-',
                          title: label,
                          mono: metricTab === 'path' || metricTab === 'entry' || metricTab === 'exit',
                          icon: flag ? (
                            <span className="traffic-flag" aria-hidden>
                              {flag}
                            </span>
                          ) : undefined,
                          share: (row.current ?? 0) / maxRow,
                          values: [
                            row.current == null ? '-' : formatNumber(row.current),
                            row.previous == null ? '-' : formatNumber(row.previous),
                            change !== undefined ? (
                              <StatChangeDelta change={change} label={deltaLabel} />
                            ) : row.previous === 0 && (row.current ?? 0) > 0 ? (
                              <StatusBadge tone="info" dot={false}>
                                {t('trafficNew')}
                              </StatusBadge>
                            ) : (
                              '-'
                            ),
                          ],
                        };
                      })}
                    />
                    {dimensionRows.length > DIMENSION_ROWS ? (
                      <ShowMoreToggle
                        expanded={showAllRows}
                        total={dimensionRows.length}
                        onToggle={() => setShowAllRows((value) => !value)}
                      />
                    ) : null}
                  </>
                ) : (
                  <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
                )}
              </SectionCard>
            </>
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}
