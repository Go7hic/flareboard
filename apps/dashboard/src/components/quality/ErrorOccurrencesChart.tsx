import { useMemo } from 'react';
import { Bar, BarChart, BarStack } from 'recharts';
import { AnalyticsChart } from '../AnalyticsChart';
import { ChartTooltipContent } from '../ChartTooltipContent';
import { ChartLegend } from '../ChartLegend';
import { EmptyState } from '../EmptyState';
import { SectionCard } from '../SectionCard';
import type { ErrorEventsResponse, ErrorIssue } from '../../lib/api';
import { getSeverityColors, SEVERITY_CHART_VARS, type LogSeverity } from '../../lib/chart-colors';
import { BAR_MARK, STACK_MARK } from '../../lib/chartMarks';
import { formatShortDate } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useChartColors } from '../../lib/useChartColors';
import { bucketRangeLabel, bucketTickLabel, bucketTicks } from './chartParts';
import { useMediaQuery } from './useMediaQuery';

/** Error severities as the tracker sends them, most severe first (also the stack order, bottom up). */
export const ERROR_SEVERITIES = ['fatal', 'error', 'warning', 'info'] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

/** Log severity token that colors each error severity (status colors, not the categorical palette). */
const SEVERITY_TOKEN: Record<ErrorSeverity, LogSeverity> = {
  fatal: 'fatal',
  error: 'error',
  warning: 'warn',
  info: 'info',
};

export function errorSeverity(value: string | null | undefined): ErrorSeverity {
  const severity = (value ?? 'error').toLowerCase();
  if (severity === 'fatal' || severity === 'critical') return 'fatal';
  if (severity === 'warning' || severity === 'warn') return 'warning';
  if (severity === 'info' || severity === 'debug' || severity === 'log') return 'info';
  return 'error';
}

export function severityVar(severity: ErrorSeverity) {
  return `var(${SEVERITY_CHART_VARS[SEVERITY_TOKEN[severity]]})`;
}

type SliceRow = { i: number; tick: string; title: string } & Record<ErrorSeverity, number>;
type DayRow = { i: number; tick: string; title: string; total: number };

const DAY = 86_400_000;

function utcDates(startAt: number, endAt: number) {
  const out: string[] = [];
  const first = new Date(startAt);
  let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  for (let guard = 0; cursor <= endAt && guard < 400; cursor += DAY, guard++) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Occurrences over the range. Each listed issue carries its counts in equal slices of the range;
 * when the listed issues add up to the total (the list is not cut at 25), those slices give a
 * finer series stacked by severity. Otherwise the daily totals from the stats are used.
 */
export function buildOccurrences(
  issues: ErrorIssue[],
  stats: ErrorEventsResponse['stats'],
  range: { startAt: number; endAt: number },
  timeZone?: string,
): { mode: 'slices'; rows: SliceRow[]; present: ErrorSeverity[] } | { mode: 'daily'; rows: DayRow[] } {
  const sliceTotal = issues.reduce((sum, issue) => sum + issue.trend.reduce((a, b) => a + b, 0), 0);
  const slices = issues[0]?.trend.length ?? 0;
  if (issues.length && slices > 1 && sliceTotal === stats.errors) {
    const span = Math.max(1, range.endAt - range.startAt);
    const step = span / slices;
    let previousTick = '';
    const rows: SliceRow[] = Array.from({ length: slices }, (_, i) => {
      const start = range.startAt + i * step;
      const label = bucketTickLabel(start, span, timeZone);
      const tick = label === previousTick ? '' : label;
      previousTick = label;
      return { i, tick, title: bucketRangeLabel(start, start + step, timeZone), fatal: 0, error: 0, warning: 0, info: 0 };
    });
    for (const issue of issues) {
      const severity = errorSeverity(issue.severity);
      issue.trend.forEach((value, index) => {
        const row = rows[index];
        if (row) row[severity] += value;
      });
    }
    const present = ERROR_SEVERITIES.filter((severity) => rows.some((row) => row[severity] > 0));
    return { mode: 'slices', rows, present: present.length ? present : ['error'] };
  }
  const byDate = new Map(stats.trend.map((row) => [row.date, row.errors]));
  const rows: DayRow[] = utcDates(range.startAt, range.endAt).map((date, i) => {
    const label = formatShortDate(`${date}T00:00:00Z`, { timeZone: 'UTC' });
    return { i, tick: label, title: label, total: byDate.get(date) ?? 0 };
  });
  return { mode: 'daily', rows };
}

/** "Occurrences" card of the errors page: bars per bucket, stacked by severity when known. */
export function ErrorOccurrencesChart({
  issues,
  stats,
  range,
  timezone,
}: {
  issues: ErrorIssue[];
  stats: ErrorEventsResponse['stats'];
  range: { startAt: number; endAt: number };
  timezone?: string;
}) {
  const chartColors = useChartColors();
  const narrow = useMediaQuery('(max-width: 640px)');
  const severityColors = useMemo(() => getSeverityColors(), [chartColors]);
  const series = useMemo(() => buildOccurrences(issues, stats, range, timezone), [issues, stats, range, timezone]);
  const titleFor = (payload: readonly { payload?: Record<string, unknown> }[]) => String(payload[0]?.payload?.title ?? '');

  const legend =
    series.mode === 'slices' ? (
      <ChartLegend
        items={series.present.map((severity) => ({ label: severity, color: severityVar(severity), shape: 'box' as const }))}
      />
    ) : null;

  return (
    <SectionCard
      title={t('qualityOccurrences')}
      description={series.mode === 'daily' ? t('qualityOccurrencesDailyLead') : undefined}
      actions={legend}
    >
      {stats.errors === 0 ? (
        <EmptyState title={t('errorsEmptyTitle')} description={t('errorsEmptyBody')} />
      ) : (
        <div className="q-chart">
          {series.mode === 'slices' ? (
            <AnalyticsChart
              Chart={BarChart}
              data={series.rows}
              responsive={{ height: 200 }}
              xAxis={{
                dataKey: 'i',
                ticks: bucketTicks(series.rows, narrow ? 4 : 8),
                interval: 0,
                tickFormatter: (index: number) => series.rows[index]?.tick ?? '',
              }}
              yAxis={{ width: 36 }}
              tooltip={{ content: <ChartTooltipContent hideZero indicator="box" labelFormatter={(_, payload) => titleFor(payload)} /> }}
            >
              <BarStack radius={[4, 4, 0, 0]}>
                {series.present.map((severity) => (
                  <Bar
                    key={severity}
                    dataKey={severity}
                    name={severity}
                    fill={severityColors[SEVERITY_TOKEN[severity]]}
                    {...STACK_MARK}
                  />
                ))}
              </BarStack>
            </AnalyticsChart>
          ) : (
            <AnalyticsChart
              Chart={BarChart}
              data={series.rows}
              responsive={{ height: 200 }}
              xAxis={{
                dataKey: 'i',
                ticks: bucketTicks(series.rows, narrow ? 4 : 8),
                interval: 0,
                tickFormatter: (index: number) => series.rows[index]?.tick ?? '',
              }}
              yAxis={{ width: 36 }}
              tooltip={{ labelFormatter: (_: unknown, payload: readonly { payload?: Record<string, unknown> }[]) => titleFor(payload) }}
            >
              <Bar dataKey="total" name={t('qualityOccurrences')} fill={chartColors.accent} {...BAR_MARK} />
            </AnalyticsChart>
          )}
        </div>
      )}
    </SectionCard>
  );
}
