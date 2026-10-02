import { useMemo, type CSSProperties } from 'react';
import { Area, Bar, BarChart, ComposedChart, LabelList, Line, ReferenceLine } from 'recharts';
import { formatDayBucketLabel } from '@flareboard/shared/timezone';
import type {
  FunnelResult,
  InsightResult,
  LifecycleResult,
  RetentionResult,
  StickinessResult,
  TrendResult,
  TrendResultSeries,
} from '@flareboard/shared/insight-query';
import { AnalyticsChart } from './AnalyticsChart';
import { BreakdownList, type BreakdownItem } from './BreakdownList';
import { ChartLegend, type ChartLegendItem } from './ChartLegend';
import { EmptyState } from './EmptyState';
import { KpiCell, KpiStrip } from './KpiStrip';
import { StatChangeDelta } from './StatChangeDelta';
import { Button } from './ui/button';
import { areaMark, BAR_MARK, HBAR_MARK, lineMark, previousLineMark, STACK_MARK } from '../lib/chartMarks';
import { chartSeriesColor } from '../lib/chart-colors';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

/** Spec: never more than six series in one chart; the rest stay in the table. */
const MAX_CHART_LINES = 6;
/** Headline cells above a trend (one per charted series) only while they stay readable. */
const MAX_KPI_CELLS = 4;

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

function previousOf(result: TrendResult, line: TrendResultSeries) {
  return result.compare?.results.find(
    (c) => c.key === line.key && c.breakdownValue === line.breakdownValue && Boolean(c.isOther) === Boolean(line.isOther),
  );
}

function changeOf(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0 || !Number.isFinite(previous)) return undefined;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Bars where negative values stack below zero (lifecycle "dormant"). */
/** Category axis wide enough for the step labels (approximate glyph widths), within bounds. */
function categoryAxisWidth(labels: string[], compact?: boolean) {
  const longest = labels.reduce((max, label) => {
    let width = 0;
    for (const char of label) width += char.charCodeAt(0) > 0x2e80 ? 12 : 6.6;
    return Math.max(max, width);
  }, 0);
  return Math.round(Math.min(compact ? 160 : 220, Math.max(72, longest + 14)));
}

const valueFormatter = (value: number) =>
  formatNumber(value, { maximumFractionDigits: 2, compact: Math.abs(value) >= 10_000 });

function LegendRow({ items }: { items: ChartLegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="ws-result-legend">
      <ChartLegend items={items} />
    </div>
  );
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
          const previous = previousOf(result, line);
          if (previous) row[`c${j}`] = previous.data[i] ?? 0;
        });
        return row;
      }),
    [result, charted],
  );

  if (!result.labels.length) return <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />;

  const colorAt = (j: number) => colors.palette[j % colors.palette.length] || colors.accent;
  // A single series reads as an area (10% wash); several as plain lines.
  const asArea = charted.length === 1;
  const legend: ChartLegendItem[] = charted.map((line, j) => ({
    label: lineName(line, result.formula),
    color: chartSeriesColor(j),
  }));
  if (result.compare && charted.length) {
    legend.push({
      label: t('insightPreviousPeriod'),
      color: `color-mix(in srgb, ${chartSeriesColor(0)} 35%, transparent)`,
    });
  }

  return (
    <div className="ws-result">
      {!compact && charted.length <= MAX_KPI_CELLS ? (
        <KpiStrip inline columns={Math.max(charted.length, 1)}>
          {charted.map((line, j) => {
            const previous = previousOf(result, line);
            const change = previous ? changeOf(line.total, previous.total) : undefined;
            return (
              <KpiCell
                key={`${line.key}-${line.breakdownValue ?? ''}-${j}`}
                label={lineName(line, result.formula)}
                keyColor={chartSeriesColor(j)}
                value={formatNumber(line.total, { maximumFractionDigits: 2 })}
                delta={change === undefined ? undefined : <StatChangeDelta change={change} />}
                hint={
                  previous
                    ? `${t('insightPreviousPeriod')} ${formatNumber(previous.total, { maximumFractionDigits: 2 })}`
                    : undefined
                }
              />
            );
          })}
        </KpiStrip>
      ) : null}
      <LegendRow items={legend} />
      <div className={compact ? 'ws-result-chart ws-result-chart--compact' : 'ws-result-chart'}>
        <AnalyticsChart
          Chart={ComposedChart}
          data={data}
          responsive={{ height: compact ? '100%' : 280 }}
          xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 24 }}
          yAxis={{ allowDecimals: true }}
          valueFormatter={valueFormatter}
        >
          {charted.flatMap((line, j) => {
            const stroke = colorAt(j);
            const name = lineName(line, result.formula);
            const marks = [
              asArea ? (
                <Area key={`s${j}`} dataKey={`s${j}`} name={name} stroke={stroke} fill={stroke} {...areaMark(colors.panel)} />
              ) : (
                <Line key={`s${j}`} dataKey={`s${j}`} name={name} stroke={stroke} {...lineMark(colors.panel)} />
              ),
            ];
            if (result.compare) {
              marks.push(
                <Line
                  key={`c${j}`}
                  dataKey={`c${j}`}
                  name={`${name} (${t('insightPreviousPeriod')})`}
                  stroke={stroke}
                  {...previousLineMark(colors.panel)}
                />,
              );
            }
            return marks;
          })}
        </AnalyticsChart>
      </div>
      {compact ? null : (
        <div className="table-scroll">
          <table className="data-table ws-result-table">
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
                const previous = previousOf(result, line);
                const index = charted.indexOf(line);
                const change = previous ? changeOf(line.total, previous.total) : undefined;
                return (
                  <tr key={`${line.key}-${line.breakdownValue ?? ''}-${line.isOther ? 1 : 0}-${j}`}>
                    <td>
                      <span className="ws-series-name">
                        <span
                          className="chart-legend-key"
                          style={{ '--legend-color': index >= 0 ? chartSeriesColor(index) : 'transparent' } as CSSProperties}
                          aria-hidden
                        />
                        {lineName(line, result.formula)}
                      </span>
                    </td>
                    <td className="num">{formatNumber(line.total, { maximumFractionDigits: 2 })}</td>
                    {result.compare ? (
                      <td className="num">{previous ? formatNumber(previous.total, { maximumFractionDigits: 2 }) : '–'}</td>
                    ) : null}
                    {result.compare ? (
                      <td className="num">{change === undefined ? '–' : <StatChangeDelta change={change} />}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
  const data = result.steps.map((step) => ({
    name: `${step.index + 1}. ${step.label}`,
    count: step.count,
    rateLabel: formatPercent(step.conversionRate, { digits: step.conversionRate < 10 && step.conversionRate > 0 ? 1 : 0 }),
  }));
  const first = result.steps[0]!;
  const last = result.steps[result.steps.length - 1]!;
  const units = result.countBy === 'person' ? t('insightCountPeople') : t('insightCountSessions');
  const chartHeight = Math.max(compact ? 120 : 160, result.steps.length * (compact ? 34 : 44) + 36);

  return (
    <div className="ws-result">
      {compact ? null : (
        <KpiStrip inline columns={4}>
          <KpiCell label={t('overallConversion')} value={formatPercent(result.conversion, { digits: 1 })} />
          <KpiCell label={t('workspaceFunnelEntered')} value={formatNumber(first.count)} hint={units} />
          <KpiCell label={t('workspaceFunnelCompleted')} value={formatNumber(last.count)} hint={units} />
          <KpiCell label={t('insightMedianTimeToConvert')} value={formatDurationShort(last.medianTimeToConvertMs)} />
        </KpiStrip>
      )}
      <div className="ws-result-chart" style={{ height: compact ? undefined : chartHeight }}>
        <AnalyticsChart
          Chart={BarChart}
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 0, left: 0 }}
          responsive={{ height: chartHeight }}
          xAxis={{ type: 'number' }}
          yAxis={{ type: 'category', dataKey: 'name', width: categoryAxisWidth(data.map((row) => row.name), compact) }}
        >
          <Bar dataKey="count" name={units} fill={colors.palette[0] || colors.accent} {...HBAR_MARK}>
            <LabelList dataKey="rateLabel" position="right" fill={colors.muted} fontSize={12} />
          </Bar>
        </AnalyticsChart>
      </div>
      {compact ? (
        <p className="ws-result-note">
          {t('overallConversion')} <strong>{formatPercent(result.conversion, { digits: 1 })}</strong>
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table ws-result-table">
            <thead>
              <tr>
                <th>{t('insightStep')}</th>
                <th className="num">{units}</th>
                <th className="num">{t('workspaceFromPrevious')}</th>
                <th className="num">{t('workspaceFromFirst')}</th>
                <th className="num">{t('insightDroppedOff')}</th>
                <th className="num">{t('insightAvgTimeToConvert')}</th>
                <th className="num">{t('insightMedianTimeToConvert')}</th>
                {onDrill ? (
                  <th className="ws-row-actions">
                    <span className="visually-hidden">{t('actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {result.steps.map((step) => (
                <tr key={step.index}>
                  <td>
                    <span className="ws-step-name">
                      <span className="ws-step-index">{step.index + 1}</span>
                      {step.label}
                    </span>
                  </td>
                  <td className="num">{formatNumber(step.count)}</td>
                  <td className="num">{step.index === 0 ? '–' : formatPercent(step.rate, { digits: 1 })}</td>
                  <td className="num">{formatPercent(step.conversionRate, { digits: 1 })}</td>
                  <td className="num">{step.index === 0 ? '–' : formatNumber(step.droppedOff)}</td>
                  <td className="num">{step.index === 0 ? '–' : formatDurationShort(step.avgTimeToConvertMs)}</td>
                  <td className="num">{step.index === 0 ? '–' : formatDurationShort(step.medianTimeToConvertMs)}</td>
                  {onDrill ? (
                    <td className="ws-row-actions">
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
          <table className="data-table ws-result-table">
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
                          className="ws-drill-link"
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
    </div>
  );
}

/** Sequential single-hue scale, capped so cell text stays readable in both themes. */
function retentionCellColor(ratio: number): string {
  const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 70);
  return `color-mix(in srgb, var(--chart-1) ${pct}%, var(--bg-subtle))`;
}

/** Share of the cohorts that reached `period` and came back in it (weighted by cohort size). */
function retentionAt(result: RetentionResult, period: number): number | undefined {
  let size = 0;
  let returned = 0;
  for (const cohort of result.cohorts) {
    if (cohort.size > 0 && period < cohort.values.length) {
      size += cohort.size;
      returned += cohort.values[period] ?? 0;
    }
  }
  return size > 0 ? (returned / size) * 100 : undefined;
}

function RetentionView({ result, compact }: { result: RetentionResult; compact?: boolean }) {
  // Cohorts before the first visitor (tracking not installed yet) carry no information.
  const firstWithData = result.cohorts.findIndex((cohort) => cohort.size > 0);
  const cohorts = firstWithData > 0 ? result.cohorts.slice(firstWithData) : result.cohorts;
  const rows = compact ? cohorts.slice(-5) : cohorts;
  const periods = Array.from({ length: result.periods }, (_, i) => i);
  if (!result.cohorts.some((c) => c.size > 0)) return <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />;
  const periodLabel = (n: number) => t(`insightPeriodShort_${result.period}`).replace('{n}', String(n));
  const later = Math.min(4, result.periods - 1);
  const first = retentionAt(result, 1);
  const latest = later > 1 ? retentionAt(result, later) : undefined;
  const totalSize = result.cohorts.reduce((sum, cohort) => sum + cohort.size, 0);

  return (
    <div className="ws-result">
      {compact ? null : (
        <KpiStrip inline columns={latest === undefined ? 2 : 3}>
          <KpiCell
            label={result.countBy === 'person' ? t('insightCountPeople') : t('insightCountSessions')}
            value={formatNumber(totalSize)}
          />
          <KpiCell
            label={t('workspaceRetainedAt').replace('{period}', periodLabel(1))}
            value={first === undefined ? '–' : formatPercent(first, { digits: 1 })}
          />
          {latest === undefined ? null : (
            <KpiCell
              label={t('workspaceRetainedAt').replace('{period}', periodLabel(later))}
              value={formatPercent(latest, { digits: 1 })}
            />
          )}
        </KpiStrip>
      )}
      <div className="table-scroll">
        <table className="data-table ws-retention-table">
          <thead>
            <tr>
              <th>{t('insightCohort')}</th>
              <th className="num">{result.countBy === 'person' ? t('insightCountPeople') : t('insightCountSessions')}</th>
              {periods.map((p) => (
                <th key={p} className="num">
                  {periodLabel(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cohort) => (
              <tr key={cohort.cohort}>
                <td className="ws-nowrap">{formatBucketLabel(cohort.cohort)}</td>
                <td className="num">{formatNumber(cohort.size)}</td>
                {periods.map((p) => {
                  if (p >= cohort.values.length) return <td key={p} className="num ws-retention-cell is-empty" />;
                  const ratio = cohort.size > 0 ? (cohort.values[p] ?? 0) / cohort.size : 0;
                  return (
                    <td
                      key={p}
                      className="num ws-retention-cell"
                      style={{ background: cohort.size > 0 ? retentionCellColor(ratio) : undefined }}
                      title={`${formatNumber(cohort.values[p])} / ${formatNumber(cohort.size)}`}
                    >
                      {cohort.size > 0 ? formatPercent(ratio * 100, { digits: p === 0 ? 0 : 1 }) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  if (!data.length) return <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />;
  const sum = (values: number[]) => values.reduce((total, value) => total + Math.abs(value), 0);
  const legend: ChartLegendItem[] = LIFECYCLE_KEYS.map((key, i) => ({
    label: t(`insightLifecycle_${key}`),
    color: chartSeriesColor(i),
    shape: 'box',
  }));
  return (
    <div className="ws-result">
      {compact ? null : (
        <KpiStrip inline columns={4}>
          {LIFECYCLE_KEYS.map((key, i) => (
            <KpiCell
              key={key}
              label={t(`insightLifecycle_${key}`)}
              keyColor={chartSeriesColor(i)}
              keyShape="box"
              value={formatNumber(sum(result[key]))}
            />
          ))}
        </KpiStrip>
      )}
      <LegendRow items={legend} />
      <div className={compact ? 'ws-result-chart ws-result-chart--compact' : 'ws-result-chart'}>
        <AnalyticsChart
          Chart={BarChart}
          stackOffset="sign"
          data={data}
          responsive={{ height: compact ? '100%' : 280 }}
          xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 24 }}
        >
          <ReferenceLine y={0} stroke={colors.border} />
          {LIFECYCLE_KEYS.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              name={t(`insightLifecycle_${key}`)}
              stackId="lifecycle"
              fill={colors.palette[i] || colors.accent}
              {...STACK_MARK}
            />
          ))}
        </AnalyticsChart>
      </div>
    </div>
  );
}

function StickinessView({ result, compact }: { result: StickinessResult; compact?: boolean }) {
  const colors = useChartColors();
  const rows = result.distribution.map((row) => ({ name: `${row.activeDays}d`, actors: row.actors }));
  if (!rows.length) return <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />;
  return (
    <div className="ws-result">
      {compact ? null : (
        <KpiStrip inline columns={2}>
          <KpiCell label={t('stickinessAverageDays')} value={formatNumber(result.averageActiveDays, { maximumFractionDigits: 2 })} />
          <KpiCell label={t('stickinessActors')} value={formatNumber(result.totalActors)} />
        </KpiStrip>
      )}
      <div className={compact ? 'ws-result-chart ws-result-chart--compact' : 'ws-result-chart'}>
        <AnalyticsChart
          Chart={BarChart}
          data={rows}
          responsive={{ height: compact ? '100%' : 260 }}
          xAxis={{ dataKey: 'name' }}
        >
          <Bar dataKey="actors" name={t('stickinessActors')} fill={colors.palette[0] || colors.accent} {...BAR_MARK} />
        </AnalyticsChart>
      </div>
    </div>
  );
}

/** Renders any insight result. `compact` is for board widgets and notebooks (chart only, no tables). */
export function InsightResultView({
  result,
  compact,
  onFunnelDrill,
}: {
  result: InsightResult;
  compact?: boolean;
  onFunnelDrill?: (drill: FunnelDrill) => void;
}) {
  if (result.kind === 'trend') return <TrendView result={result} compact={compact} />;
  if (result.kind === 'funnel') return <FunnelView result={result} compact={compact} onDrill={onFunnelDrill} />;
  if (result.kind === 'retention') return <RetentionView result={result} compact={compact} />;
  if (result.kind === 'lifecycle') return <LifecycleView result={result} compact={compact} />;
  if (result.kind === 'stickiness') return <StickinessView result={result} compact={compact} />;

  const isPath = result.kind === 'path';
  const rows = isPath
    ? result.next.map((row) => ({ x: row.path, y: row.count }))
    : result.rows.map((row) => ({ x: row.x, y: row.y }));
  if (!rows.length) return <EmptyState title={t('noDataInPeriod')} description={t('noDataInPeriodHint')} />;
  const shown = compact ? rows.slice(0, 6) : rows;
  const max = Math.max(...shown.map((row) => row.y), 1);
  const items: BreakdownItem[] = shown.map((row, index) => ({
    id: `${row.x}-${index}`,
    label: row.x || '–',
    title: row.x,
    mono: row.x.startsWith('/'),
    share: row.y / max,
    values: [formatNumber(row.y)],
  }));
  return (
    <div className="ws-result">
      <BreakdownList
        items={items}
        labelHeader={isPath ? t('page') : t('value')}
        columns={[{ label: isPath ? t('visits') : t('events') }]}
      />
    </div>
  );
}
