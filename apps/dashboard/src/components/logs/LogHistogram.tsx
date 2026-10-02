import { useMemo } from 'react';
import { Bar, BarChart, BarStack } from 'recharts';
import { AnalyticsChart } from '../AnalyticsChart';
import { EmptyState } from '../EmptyState';
import { SectionCard } from '../SectionCard';
import { Skeleton } from '../ui/skeleton';
import { bucketRangeLabel, bucketTickLabel, bucketTicks, NonZeroTooltip, stackedAxis } from '../quality/chartParts';
import { useMediaQuery } from '../quality/useMediaQuery';
import { getSeverityColors, LOG_SEVERITIES, SEVERITY_CHART_VARS } from '../../lib/chart-colors';
import type { LogHistogramResponse, LogSeverity } from '../../lib/api';
import { STACK_MARK } from '../../lib/chartMarks';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useChartColors } from '../../lib/useChartColors';
import { cn } from '../../lib/utils';

/** Stack order, bottom up: the rare severe lines sit on the baseline where they stay visible. */
const STACK_ORDER: LogSeverity[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

type Row = { i: number; t: number; tick: string; title: string; total: number } & Record<LogSeverity, number>;

/**
 * Buckets aligned to `bucketMs` across the whole range. Counts are floored into their bucket on
 * the client too, so the chart stays right if the server ever returns unaligned bucket starts.
 */
export function histogramRows(
  histogram: LogHistogramResponse | undefined,
  range: { startAt: number; endAt: number },
  timezone?: string,
): Row[] {
  if (!histogram) return [];
  const bucketMs = Math.max(1, histogram.bucketMs);
  const span = Math.max(1, range.endAt - range.startAt);
  const empty = (start: number) =>
    ({ t: start, total: 0, ...Object.fromEntries(LOG_SEVERITIES.map((severity) => [severity, 0])) }) as Omit<
      Row,
      'i' | 'tick' | 'title'
    >;
  const byStart = new Map<number, Omit<Row, 'i' | 'tick' | 'title'>>();
  const first = Math.floor(range.startAt / bucketMs) * bucketMs;
  for (let start = first, guard = 0; start <= range.endAt && guard < 500; start += bucketMs, guard++) {
    byStart.set(start, empty(start));
  }
  for (const bucket of histogram.buckets) {
    const start = Math.floor(bucket.t / bucketMs) * bucketMs;
    let row = byStart.get(start);
    if (!row) {
      row = empty(start);
      byStart.set(start, row);
    }
    for (const severity of LOG_SEVERITIES) row[severity] += bucket[severity] ?? 0;
    row.total += bucket.total ?? 0;
  }
  let previous = '';
  return [...byStart.values()]
    .sort((a, b) => a.t - b.t)
    .map((row, i) => {
      const label = bucketTickLabel(row.t, span, timezone);
      const tick = label === previous ? '' : label;
      previous = label;
      return { ...row, i, tick, title: bucketRangeLabel(row.t, row.t + bucketMs, timezone) };
    });
}

/**
 * Log volume per time bucket, stacked by severity (status colors). The legend in the card
 * header doubles as the severity filter: clicking a severity shows only the selected ones.
 */
export function LogHistogram({
  histogram,
  range,
  selected,
  onToggle,
  timezone,
  loading = false,
  filtered = false,
}: {
  histogram: LogHistogramResponse | undefined;
  range: { startAt: number; endAt: number };
  selected: LogSeverity[];
  onToggle: (severity: LogSeverity) => void;
  timezone?: string;
  loading?: boolean;
  /** Filters are active (picks the empty-state copy). */
  filtered?: boolean;
}) {
  const chartColors = useChartColors();
  const narrow = useMediaQuery('(max-width: 640px)');
  const colors = useMemo(() => getSeverityColors(), [chartColors]);
  const rows = useMemo(() => histogramRows(histogram, range, timezone), [histogram, range, timezone]);
  const totals = useMemo(() => {
    const sums = Object.fromEntries(LOG_SEVERITIES.map((severity) => [severity, 0])) as Record<LogSeverity, number>;
    for (const row of rows) for (const severity of LOG_SEVERITIES) sums[severity] += row[severity];
    return sums;
  }, [rows]);
  const visible = LOG_SEVERITIES.filter((severity) => totals[severity] > 0 || selected.includes(severity));
  const stacked = STACK_ORDER.filter((severity) => totals[severity] > 0);
  const anyLines = stacked.length > 0;

  const legend = visible.length ? (
    <div className="q-sev-toggles" role="group" aria-label={t('logsLevel')}>
      {visible.map((severity) => {
        const active = selected.includes(severity);
        return (
          <button
            key={severity}
            type="button"
            className={cn('q-sev-toggle', active && 'is-active', selected.length > 0 && !active && 'is-dimmed')}
            aria-pressed={active}
            onClick={() => onToggle(severity)}
          >
            <span className="q-sev-key" style={{ background: `var(${SEVERITY_CHART_VARS[severity]})` }} aria-hidden />
            {severity}
            <span className="q-sev-count">{formatNumber(totals[severity], { compact: totals[severity] >= 10_000 })}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <SectionCard title={t('logsHistogram')} description={t('qualityLogVolumeLead')} actions={legend}>
      {loading && !histogram ? (
        <Skeleton className="h-[180px] w-full" />
      ) : anyLines ? (
        <div className="q-chart" aria-label={t('logsHistogram')} role="img">
          <AnalyticsChart
            Chart={BarChart}
            data={rows}
            responsive={{ height: 180 }}
            xAxis={{
              dataKey: 'i',
              ticks: bucketTicks(rows, narrow ? 4 : 8),
              interval: 0,
              tickFormatter: (index: number) => rows[index]?.tick ?? '',
            }}
            yAxis={{ ...stackedAxis(rows, stacked), width: 40 }}
            tooltip={{
              content: (
                <NonZeroTooltip
                  indicator="box"
                  labelFormatter={(_, payload) => String(payload[0]?.payload?.title ?? '')}
                />
              ),
            }}
          >
            <BarStack radius={[4, 4, 0, 0]}>
              {stacked.map((severity) => (
                <Bar key={severity} dataKey={severity} name={severity} fill={colors[severity]} {...STACK_MARK} />
              ))}
            </BarStack>
          </AnalyticsChart>
        </div>
      ) : (
        <EmptyState title={t('logsEmptyTitle')} description={filtered ? t('logsEmptyFiltered') : t('logsEmptyBody')} />
      )}
    </SectionCard>
  );
}
