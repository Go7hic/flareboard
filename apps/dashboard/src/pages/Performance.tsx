import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Area, AreaChart, ReferenceLine } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { formatShare } from '../components/traffic/format';
import { bucketKeys, bucketLabel } from '../components/traffic/series';
import { VitalMeter } from '../components/traffic/VitalMeter';
import {
  formatVital,
  goodShare,
  p75Rating,
  RATING_TONE,
  ratingLabel,
  VITAL_METRICS,
  VITAL_NAME_KEYS,
  VITAL_THRESHOLDS,
  vitalParts,
  vitalTick,
  type VitalDistribution,
  type VitalMetric,
} from '../components/traffic/vitals';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../lib/api';
import { niceTicks } from '../lib/chartTicks';
import { areaMark } from '../lib/chartMarks';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';
import { countryFlagEmoji } from '../lib/session-display';
import { useChartColors } from '../lib/useChartColors';
import { useWebsiteRange } from '../lib/useWebsiteRange';

type PerformanceBreakdownRow = {
  dimension: string;
  samples: number;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  lcpDistribution: VitalDistribution;
  inpDistribution: VitalDistribution;
  clsDistribution: VitalDistribution;
};

type PerformanceTrendPoint = {
  x: string;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  samples: number;
};

interface PerformanceReport {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  samples: number;
  lcpSamples?: number;
  inpSamples?: number;
  clsSamples?: number;
  fcpSamples?: number;
  ttfbSamples?: number;
  distributions: Record<VitalMetric, VitalDistribution>;
  trends: {
    unit: 'hour' | 'day';
    points: PerformanceTrendPoint[];
  };
  breakdown: {
    url: PerformanceBreakdownRow[];
    browser: PerformanceBreakdownRow[];
    country: PerformanceBreakdownRow[];
  };
}

type BreakdownTab = 'url' | 'browser' | 'country';
const BREAKDOWN_TABS: BreakdownTab[] = ['url', 'browser', 'country'];
/** The breakdown carries rating splits for the three Core Web Vitals only. */
const BREAKDOWN_METRICS = ['lcp', 'inp', 'cls'] as const;

const SAMPLE_KEYS = {
  lcp: 'lcpSamples',
  inp: 'inpSamples',
  cls: 'clsSamples',
  fcp: 'fcpSamples',
  ttfb: 'ttfbSamples',
} as const satisfies Record<VitalMetric, keyof PerformanceReport>;

const DISTRIBUTION_KEYS = {
  lcp: 'lcpDistribution',
  inp: 'inpDistribution',
  cls: 'clsDistribution',
} as const satisfies Record<(typeof BREAKDOWN_METRICS)[number], keyof PerformanceBreakdownRow>;

function tabLabel(tab: BreakdownTab) {
  if (tab === 'url') return t('page');
  if (tab === 'browser') return t('browser');
  return t('country');
}

function RatingBadge({ dist }: { dist: VitalDistribution | undefined }) {
  const rating = p75Rating(dist);
  if (!rating || !dist) return null;
  const good = goodShare(dist);
  return (
    <StatusBadge
      tone={RATING_TONE[rating]}
      title={t('trafficRatingHint').replace('{pct}', formatShare(good))}
    >
      {ratingLabel(rating)}
    </StatusBadge>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={5} />
      <SectionCard title={<Skeleton className="h-4 w-40" />}>
        <Skeleton className="h-[260px] w-full" />
      </SectionCard>
      <SectionCard title={<Skeleton className="h-4 w-32" />}>
        <Skeleton className="h-[220px] w-full" />
      </SectionCard>
    </div>
  );
}

export default function PerformancePage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [metric, setMetric] = useState<VitalMetric>('lcp');
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('url');

  const performanceQuery = useQuery({
    queryKey: ['performance', websiteId, rangeQs],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () => api<PerformanceReport>(`/api/reports/performance?websiteId=${websiteId}&${rangeQs}`),
  });

  const data = performanceQuery.data;
  const hasData = Boolean(data && data.samples > 0);
  const unit = data?.trends.unit ?? 'hour';
  const threshold = VITAL_THRESHOLDS[metric];

  // Every bucket in the range (UTC, like the API); empty buckets are gaps, not zeros. While a
  // new range loads, the previous report stays on screen with its own buckets.
  const stale = performanceQuery.isPlaceholderData;
  const trend = useMemo(() => {
    if (!data) return [];
    const byKey = new Map(data.trends.points.map((point) => [point.x, point]));
    const keys = stale ? data.trends.points.map((point) => point.x) : bucketKeys(range.startAt, range.endAt, unit, 'UTC');
    return keys.map((key) => ({
      label: bucketLabel(key, unit, timezone),
      value: byKey.get(key)?.[metric] ?? null,
      samples: byKey.get(key)?.samples ?? 0,
    }));
  }, [data, metric, range.startAt, range.endAt, unit, timezone, stale]);

  const yAxis = useMemo(() => {
    const values = trend.map((point) => point.value).filter((value): value is number => value != null);
    const max = Math.max(threshold.good * 1.1, ...values);
    const ticks = niceTicks(max, 4, metric === 'cls');
    return { ticks, domain: [0, ticks[ticks.length - 1]] as [number, number] };
  }, [trend, threshold.good, metric]);

  const breakdownRows = data?.breakdown[breakdownTab] ?? [];
  const metricName = t(VITAL_NAME_KEYS[metric]);
  const samples = data?.[SAMPLE_KEYS[metric]] ?? data?.samples ?? 0;

  return (
    <Page className="page-performance">
      <PageHeader
        title={t('performance')}
        lead={t('performancePageLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
      />

      <PageBody className="stack">
        <DataViewState
          loading={performanceQuery.isLoading && !data}
          error={performanceQuery.isError && !data ? performanceQuery.error : null}
          onRetry={() => performanceQuery.refetch()}
          loadingFallback={<PerformanceSkeleton />}
        >
          {!hasData ? (
            <EmptyState
              variant="rich"
              icon={<Gauge />}
              title={t('trafficPerfEmptyTitle')}
              description={t('trafficPerfEmptyBody')}
            />
          ) : (
            <>
              <KpiStrip columns={5} label={t('trafficVitalsLabel')} className="traffic-vitals-strip">
                {VITAL_METRICS.map((key) => {
                  const parts = vitalParts(key, data?.[key]);
                  const dist = data?.distributions[key];
                  const good = goodShare(dist);
                  return (
                    <KpiCell
                      key={key}
                      selected={metric === key}
                      onSelect={() => setMetric(key)}
                      label={
                        <>
                          <abbr title={t(VITAL_NAME_KEYS[key])}>{key.toUpperCase()}</abbr>
                          <span className="traffic-kpi-label-note">{t('trafficAvg')}</span>
                          <RatingBadge dist={dist} />
                        </>
                      }
                      value={parts.value}
                      unit={parts.unit || undefined}
                      hint={
                        <span className="traffic-vital-hint">
                          <VitalMeter dist={dist} />
                          <span>{good == null ? '-' : t('trafficGoodShare').replace('{pct}', formatShare(good))}</span>
                        </span>
                      }
                    />
                  );
                })}
              </KpiStrip>

              <SectionCard
                title={t('trafficMetricOverTime').replace('{metric}', metric.toUpperCase())}
                description={`${metricName} · ${(unit === 'hour' ? t('trafficAvgPerHour') : t('trafficAvgPerDay')).replace(
                  '{samples}',
                  formatNumber(samples),
                )}`}
              >
                {trend.some((point) => point.value != null) ? (
                  <div className="traffic-chart">
                    <AnalyticsChart
                      Chart={AreaChart}
                      data={trend}
                      responsive={{ height: 260 }}
                      valueFormatter={(value) => formatVital(metric, value)}
                      xAxis={{ dataKey: 'label', interval: 'preserveStartEnd', minTickGap: 40 }}
                      yAxis={{
                        ...yAxis,
                        allowDecimals: metric === 'cls',
                        width: 56,
                        tickFormatter: (value: number) => vitalTick(metric, value),
                      }}
                    >
                      <ReferenceLine
                        y={threshold.good}
                        stroke={chartColors.muted}
                        strokeOpacity={0.6}
                        ifOverflow="extendDomain"
                        label={{
                          value: t('trafficGoodThreshold').replace('{value}', formatVital(metric, threshold.good)),
                          position: 'insideTopLeft',
                          fill: chartColors.muted,
                          fontSize: 11,
                          // A halo in the card color keeps the label legible where the line crosses it.
                          stroke: chartColors.panel,
                          strokeWidth: 3,
                          paintOrder: 'stroke',
                        }}
                      />
                      <Area
                        dataKey="value"
                        name={metric.toUpperCase()}
                        stroke={chartColors.accent}
                        fill={chartColors.accent}
                        connectNulls
                        {...areaMark(chartColors.panel)}
                      />
                    </AnalyticsChart>
                  </div>
                ) : (
                  <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />
                )}
              </SectionCard>

              <SectionCard
                flush
                title={t('performanceBreakdownTitle')}
                description={t('trafficPerfBreakdownLead')}
                actions={
                  <div className="segmented" role="group" aria-label={t('performanceBreakdownTitle')}>
                    {BREAKDOWN_TABS.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        aria-pressed={breakdownTab === tab}
                        onClick={() => setBreakdownTab(tab)}
                      >
                        {tabLabel(tab)}
                      </button>
                    ))}
                  </div>
                }
              >
                {breakdownRows.length ? (
                  <div className="table-scroll">
                    <table className="data-table traffic-vitals-table">
                      <thead>
                        <tr>
                          <th>{tabLabel(breakdownTab)}</th>
                          <th className="num">{t('samples')}</th>
                          {BREAKDOWN_METRICS.map((key) => (
                            <th key={key} className="num">
                              <abbr title={t(VITAL_NAME_KEYS[key])}>{key.toUpperCase()}</abbr>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownRows.map((row) => {
                          const flag = breakdownTab === 'country' ? countryFlagEmoji(row.dimension) : '';
                          const label =
                            breakdownTab === 'country' && row.dimension !== 'Unknown'
                              ? getCountryLabel(row.dimension)
                              : row.dimension === 'Unknown'
                                ? t('unknown')
                                : row.dimension;
                          return (
                            <tr key={row.dimension}>
                              <td>
                                <span className="traffic-location-cell">
                                  {flag ? (
                                    <span className="traffic-flag" aria-hidden>
                                      {flag}
                                    </span>
                                  ) : null}
                                  <span
                                    className={`traffic-cell-truncate${breakdownTab === 'url' ? ' mono' : ''}`}
                                    title={row.dimension}
                                  >
                                    {label}
                                  </span>
                                </span>
                              </td>
                              <td className="num">{formatNumber(row.samples)}</td>
                              {BREAKDOWN_METRICS.map((key) => {
                                const dist = row[DISTRIBUTION_KEYS[key]];
                                const rating = p75Rating(dist);
                                return (
                                  <td key={key} className="num traffic-vital-cell">
                                    <span className="traffic-vital-value">
                                      {rating ? (
                                        <span
                                          className={`traffic-rating-dot is-${rating}`}
                                          title={ratingLabel(rating)}
                                          aria-label={ratingLabel(rating)}
                                        />
                                      ) : null}
                                      {formatVital(key, row[key])}
                                    </span>
                                    <VitalMeter dist={dist} className="traffic-vital-cell-meter" />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title={t('noDataInPeriod')} />
                )}
              </SectionCard>
            </>
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}
