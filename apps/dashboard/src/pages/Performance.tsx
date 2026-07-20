import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bar, BarChart, Line, LineChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { SegmentTabs } from '../components/SegmentTabs';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useWebsiteRange } from '../lib/useWebsiteRange';

type VitalDistribution = {
  good: number;
  needsImprovement: number;
  poor: number;
  total: number;
};

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
  distributions: {
    lcp: VitalDistribution;
    inp: VitalDistribution;
    cls: VitalDistribution;
    fcp: VitalDistribution;
    ttfb: VitalDistribution;
  };
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
type BreakdownMetric = 'lcp' | 'inp' | 'cls';
type TrendMetric = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb';

const BREAKDOWN_TABS: BreakdownTab[] = ['url', 'browser', 'country'];
const BREAKDOWN_METRICS: BreakdownMetric[] = ['lcp', 'inp', 'cls'];
const TREND_METRICS: TrendMetric[] = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'];

function formatMs(value: number | null | undefined) {
  if (value == null) return '—';
  return `${formatNumber(value)} ms`;
}

function formatCls(value: number | null | undefined) {
  if (value == null) return '—';
  return formatNumber(value, { maximumFractionDigits: 3 });
}

function formatAverage(metric: TrendMetric, value: number | null | undefined) {
  if (value == null) return '—';
  return metric === 'cls' ? String(value) : `${value} ms`;
}

function distPercents(dist: VitalDistribution) {
  const total = dist.total || 0;
  if (!total) return { good: 0, needsImprovement: 0, poor: 0 };
  return {
    good: Math.round((dist.good / total) * 100),
    needsImprovement: Math.round((dist.needsImprovement / total) * 100),
    poor: Math.round((dist.poor / total) * 100),
  };
}

function DistributionBar({ dist, loading }: { dist?: VitalDistribution; loading?: boolean }) {
  if (loading) return <Skeleton className="cwv-dist-bar" />;
  const pct = distPercents(dist ?? { good: 0, needsImprovement: 0, poor: 0, total: 0 });
  if (!dist?.total) {
    return <div className="cwv-dist-bar cwv-dist-bar-empty" aria-hidden />;
  }
  return (
    <div
      className="cwv-dist-bar"
      role="img"
      aria-label={`${pct.good}% ${t('cwvGood')}, ${pct.needsImprovement}% ${t('cwvNeedsImprovement')}, ${pct.poor}% ${t('cwvPoor')}`}
    >
      {pct.good > 0 ? (
        <span className="cwv-dist-segment cwv-dist-segment-good" style={{ flex: pct.good }} />
      ) : null}
      {pct.needsImprovement > 0 ? (
        <span
          className="cwv-dist-segment cwv-dist-segment-ni"
          style={{ flex: pct.needsImprovement }}
        />
      ) : null}
      {pct.poor > 0 ? (
        <span className="cwv-dist-segment cwv-dist-segment-poor" style={{ flex: pct.poor }} />
      ) : null}
    </div>
  );
}

function CwvVitalCard({
  label,
  metric,
  value,
  samples,
  dist,
  loading,
  primary,
}: {
  label: string;
  metric: TrendMetric;
  value: string;
  samples?: number;
  dist?: VitalDistribution;
  loading?: boolean;
  primary?: boolean;
}) {
  const pct = dist ? distPercents(dist) : null;
  return (
    <div className={`stat-card cwv-vital-card${primary ? ' stat-card-primary' : ''}`}>
      <div className="stat-label">
        {label}
        {samples != null && !loading ? (
          <span className="text-muted text-[0.78rem] font-normal"> ({formatNumber(samples)})</span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-[0.65rem] h-7 w-full" />
      ) : (
        <div className="stat-value">{value}</div>
      )}
      <DistributionBar dist={dist} loading={loading} />
      {!loading && pct && dist && dist.total > 0 ? (
        <div className="cwv-dist-legend">
          <span className="cwv-dist-legend-item">
            <span className="cwv-dist-dot cwv-dist-dot-good" />
            {t('cwvGood')} {pct.good}%
          </span>
          <span className="cwv-dist-legend-item">
            <span className="cwv-dist-dot cwv-dist-dot-ni" />
            {t('cwvNeedsImprovement')} {pct.needsImprovement}%
          </span>
          <span className="cwv-dist-legend-item">
            <span className="cwv-dist-dot cwv-dist-dot-poor" />
            {t('cwvPoor')} {pct.poor}%
          </span>
        </div>
      ) : null}
      {!loading && metric !== 'cls' ? (
        <div className="cwv-threshold-hint text-muted">{t(`cwvThreshold_${metric}`)}</div>
      ) : null}
    </div>
  );
}

function breakdownChartData(rows: PerformanceBreakdownRow[], metric: BreakdownMetric) {
  return rows.map((row) => {
    const dist = row[`${metric}Distribution`];
    const total = dist.total || 1;
    return {
      dimension: row.dimension,
      good: Math.round((dist.good / total) * 100),
      needsImprovement: Math.round((dist.needsImprovement / total) * 100),
      poor: Math.round((dist.poor / total) * 100),
      samples: row.samples,
      average: row[metric],
    };
  });
}

export default function PerformancePage() {
  const chartColors = useChartColors();
  const { websiteId } = useParams<{ websiteId: string }>();
    const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('url');
  const [breakdownMetric, setBreakdownMetric] = useState<BreakdownMetric>('lcp');
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('lcp');

  const performanceQuery = useQuery({
    queryKey: ['performance', websiteId, range],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<PerformanceReport>(
        `/api/reports/performance?websiteId=${websiteId}&${rangeQs}`,
      ),
  });

  const data = performanceQuery.data;
  const hasData = Boolean(data && data.samples > 0);
  const loading = performanceQuery.isLoading;

  const breakdownRows = data?.breakdown[breakdownTab] ?? [];
  const chartData = useMemo(
    () => breakdownChartData(breakdownRows, breakdownMetric),
    [breakdownRows, breakdownMetric],
  );

  const trendData = data?.trends.points ?? [];
  const cwvColors = useMemo(
    () => ({
      good: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
      ni: getComputedStyle(document.documentElement).getPropertyValue('--warning').trim(),
      poor: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
    }),
    [chartColors],
  );

  return (
    <div className="page page-performance">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
        }
      />

      <DataViewState
        loading={performanceQuery.isLoading && !performanceQuery.data}
        error={performanceQuery.isError ? performanceQuery.error : null}
        onRetry={() => performanceQuery.refetch()}
      >
      <section className="analytics-hero panel section-gap" aria-labelledby="performance-overview">
        <h2 id="performance-overview" className="visually-hidden">
          {t('performance')}
        </h2>
        <p className="section-lead">{t('performancePageLead')}</p>

        <div className="cwv-dist-global-legend" aria-hidden={loading}>
          <span className="cwv-dist-legend-item">
            <span className="cwv-dist-dot cwv-dist-dot-good" />
            {t('cwvGood')}
          </span>
          <span className="cwv-dist-legend-item">
            <span className="cwv-dist-dot cwv-dist-dot-ni" />
            {t('cwvNeedsImprovement')}
          </span>
          <span className="cwv-dist-legend-item">
            <span className="cwv-dist-dot cwv-dist-dot-poor" />
            {t('cwvPoor')}
          </span>
        </div>

        <div className="analytics-hero-stats">
          <CwvVitalCard
            label="LCP"
            metric="lcp"
            value={formatMs(data?.lcp)}
            samples={data?.lcpSamples}
            dist={data?.distributions.lcp}
            loading={loading}
            primary
          />
          <CwvVitalCard
            label="INP"
            metric="inp"
            value={formatMs(data?.inp)}
            samples={data?.inpSamples}
            dist={data?.distributions.inp}
            loading={loading}
            primary
          />
          <CwvVitalCard
            label="CLS"
            metric="cls"
            value={formatCls(data?.cls)}
            samples={data?.clsSamples}
            dist={data?.distributions.cls}
            loading={loading}
            primary
          />
          <CwvVitalCard
            label="FCP"
            metric="fcp"
            value={formatMs(data?.fcp)}
            samples={data?.fcpSamples}
            dist={data?.distributions.fcp}
            loading={loading}
          />
          <CwvVitalCard
            label="TTFB"
            metric="ttfb"
            value={formatMs(data?.ttfb)}
            samples={data?.ttfbSamples}
            dist={data?.distributions.ttfb}
            loading={loading}
          />
        </div>

        <div className="analytics-hero-chart">
          <div className="performance-trend-head">
            <h3 className="section-title">{t('performanceTrendTitle')}</h3>
            <SegmentTabs
              tabs={TREND_METRICS.map((metric) => ({
                id: metric,
                label: metric.toUpperCase(),
              }))}
              value={trendMetric}
              onChange={(id) => setTrendMetric(id as (typeof TREND_METRICS)[number])}
              aria-label={t('performanceTrendTitle')}
            />
          </div>
          {loading ? (
            <Skeleton className="h-56 w-full" />
          ) : trendData.length > 0 ? (
            <AnalyticsChart
              Chart={LineChart}
              data={trendData}
              responsive={{ height: 220 }}
              xAxis={{ dataKey: 'x' }}
              yAxis={{ allowDecimals: trendMetric === 'cls' }}
              tooltip={{
                formatter: (value) => [
                  formatAverage(trendMetric, typeof value === 'number' ? value : null),
                  trendMetric.toUpperCase(),
                ],
              }}
            >
              <Line
                type="monotone"
                dataKey={trendMetric}
                stroke={chartColors.accent}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </AnalyticsChart>
          ) : (
            <p className="text-muted">{t('chartNoData')}</p>
          )}
          {!loading && data ? (
            <p className="performance-trend-meta text-muted">
              {t('performanceTrendUnit')}: {data.trends.unit === 'hour' ? t('hourly') : t('daily')}
              {' · '}
              {t('performanceEvents')}: {formatNumber(data.samples)}
            </p>
          ) : null}
        </div>

        {!loading && !hasData ? (
          <div className="panel empty-state-rich">
            <EmptyState
              title={t('noDataInPeriod')}
              description={t('noDataInPeriodHint')}
            />
          </div>
        ) : null}
      </section>

      {hasData || loading ? (
        <section className="panel breakdown-panel section-gap-lg">
          <div className="breakdown-panel-head">
            <h2 className="section-title">{t('performanceBreakdownTitle')}</h2>
            <SegmentTabs
              tabs={BREAKDOWN_TABS.map((tab) => ({
                id: tab,
                label:
                  tab === 'url'
                    ? t('performanceBreakdownUrl')
                    : tab === 'browser'
                      ? t('browser')
                      : t('country'),
              }))}
              value={breakdownTab}
              onChange={(id) => setBreakdownTab(id as BreakdownTab)}
              aria-label={t('performanceBreakdownTitle')}
            />
          </div>

          <div className="performance-breakdown-metric-row">
            <span className="path-sort-toolbar-label">{t('performanceBreakdownMetric')}:</span>
            <SegmentTabs
              tabs={BREAKDOWN_METRICS.map((metric) => ({
                id: metric,
                label: metric.toUpperCase(),
              }))}
              value={breakdownMetric}
              onChange={(id) => setBreakdownMetric(id as (typeof BREAKDOWN_METRICS)[number])}
              aria-label={t('performanceBreakdownMetric')}
            />
          </div>

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : breakdownRows.length > 0 ? (
            <>
              <div className="performance-breakdown-chart">
                <AnalyticsChart
                  Chart={BarChart}
                  data={chartData}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                  grid={{ horizontal: false }}
                  responsive={{ height: Math.max(180, breakdownRows.length * 36) }}
                  xAxis={{
                    type: 'number',
                    domain: [0, 100],
                    tickFormatter: (v) => `${v}%`,
                  }}
                  yAxis={{
                    type: 'category',
                    dataKey: 'dimension',
                    width: 140,
                  }}
                  tooltip={{
                    formatter: (value, name) => {
                      const label =
                        name === 'good'
                          ? t('cwvGood')
                          : name === 'needsImprovement'
                            ? t('cwvNeedsImprovement')
                            : t('cwvPoor');
                      return [`${value}%`, label];
                    },
                  }}
                >
                  <Bar dataKey="good" stackId="dist" fill={cwvColors.good} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="needsImprovement" stackId="dist" fill={cwvColors.ni} />
                  <Bar dataKey="poor" stackId="dist" fill={cwvColors.poor} radius={[0, 4, 4, 0]} />
                </AnalyticsChart>
              </div>

              <div className="data-table-wrap performance-breakdown-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>
                        {breakdownTab === 'url'
                          ? t('performanceBreakdownUrl')
                          : breakdownTab === 'browser'
                            ? t('browser')
                            : t('country')}
                      </th>
                      <th>{t('performanceEvents')}</th>
                      <th>LCP</th>
                      <th>INP</th>
                      <th>CLS</th>
                      <th>{breakdownMetric.toUpperCase()} {t('performanceDistribution')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownRows.map((row) => (
                      <tr key={row.dimension}>
                        <td className="performance-breakdown-dimension">{row.dimension}</td>
                        <td>{formatNumber(row.samples)}</td>
                        <td>{formatMs(row.lcp)}</td>
                        <td>{formatMs(row.inp)}</td>
                        <td>{formatCls(row.cls)}</td>
                        <td className="performance-breakdown-dist-cell">
                          <DistributionBar dist={row[`${breakdownMetric}Distribution`]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-muted">{t('chartNoData')}</p>
          )}
        </section>
      ) : null}
      </DataViewState>
    </div>
  );
}
