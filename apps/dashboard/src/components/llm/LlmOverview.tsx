import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, BarStack, Line, LineChart } from 'recharts';
import { Sparkles } from 'lucide-react';
import { AnalyticsChart } from '../AnalyticsChart';
import { BreakdownList, type BreakdownItem } from '../BreakdownList';
import { ChartLegend } from '../ChartLegend';
import { EmptyState } from '../EmptyState';
import { KpiCell, KpiStrip } from '../KpiStrip';
import { SectionCard } from '../SectionCard';
import { StatusBadge } from '../StatusBadge';
import { bucketTicks, NonZeroTooltip, stackedAxis } from '../quality/chartParts';
import { RelativeTime } from '../quality/RelativeTime';
import { useMediaQuery } from '../quality/useMediaQuery';
import { type AiObservabilityResponse } from '../../lib/api';
import { getSeverityColors } from '../../lib/chart-colors';
import { BAR_MARK, lineMark, STACK_MARK } from '../../lib/chartMarks';
import { formatNumber, formatPercent } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useChartColors } from '../../lib/useChartColors';
import { formatBucket, formatMs, formatMsTick, formatUsd, formatUsdTick } from './llm-format';

type Stats = AiObservabilityResponse['stats'];
type TrendRow = Stats['trend'][number];

const HOUR = 60 * 60 * 1000;

function emptyRow(date: string): TrendRow {
  return {
    date,
    calls: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    unpricedCalls: 0,
    errors: 0,
    errorRate: 0,
    avgLatencyMs: null,
    sessions: 0,
    p50LatencyMs: null,
    p95LatencyMs: null,
  };
}

/** Site-local calendar date (YYYY-MM-DD) of a timestamp. */
function localDate(ms: number, timeZone: string) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}

function nextDate(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Every bucket of the selected range, so quiet hours read as zero and the bars spread over the
 * whole period instead of only the stretch that had calls. Hours are ISO UTC, days site-local.
 */
export function fillTrend(rows: TrendRow[], unit: 'hour' | 'day', range: { startAt: number; endAt: number }, timeZone: string) {
  const byBucket = new Map(rows.map((row) => [row.date, row]));
  const out: TrendRow[] = [];
  if (unit === 'hour') {
    const first = Math.floor(range.startAt / HOUR) * HOUR;
    for (let at = first, guard = 0; at <= range.endAt && guard < 2000; at += HOUR, guard++) {
      const bucket = new Date(at).toISOString().replace('.000Z', 'Z');
      out.push(byBucket.get(bucket) ?? emptyRow(bucket));
    }
  } else {
    const last = localDate(range.endAt, timeZone);
    for (let date = localDate(range.startAt, timeZone), guard = 0; date <= last && guard < 400; date = nextDate(date), guard++) {
      out.push(byBucket.get(date) ?? emptyRow(date));
    }
  }
  // Buckets the range walk did not produce (should not happen) are kept, in order.
  const seen = new Set(out.map((row) => row.date));
  for (const row of rows) if (!seen.has(row.date)) out.push(row);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

type Dimension = 'provider' | 'release' | 'environment' | 'quality';

/**
 * Latency lines break where an hour had no calls (no value, not zero). A value with empty
 * neighbours would then draw nothing, so it gets a small dot instead.
 */
function isolatedDot(rows: Array<Record<string, unknown>>, key: string, color: string) {
  return function IsolatedDot(props: { cx?: number; cy?: number; index?: number }) {
    const index = props.index ?? -1;
    const has = (i: number) => rows[i]?.[key] != null;
    if (props.cx == null || props.cy == null || !has(index) || has(index - 1) || has(index + 1)) {
      return <g key={`${key}-${index}`} />;
    }
    return <circle key={`${key}-${index}`} cx={props.cx} cy={props.cy} r={2.5} fill={color} />;
  };
}

export function LlmOverview({
  websiteId,
  stats,
  events,
  range,
  timezone,
}: {
  websiteId: string;
  stats: Stats | undefined;
  events: AiObservabilityResponse['events'];
  range: { startAt: number; endAt: number };
  timezone: string;
}) {
  const colors = useChartColors();
  const narrow = useMediaQuery('(max-width: 640px)');
  const navigate = useNavigate();
  const severityColors = useMemo(() => getSeverityColors(), [colors]);
  const [dimension, setDimension] = useState<Dimension>('provider');
  const unit = stats?.unit ?? 'day';
  const trend = useMemo(() => {
    let previous = '';
    return fillTrend(stats?.trend ?? [], unit, range, timezone).map((row, i) => {
      const label = formatBucket(row.date, unit);
      const tick = label === previous ? '' : label;
      previous = label;
      return { ...row, i, tick, title: label, successes: Math.max(0, row.calls - row.errors) };
    });
  }, [stats?.trend, unit, range, timezone]);
  const ticks = useMemo(() => bucketTicks(trend, narrow ? 4 : 8), [trend, narrow]);

  if (!stats) return null;
  if (!stats.calls) {
    return <EmptyState variant="rich" icon={<Sparkles />} title={t('aiEmptyTitle')} description={t('aiSetupBody')} />;
  }

  const series = (index: number) => colors.palette[index] || colors.accent;
  const xAxis = {
    dataKey: 'i',
    ticks,
    interval: 0 as const,
    tickFormatter: (index: number) => trend[index]?.tick ?? '',
  };
  const titleFor = (payload: readonly { payload?: Record<string, unknown> }[]) => String(payload[0]?.payload?.title ?? '');

  const maxModelCost = Math.max(0, ...stats.models.map((row) => row.costUsd));
  const costByModel: BreakdownItem[] = [...stats.models]
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
    .slice(0, 8)
    .map((row) => ({
      id: row.model,
      label: row.model,
      title: row.model,
      mono: true,
      share: maxModelCost ? row.costUsd / maxModelCost : 0,
      values: [row.unpricedCalls && !row.costUsd ? t('aiUnpriced') : formatUsd(row.costUsd), formatNumber(row.calls)],
    }));

  const dimensionRows: Record<Dimension, Array<{ key: string; calls: number; cost?: number }>> = {
    provider: stats.providers.map((row) => ({ key: row.provider, calls: row.calls, cost: row.costUsd })),
    release: stats.releases.filter((row) => row.release !== 'unknown').map((row) => ({ key: row.release, calls: row.calls, cost: row.costUsd })),
    environment: stats.environments
      .filter((row) => row.environment !== 'unknown')
      .map((row) => ({ key: row.environment, calls: row.calls, cost: row.costUsd })),
    quality: stats.qualities.filter((row) => row.quality !== 'unknown').map((row) => ({ key: row.quality, calls: row.calls })),
  };
  const dimensionLabels: Record<Dimension, string> = {
    provider: t('aiProvider'),
    release: t('release'),
    environment: t('environment'),
    quality: t('aiQuality'),
  };
  const dimensions = (Object.keys(dimensionRows) as Dimension[]).filter((key) => dimensionRows[key].length > 0);
  const activeDimension = dimensions.includes(dimension) ? dimension : (dimensions[0] ?? 'provider');
  const activeRows = dimensionRows[activeDimension];
  const maxCalls = Math.max(1, ...activeRows.map((row) => row.calls));

  return (
    <>
      <KpiStrip columns={6}>
        <KpiCell
          label={t('aiCost')}
          value={formatUsd(stats.costUsd)}
          hint={stats.unpricedCalls ? `${t('aiUnpriced')}: ${formatNumber(stats.unpricedCalls)}` : undefined}
        />
        <KpiCell
          label={t('aiGenerations')}
          value={formatNumber(stats.calls)}
          hint={`${t('aiTracesCount')} ${formatNumber(stats.traces)}`}
        />
        <KpiCell
          label={t('aiTokens')}
          value={formatNumber(stats.tokens, { compact: stats.tokens >= 10_000 })}
          title={formatNumber(stats.tokens)}
          hint={t('qualityTokensInOut')
            .replace('{input}', formatNumber(stats.inputTokens, { compact: true }))
            .replace('{output}', formatNumber(stats.outputTokens, { compact: true }))}
        />
        <KpiCell label={t('aiP50Latency')} value={formatMs(stats.p50LatencyMs)} hint={`p95 ${formatMs(stats.p95LatencyMs)}`} />
        <KpiCell
          label={t('aiErrorRate')}
          value={formatPercent(stats.errorRate, { digits: stats.errorRate > 0 && stats.errorRate < 10 ? 1 : 0 })}
          hint={`${t('aiErrors')} ${formatNumber(stats.errors)}`}
        />
        <KpiCell label={t('aiUsersCount')} value={formatNumber(stats.users)} hint={t('qualitySessionsCount').replace('{count}', formatNumber(stats.sessions))} />
      </KpiStrip>

      {stats.unpricedCalls ? (
        <p className="q-view-only">{t('aiUnpricedHint').replace('{count}', formatNumber(stats.unpricedCalls))}</p>
      ) : null}

      <div className="layout-grid layout-grid--stretch">
        <SectionCard className="span-6" title={t('aiCost')} description={formatUsd(stats.costUsd)}>
          <div className="q-chart">
            <AnalyticsChart
              Chart={BarChart}
              data={trend}
              responsive={{ height: 200 }}
              xAxis={xAxis}
              yAxis={{ width: 52, allowDecimals: true }}
              valueFormatter={formatUsdTick}
              tooltip={{
                formatter: (value) => formatUsd(Number(value)),
                labelFormatter: (_: unknown, payload: readonly { payload?: Record<string, unknown> }[]) => titleFor(payload),
              }}
            >
              <Bar dataKey="costUsd" name={t('aiCost')} fill={series(0)} {...BAR_MARK} />
            </AnalyticsChart>
          </div>
        </SectionCard>

        <SectionCard
          className="span-6"
          title={t('aiCallsOverTime')}
          description={`${formatNumber(stats.calls)} · ${t('aiErrors')} ${formatNumber(stats.errors)}`}
          actions={
            <ChartLegend
              items={[
                { label: t('qualitySucceeded'), color: 'var(--chart-1)', shape: 'box' },
                { label: t('aiErrors'), color: 'var(--chart-severity-error)', shape: 'box' },
              ]}
            />
          }
        >
          <div className="q-chart">
            <AnalyticsChart
              Chart={BarChart}
              data={trend}
              responsive={{ height: 200 }}
              xAxis={xAxis}
              yAxis={{ ...stackedAxis(trend, ['successes', 'errors']), width: 40 }}
              tooltip={{
                content: <NonZeroTooltip indicator="box" labelFormatter={(_, payload) => titleFor(payload)} />,
              }}
            >
              <BarStack radius={[4, 4, 0, 0]}>
                <Bar dataKey="errors" name={t('aiErrors')} fill={severityColors.error} {...STACK_MARK} />
                <Bar dataKey="successes" name={t('qualitySucceeded')} fill={series(0)} {...STACK_MARK} />
              </BarStack>
            </AnalyticsChart>
          </div>
        </SectionCard>

        <SectionCard
          className="span-6"
          title={t('aiLatencyOverTime')}
          description={`p50 ${formatMs(stats.p50LatencyMs)} · p95 ${formatMs(stats.p95LatencyMs)}`}
          actions={
            <ChartLegend
              items={[
                { label: 'p50', color: 'var(--chart-1)' },
                { label: 'p95', color: 'var(--chart-2)' },
              ]}
            />
          }
        >
          <div className="q-chart">
            <AnalyticsChart
              Chart={LineChart}
              data={trend}
              responsive={{ height: 200 }}
              margin={{ top: 8, right: 20, bottom: 0, left: 0 }}
              xAxis={xAxis}
              yAxis={{ width: 52 }}
              valueFormatter={formatMsTick}
              tooltip={{
                formatter: (value) => formatMs(Number(value)),
                labelFormatter: (_: unknown, payload: readonly { payload?: Record<string, unknown> }[]) => titleFor(payload),
              }}
            >
              <Line
                dataKey="p50LatencyMs"
                name="p50"
                stroke={series(0)}
                {...lineMark(colors.panel)}
                dot={isolatedDot(trend, 'p50LatencyMs', series(0))}
              />
              <Line
                dataKey="p95LatencyMs"
                name="p95"
                stroke={series(1)}
                {...lineMark(colors.panel)}
                dot={isolatedDot(trend, 'p95LatencyMs', series(1))}
              />
            </AnalyticsChart>
          </div>
        </SectionCard>

        <SectionCard className="span-6" title={t('qualityCostByModel')}>
          <BreakdownList items={costByModel} labelHeader={t('aiModel')} columns={[{ label: t('aiCost') }, { label: t('aiGenerations') }]} />
        </SectionCard>
      </div>

      <SectionCard flush title={t('aiModels')} description={t('aiModelsLead')}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('aiModel')}</th>
                <th>{t('aiProvider')}</th>
                <th className="num">{t('aiGenerations')}</th>
                <th className="num">{t('aiInputTokens')}</th>
                <th className="num">{t('aiOutputTokens')}</th>
                <th className="num">{t('aiCost')}</th>
                <th className="num">{t('aiErrorRate')}</th>
                <th className="num">{t('aiAvgLatency')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.models.map((row) => (
                <tr key={row.model}>
                  <td className="mono">{row.model}</td>
                  <td className="q-col-muted">{row.provider ?? '—'}</td>
                  <td className="num">{formatNumber(row.calls)}</td>
                  <td className="num">{formatNumber(row.inputTokens)}</td>
                  <td className="num">{formatNumber(row.outputTokens)}</td>
                  <td className="num">
                    {row.unpricedCalls && !row.costUsd ? (
                      <StatusBadge tone="warning" dot={false}>
                        {t('aiUnpriced')}
                      </StatusBadge>
                    ) : (
                      <span title={row.priceSource ? t(`aiPriceSource_${row.priceSource}`) : undefined}>{formatUsd(row.costUsd)}</span>
                    )}
                  </td>
                  <td className="num">{formatPercent(row.errorRate, { digits: row.errorRate > 0 && row.errorRate < 10 ? 1 : 0 })}</td>
                  <td className="num">{formatMs(row.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {dimensions.length ? (
        <SectionCard
          title={t('qualityBreakdown')}
          actions={
            dimensions.length > 1 ? (
              <div className="segmented" role="tablist" aria-label={t('qualityBreakdown')}>
                {dimensions.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={key === activeDimension}
                    onClick={() => setDimension(key)}
                  >
                    {dimensionLabels[key]}
                  </button>
                ))}
              </div>
            ) : null
          }
        >
          <BreakdownList
            labelHeader={dimensionLabels[activeDimension]}
            columns={activeDimension === 'quality' ? [{ label: t('aiGenerations') }] : [{ label: t('aiGenerations') }, { label: t('aiCost') }]}
            items={activeRows.map((row) => ({
              id: row.key,
              label: row.key,
              title: row.key,
              share: row.calls / maxCalls,
              values: row.cost === undefined ? [formatNumber(row.calls)] : [formatNumber(row.calls), formatUsd(row.cost)],
            }))}
          />
        </SectionCard>
      ) : null}

      <SectionCard flush title={t('aiRecentCalls')} description={t('aiRecentCallsLead')}>
        <div className="table-scroll">
          <table className="data-table data-table--interactive">
            <thead>
              <tr>
                <th>{t('when')}</th>
                <th>{t('aiModel')}</th>
                <th className="num">{t('aiTokens')}</th>
                <th className="num">{t('aiCost')}</th>
                <th className="num">{t('aiLatency')}</th>
                <th>{t('status')}</th>
                <th>{t('aiTraceName')}</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 25).map((event) => {
                const href = `/websites/${websiteId}/ai-observability/traces/${encodeURIComponent(event.traceId)}?at=${event.createdAt}`;
                const failed = event.status === 'error';
                return (
                  <tr key={event.id} onClick={() => navigate(href)}>
                    <td className="q-col-when">
                      <RelativeTime value={event.createdAt} />
                    </td>
                    <td className="mono">{event.model ?? t('unknown')}</td>
                    <td className="num">{formatNumber(event.totalTokens)}</td>
                    <td className="num">
                      {event.costUsd == null ? (
                        <StatusBadge tone="warning" dot={false}>
                          {t('aiUnpriced')}
                        </StatusBadge>
                      ) : (
                        formatUsd(event.costUsd)
                      )}
                    </td>
                    <td className="num">{formatMs(event.latencyMs)}</td>
                    <td>
                      <StatusBadge tone={failed ? 'danger' : 'success'}>{event.status ?? 'success'}</StatusBadge>
                    </td>
                    <td>
                      <Link className="q-id-link" to={href} onClick={(clickEvent) => clickEvent.stopPropagation()}>
                        {event.traceId.slice(0, 12)}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}
