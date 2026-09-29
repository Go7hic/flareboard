import { useMemo } from 'react';
import { Bar, BarChart, Legend, Line, LineChart, ReferenceLine } from 'recharts';
import { formatDayBucketLabel } from '@flareboard/shared/timezone';
import type {
  FunnelResult,
  InsightResult,
  LifecycleResult,
  RetentionResult,
  TrendResult,
  TrendResultSeries,
} from '@flareboard/shared/insight-query';
import { AnalyticsChart } from './AnalyticsChart';
import { EmptyState } from './EmptyState';
import { Button } from './ui/button';
import { chartSeriesColor } from '../lib/chart-colors';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

const MAX_CHART_LINES = 12;

/** Bucket labels come back in the site's calendar: `YYYY-MM-DD HH:00`, `YYYY-MM-DD` or `YYYY-MM`. */
export function formatBucketLabel(label: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(label)) return `${formatDayBucketLabel(label.slice(0, 10))} ${label.slice(11)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return formatDayBucketLabel(label);
  return label;
}

/** `3d 4h`, `12m`, `40s`. */
export function formatDurationShort(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function breakdownLabel(value: string | null | undefined, isOther?: boolean) {
  if (isOther) return t('insightBreakdownOther');
  if (value === null) return t('insightBreakdownNone');
  return value ?? '';
}

function mathLabel(math: TrendResultSeries['math']) {
  return math ? t(`insightMath_${math}`) : '';
}

function lineName(result: TrendResultSeries, formula: string | null) {
  const head = result.key === 'formula' ? `${t('insightFormula')}: ${formula ?? result.label}` : `${result.key} · ${result.label}`;
  const withMath = result.key === 'formula' || result.math === 'total' ? head : `${head} (${mathLabel(result.math)})`;
  if (result.breakdownValue === undefined && !result.isOther) return withMath;
  return `${withMath} · ${breakdownLabel(result.breakdownValue, result.isOther)}`;
}

function TrendView({ result, compact }: { result: TrendResult; compact?: boolean }) {
  const colors = useChartColors();
  // With a formula, chart the formula lines only; the underlying series stay in the table.
  const charted = useMemo(
    () => (result.formula ? result.results.filter((r) => r.key === 'formula') : result.results).slice(0, MAX_CHART_LINES),
    [result],
  );
  const data = useMemo(
    () =>
      result.labels.map((label, i) => {
        const row: Record<string, number | string> = { x: formatBucketLabel(label) };
        charted.forEach((line, j) => {
          row[`s${j}`] = line.data[i] ?? 0;
          const previous = result.compare?.results.find(
            (c) => c.key === line.key && c.breakdownValue === line.breakdownValue && Boolean(c.isOther) === Boolean(line.isOther),
          );
          if (previous) row[`c${j}`] = previous.data[i] ?? 0;
        });
        return row;
      }),
    [result, charted],
  );

  if (!result.labels.length) return <EmptyState title={t('noDataInPeriod')} />;

  return (
    <>
      <div className={compact ? 'board-stat-widget-chart' : 'chart-wrap chart-wrap-compact'}>
        <AnalyticsChart
          Chart={LineChart}
          data={data}
          margin={{ left: 8, right: 16, top: 8 }}
          responsive={compact ? { width: '100%', height: '100%' } : undefined}
          xAxis={{ dataKey: 'x', minTickGap: 16 }}
          yAxis={{ allowDecimals: true }}
        >
          {charted.map((line, j) => {
            const stroke = colors.palette[j % colors.palette.length] || colors.accent;
            return [
              <Line
                key={`s${j}`}
                type="monotone"
                dataKey={`s${j}`}
                name={lineName(line, result.formula)}
                stroke={stroke}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />,
              result.compare ? (
                <Line
                  key={`c${j}`}
                  type="monotone"
                  dataKey={`c${j}`}
                  name={`${lineName(line, result.formula)} (${t('insightPreviousPeriod')})`}
                  stroke={stroke}
                  strokeOpacity={0.45}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null,
            ];
          })}
        </AnalyticsChart>
      </div>
      {compact ? null : (
        <div className="table-scroll">
          <table className="data-table insight-result-table">
            <thead>
              <tr>
                <th>{t('insightSeries')}</th>
                <th className="num">{t('insightTotal')}</th>
                {result.compare ? <th className="num">{t('insightPreviousPeriod')}</th> : null}
                {result.compare ? <th className="num">{t('insightChange')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {result.results.map((line, j) => {
                const previous = result.compare?.results.find(
                  (c) => c.key === line.key && c.breakdownValue === line.breakdownValue && Boolean(c.isOther) === Boolean(line.isOther),
                );
                const index = charted.indexOf(line);
                return (
                  <tr key={`${line.key}-${line.breakdownValue ?? ''}-${line.isOther ? 1 : 0}-${j}`}>
                    <td>
                      <span className="insight-legend-item">
                        {index >= 0 ? (
                          <span className="insight-legend-swatch" style={{ background: chartSeriesColor(index) }} aria-hidden />
                        ) : null}
                        {lineName(line, result.formula)}
                      </span>
                    </td>
                    <td className="num">{formatNumber(line.total, { maximumFractionDigits: 2 })}</td>
                    {result.compare ? (
                      <td className="num">{previous ? formatNumber(previous.total, { maximumFractionDigits: 2 }) : '-'}</td>
                    ) : null}
                    {result.compare ? (
                      <td className="num">
                        {previous && previous.total !== 0
                          ? formatPercent(((line.total - previous.total) / Math.abs(previous.total)) * 100, { signed: true, digits: 1 })
                          : '-'}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export type FunnelDrill = { step: number; outcome: 'converted' | 'dropped'; breakdownValue?: string | null; breakdownOther?: boolean };

function FunnelView({
  result,
  compact,
  onDrill,
}: {
  result: FunnelResult;
  compact?: boolean;
  onDrill?: (drill: FunnelDrill) => void;
}) {
  const colors = useChartColors();
  if (!result.steps.length) return <EmptyState title={t('insightFunnelNoSteps')} />;
  const data = result.steps.map((step) => ({ name: `${step.index + 1}. ${step.label}`, count: step.count }));

  return (
    <>
      <div className={compact ? 'board-stat-widget-chart' : 'chart-wrap chart-wrap-compact'}>
        <AnalyticsChart
          Chart={BarChart}
          data={data}
          layout="vertical"
          margin={{ left: 8, right: 16 }}
          responsive={compact ? { width: '100%', height: '100%' } : undefined}
          grid={{ horizontal: false }}
          xAxis={{ type: 'number' }}
          yAxis={{ type: 'category', dataKey: 'name', width: compact ? 80 : 140 }}
        >
          <Bar dataKey="count" name={t('insightFunnelUnits')} fill={colors.palette[0] || colors.accent} radius={[0, 4, 4, 0]} />
        </AnalyticsChart>
      </div>
      <p className="text-muted">
        {t('overallConversion')}: {formatPercent(result.conversion, { digits: 1 })}
      </p>
      {compact ? null : (
        <div className="table-scroll">
          <table className="data-table insight-result-table">
            <thead>
              <tr>
                <th>{t('insightStep')}</th>
                <th className="num">{result.countBy === 'person' ? t('insightCountPeople') : t('insightCountSessions')}</th>
                <th className="num">{t('insightStepConversion')}</th>
                <th className="num">{t('insightDroppedOff')}</th>
                <th className="num">{t('insightAvgTimeToConvert')}</th>
                <th className="num">{t('insightMedianTimeToConvert')}</th>
                {onDrill ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {result.steps.map((step) => (
                <tr key={step.index}>
                  <td>
                    {step.index + 1}. {step.label}
                  </td>
                  <td className="num">{formatNumber(step.count)}</td>
                  <td className="num">
                    {formatPercent(step.rate, { digits: 1 })} · {formatPercent(step.conversionRate, { digits: 1 })}
                  </td>
                  <td className="num">{step.index === 0 ? '-' : formatNumber(step.droppedOff)}</td>
                  <td className="num">{formatDurationShort(step.avgTimeToConvertMs)}</td>
                  <td className="num">{formatDurationShort(step.medianTimeToConvertMs)}</td>
                  {onDrill ? (
                    <td className="insight-drill-cell">
                      <Button type="button" variant="ghost" size="sm" onClick={() => onDrill({ step: step.index, outcome: 'converted' })}>
                        {t('insightConverted')}
                      </Button>
                      {step.index > 0 ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => onDrill({ step: step.index, outcome: 'dropped' })}>
                          {t('insightDroppedOff')}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && result.breakdown?.length ? (
        <div className="table-scroll">
          <table className="data-table insight-result-table">
            <thead>
              <tr>
                <th>{t('insightBreakdown')}</th>
                {result.steps.map((step) => (
                  <th key={step.index} className="num">
                    {step.index + 1}. {step.label}
                  </th>
                ))}
                <th className="num">{t('overallConversion')}</th>
              </tr>
            </thead>
            <tbody>
              {result.breakdown.map((group) => (
                <tr key={`${group.value ?? ''}-${group.isOther ? 1 : 0}`}>
                  <td>{breakdownLabel(group.value, group.isOther)}</td>
                  {group.steps.map((step) => (
                    <td key={step.index} className="num">
                      {onDrill ? (
                        <button
                          type="button"
                          className="insight-drill-link"
                          onClick={() =>
                            onDrill({
                              step: step.index,
                              outcome: 'converted',
                              breakdownValue: group.value,
                              breakdownOther: group.isOther,
                            })
                          }
                        >
                          {formatNumber(step.count)}
                        </button>
                      ) : (
                        formatNumber(step.count)
                      )}
                    </td>
                  ))}
                  <td className="num">{formatPercent(group.conversion, { digits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function retentionCellColor(ratio: number): string {
  const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return `color-mix(in srgb, var(--chart-1) ${pct}%, var(--bg-subtle))`;
}

function RetentionView({ result, compact }: { result: RetentionResult; compact?: boolean }) {
  const rows = compact ? result.cohorts.slice(-5) : result.cohorts;
  const periods = Array.from({ length: result.periods }, (_, i) => i);
  if (!result.cohorts.some((c) => c.size > 0)) return <EmptyState title={t('noDataInPeriod')} />;
  return (
    <div className="table-scroll">
      <table className="data-table retention-heatmap">
        <thead>
          <tr>
            <th>{t('insightCohort')}</th>
            <th className="num">{result.countBy === 'person' ? t('insightCountPeople') : t('insightCountSessions')}</th>
            {periods.map((p) => (
              <th key={p} className="num">
                {t(`insightPeriodShort_${result.period}`).replace('{n}', String(p))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cohort) => (
            <tr key={cohort.cohort}>
              <td className="retention-heatmap-week">{formatBucketLabel(cohort.cohort)}</td>
              <td className="num">{formatNumber(cohort.size)}</td>
              {periods.map((p) => {
                if (p >= cohort.values.length) return <td key={p} className="num" />;
                const ratio = cohort.size > 0 ? (cohort.values[p] ?? 0) / cohort.size : 0;
                return (
                  <td
                    key={p}
                    className="num retention-heatmap-cell"
                    style={{ background: cohort.size > 0 ? retentionCellColor(ratio) : undefined }}
                    title={`${formatNumber(cohort.values[p])} / ${formatNumber(cohort.size)}`}
                  >
                    {cohort.size > 0 ? formatPercent(ratio * 100, { digits: p === 0 ? 0 : 1 }) : '-'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LIFECYCLE_KEYS = ['new', 'returning', 'resurrecting', 'dormant'] as const;

function LifecycleView({ result, compact }: { result: LifecycleResult; compact?: boolean }) {
  const colors = useChartColors();
  const data = result.labels.map((label, i) => ({
    x: formatBucketLabel(label),
    new: result.new[i] ?? 0,
    returning: result.returning[i] ?? 0,
    resurrecting: result.resurrecting[i] ?? 0,
    dormant: result.dormant[i] ?? 0,
  }));
  return (
    <div className={compact ? 'board-stat-widget-chart' : 'chart-wrap chart-wrap-compact'}>
      <AnalyticsChart
        Chart={BarChart}
        data={data}
        margin={{ left: 8, right: 16, top: 8 }}
        responsive={compact ? { width: '100%', height: '100%' } : undefined}
        xAxis={{ dataKey: 'x', minTickGap: 16 }}
      >
        <ReferenceLine y={0} stroke={colors.border} />
        {compact ? null : <Legend wrapperStyle={{ fontSize: 12 }} />}
        {LIFECYCLE_KEYS.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={t(`insightLifecycle_${key}`)}
            stackId="lifecycle"
            fill={colors.palette[i] || colors.accent}
            isAnimationActive={false}
          />
        ))}
      </AnalyticsChart>
    </div>
  );
}

/** Renders any insight result. `compact` is for board widgets (chart only, no tables). */
export function InsightResultView({
  result,
  compact,
  onFunnelDrill,
}: {
  result: InsightResult;
  compact?: boolean;
  onFunnelDrill?: (drill: FunnelDrill) => void;
}) {
  const colors = useChartColors();

  if (result.kind === 'trend') return <TrendView result={result} compact={compact} />;
  if (result.kind === 'funnel') return <FunnelView result={result} compact={compact} onDrill={onFunnelDrill} />;
  if (result.kind === 'retention') return <RetentionView result={result} compact={compact} />;
  if (result.kind === 'lifecycle') return <LifecycleView result={result} compact={compact} />;

  if (result.kind === 'stickiness') {
    const rows = result.distribution.map((row) => ({ name: `${row.activeDays}d`, actors: row.actors }));
    return (
      <>
        <div className={compact ? 'board-stat-widget-chart' : 'chart-wrap chart-wrap-compact'}>
          <AnalyticsChart
            Chart={BarChart}
            data={rows}
            margin={{ left: 8, right: 16 }}
            responsive={compact ? { width: '100%', height: '100%' } : undefined}
            xAxis={{ dataKey: 'name' }}
          >
            <Bar dataKey="actors" name={t('stickinessActors')} fill={colors.palette[0] || colors.accent} radius={[4, 4, 0, 0]} />
          </AnalyticsChart>
        </div>
        {compact ? null : (
          <p className="text-muted">
            {t('stickinessAverageDays')}: {formatNumber(result.averageActiveDays, { maximumFractionDigits: 2 })} ·{' '}
            {t('stickinessActors')}: {formatNumber(result.totalActors)}
          </p>
        )}
      </>
    );
  }

  const rows =
    result.kind === 'path'
      ? result.next.map((row) => ({ x: row.path, y: row.count }))
      : result.rows.map((row) => ({ x: row.x, y: row.y }));
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>{result.kind === 'path' ? t('page') : t('value')}</th>
            <th className="num">{result.kind === 'path' ? t('visits') : t('events')}</th>
          </tr>
        </thead>
        <tbody>
          {(compact ? rows.slice(0, 5) : rows).map((row) => (
            <tr key={row.x}>
              <td>{row.x}</td>
              <td className="num">{formatNumber(row.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
