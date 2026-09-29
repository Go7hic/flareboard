import { useMemo } from 'react';
import { Bar, BarChart } from 'recharts';
import { AnalyticsChart } from '../AnalyticsChart';
import { getSeverityColors, LOG_SEVERITIES, SEVERITY_CHART_VARS } from '../../lib/chart-colors';
import type { LogHistogramResponse, LogSeverity } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { getLocale, t } from '../../lib/i18n';
import { useChartColors } from '../../lib/useChartColors';

const DAY_MS = 86_400_000;

function bucketLabel(t: number, bucketMs: number, timezone?: string) {
  const date = new Date(t);
  if (bucketMs >= DAY_MS) {
    return date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: timezone });
  }
  return date.toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    ...(bucketMs < 60_000 ? { second: '2-digit' as const } : {}),
    timeZone: timezone,
  });
}

/**
 * Log volume per time bucket, stacked by severity. The legend doubles as the severity filter:
 * clicking a severity shows only the selected ones.
 */
export function LogHistogram({
  histogram,
  selected,
  onToggle,
  timezone,
}: {
  histogram: LogHistogramResponse | undefined;
  selected: LogSeverity[];
  onToggle: (severity: LogSeverity) => void;
  timezone?: string;
}) {
  // Subscribes to theme changes, so the resolved severity colors follow light/dark.
  useChartColors();
  const colors = getSeverityColors();
  const data = useMemo(
    () =>
      (histogram?.buckets ?? []).map((bucket) => ({
        ...bucket,
        label: bucketLabel(bucket.t, histogram?.bucketMs ?? 60_000, timezone),
      })),
    [histogram, timezone],
  );
  const totals = useMemo(() => {
    const sums = Object.fromEntries(LOG_SEVERITIES.map((severity) => [severity, 0])) as Record<LogSeverity, number>;
    for (const bucket of histogram?.buckets ?? []) for (const severity of LOG_SEVERITIES) sums[severity] += bucket[severity];
    return sums;
  }, [histogram]);
  const visible = LOG_SEVERITIES.filter((severity) => totals[severity] > 0 || selected.includes(severity));

  return (
    <div className="logs-histogram">
      <div className="logs-histogram-chart" aria-label={t('logsHistogram')} role="img">
        <AnalyticsChart
          Chart={BarChart}
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          xAxis={{ dataKey: 'label', minTickGap: 24 }}
          yAxis={{ width: 40 }}
          responsive={{ height: 160 }}
        >
          {LOG_SEVERITIES.map((severity) => (
            <Bar key={severity} dataKey={severity} name={severity} stackId="severity" fill={colors[severity]} isAnimationActive={false} />
          ))}
        </AnalyticsChart>
      </div>
      <div className="logs-histogram-legend" role="group" aria-label={t('logsLevel')}>
        {visible.map((severity) => {
          const active = selected.includes(severity);
          return (
            <button
              key={severity}
              type="button"
              className={`logs-legend-item${active ? ' is-active' : ''}${selected.length && !active ? ' is-dimmed' : ''}`}
              aria-pressed={active}
              onClick={() => onToggle(severity)}
            >
              <span className="logs-legend-swatch" style={{ background: `var(${SEVERITY_CHART_VARS[severity]})` }} aria-hidden />
              <span>{severity}</span>
              <span className="text-muted">{formatNumber(totals[severity])}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
