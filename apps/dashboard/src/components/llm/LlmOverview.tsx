import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, Line, LineChart } from 'recharts';
import { AnalyticsChart } from '../AnalyticsChart';
import { EmptyState } from '../EmptyState';
import { StatCard } from '../ui/stat-card';
import { type AiObservabilityResponse } from '../../lib/api';
import { chartSeriesColor } from '../../lib/chart-colors';
import { formatDateTime, formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useChartColors } from '../../lib/useChartColors';
import { formatBucket, formatMs, formatUsd } from './llm-format';

type Stats = AiObservabilityResponse['stats'];
type TrendRow = Stats['trend'][number];

const HOUR = 60 * 60 * 1000;

function nextBucket(bucket: string, unit: 'hour' | 'day') {
  if (unit === 'hour') return new Date(Date.parse(bucket) + HOUR).toISOString().replace('.000Z', 'Z');
  const date = new Date(`${bucket}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Continuous buckets between the first and last with data, so gaps read as zero. */
function fillTrend(rows: TrendRow[], unit: 'hour' | 'day'): TrendRow[] {
  if (rows.length < 2) return rows;
  const byBucket = new Map(rows.map((row) => [row.date, row]));
  const out: TrendRow[] = [];
  const last = rows[rows.length - 1]!.date;
  for (let bucket = rows[0]!.date, guard = 0; bucket <= last && guard < 2000; bucket = nextBucket(bucket, unit), guard++) {
    out.push(
      byBucket.get(bucket) ?? {
        date: bucket,
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
      },
    );
  }
  return out;
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="llm-legend">
      {items.map((item) => (
        <span key={item.label} className="llm-legend-item">
          <span className="llm-legend-swatch" style={{ background: item.color }} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChartPanel({ title, legend, children }: { title: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel llm-chart-panel">
      <header className="compact-panel-header">
        <h3 className="section-title">{title}</h3>
        {legend}
      </header>
      <div className="chart-wrap chart-wrap-compact">{children}</div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ key: string; calls: number; detail: string }> }) {
  const max = Math.max(1, ...rows.map((row) => row.calls));
  if (!rows.length) return null;
  return (
    <div className="detail-section">
      <h3 className="section-title">{title}</h3>
      <div className="breakdown-list">
        {rows.map((row) => (
          <div key={row.key} className="breakdown-row">
            <div className="breakdown-meta">
              <strong>{row.key}</strong>
              <span className="text-muted">{row.detail}</span>
            </div>
            <div className="breakdown-track" aria-hidden>
              <span style={{ width: `${Math.round((row.calls / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LlmOverview({
  websiteId,
  stats,
  events,
}: {
  websiteId: string;
  stats: Stats | undefined;
  events: AiObservabilityResponse['events'];
}) {
  const colors = useChartColors();
  const unit = stats?.unit ?? 'day';
  const trend = useMemo(
    () =>
      fillTrend(stats?.trend ?? [], unit).map((row) => ({
        ...row,
        label: formatBucket(row.date, unit),
      })),
    [stats?.trend, unit],
  );

  if (!stats) return null;
  if (!stats.calls) {
    return (
      <EmptyState title={t('aiEmptyTitle')} description={t('aiSetupBody')}>
        <p className="text-muted">{t('aiEmptyBody')}</p>
      </EmptyState>
    );
  }

  const palette = colors.palette;
  const series = (index: number) => palette[index] || colors.accent;

  return (
    <>
      <section className="analytics-hero-stats section-gap" aria-label={t('aiTabOverview')}>
        <StatCard
          label={t('aiCost')}
          value={formatUsd(stats.costUsd)}
          hint={stats.unpricedCalls ? `${t('aiUnpriced')}: ${formatNumber(stats.unpricedCalls)}` : undefined}
        />
        <StatCard label={t('aiGenerations')} value={formatNumber(stats.calls)} hint={`${t('aiTracesCount')}: ${formatNumber(stats.traces)}`} />
        <StatCard
          label={t('aiTokens')}
          value={formatNumber(stats.tokens, { compact: true })}
          hint={`${formatNumber(stats.inputTokens, { compact: true })} / ${formatNumber(stats.outputTokens, { compact: true })}`}
        />
        <StatCard label={t('aiP50Latency')} value={formatMs(stats.p50LatencyMs)} hint={`${t('aiP95Latency')}: ${formatMs(stats.p95LatencyMs)}`} />
        <StatCard label={t('aiErrorRate')} value={`${formatNumber(stats.errorRate)}%`} hint={`${t('aiErrors')}: ${formatNumber(stats.errors)}`} />
        <StatCard label={t('aiUsersCount')} value={formatNumber(stats.users)} />
      </section>

      {stats.unpricedCalls ? (
        <p className="text-muted section-gap">{t('aiUnpricedHint').replace('{count}', formatNumber(stats.unpricedCalls))}</p>
      ) : null}

      <section className="llm-chart-grid section-gap">
        <ChartPanel title={t('aiCostOverTime')}>
          <AnalyticsChart
            Chart={BarChart}
            data={trend}
            margin={{ left: 8, right: 16 }}
            xAxis={{ dataKey: 'label' }}
            yAxis={{ allowDecimals: true, tickFormatter: (value: number) => formatUsd(value) }}
            tooltip={{ formatter: (value) => formatUsd(Number(value)) }}
          >
            <Bar dataKey="costUsd" name={t('aiCost')} fill={series(0)} radius={[3, 3, 0, 0]} />
          </AnalyticsChart>
        </ChartPanel>
        <ChartPanel
          title={t('aiCallsOverTime')}
          legend={
            <Legend
              items={[
                { label: t('aiGenerations'), color: chartSeriesColor(1) },
                { label: t('aiErrors'), color: chartSeriesColor(4) },
              ]}
            />
          }
        >
          <AnalyticsChart Chart={BarChart} data={trend} margin={{ left: 8, right: 16 }} xAxis={{ dataKey: 'label' }}>
            <Bar dataKey="calls" name={t('aiGenerations')} fill={series(1)} radius={[3, 3, 0, 0]} />
            <Bar dataKey="errors" name={t('aiErrors')} fill={series(4)} radius={[3, 3, 0, 0]} />
          </AnalyticsChart>
        </ChartPanel>
        <ChartPanel
          title={t('aiLatencyOverTime')}
          legend={
            <Legend
              items={[
                { label: 'p50', color: chartSeriesColor(2) },
                { label: 'p95', color: chartSeriesColor(3) },
              ]}
            />
          }
        >
          <AnalyticsChart
            Chart={LineChart}
            data={trend}
            margin={{ left: 8, right: 16 }}
            xAxis={{ dataKey: 'label' }}
            yAxis={{ tickFormatter: (value: number) => formatMs(value) }}
            tooltip={{ formatter: (value) => formatMs(Number(value)) }}
          >
            <Line type="monotone" dataKey="p50LatencyMs" name="p50" stroke={series(2)} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="p95LatencyMs" name="p95" stroke={series(3)} strokeWidth={2} dot={false} connectNulls />
          </AnalyticsChart>
        </ChartPanel>
      </section>

      <section className="section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('aiModels')}</h2>
            <p className="text-muted">{t('aiModelsLead')}</p>
          </div>
        </header>
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
                  <td>{row.provider ?? '—'}</td>
                  <td className="num">{formatNumber(row.calls)}</td>
                  <td className="num">{formatNumber(row.inputTokens)}</td>
                  <td className="num">{formatNumber(row.outputTokens)}</td>
                  <td className="num">
                    {row.unpricedCalls && !row.costUsd ? (
                      <span className="badge">{t('aiUnpriced')}</span>
                    ) : (
                      <span title={row.priceSource ? t(`aiPriceSource_${row.priceSource}`) : undefined}>{formatUsd(row.costUsd)}</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(row.errorRate)}%</td>
                  <td className="num">{formatMs(row.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel section-gap llm-breakdowns">
        <Breakdown
          title={t('aiProviderBreakdown')}
          rows={stats.providers.map((row) => ({ key: row.provider, calls: row.calls, detail: `${formatNumber(row.calls)} · ${formatUsd(row.costUsd)}` }))}
        />
        <Breakdown
          title={t('aiQualityBreakdown')}
          rows={stats.qualities
            .filter((row) => row.quality !== 'unknown')
            .map((row) => ({ key: row.quality, calls: row.calls, detail: formatNumber(row.calls) }))}
        />
        <Breakdown
          title={t('aiReleaseBreakdown')}
          rows={stats.releases
            .filter((row) => row.release !== 'unknown')
            .map((row) => ({ key: row.release, calls: row.calls, detail: `${formatNumber(row.calls)} · ${formatUsd(row.costUsd)}` }))}
        />
        <Breakdown
          title={t('aiEnvironmentBreakdown')}
          rows={stats.environments
            .filter((row) => row.environment !== 'unknown')
            .map((row) => ({ key: row.environment, calls: row.calls, detail: `${formatNumber(row.calls)} · ${formatUsd(row.costUsd)}` }))}
        />
      </section>

      <section className="section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('aiRecentCalls')}</h2>
            <p className="text-muted">{t('aiRecentCallsLead')}</p>
          </div>
        </header>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('created')}</th>
                <th>{t('aiModel')}</th>
                <th className="num">{t('aiTokens')}</th>
                <th className="num">{t('aiCost')}</th>
                <th className="num">{t('aiLatency')}</th>
                <th>{t('status')}</th>
                <th>{t('aiTraceName')}</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 25).map((event) => (
                <tr key={event.id}>
                  <td className="text-muted">{formatDateTime(event.createdAt)}</td>
                  <td className="mono">{event.model ?? t('unknown')}</td>
                  <td className="num">{formatNumber(event.totalTokens)}</td>
                  <td className="num">{event.costUsd == null ? <span className="badge">{t('aiUnpriced')}</span> : formatUsd(event.costUsd)}</td>
                  <td className="num">{formatMs(event.latencyMs)}</td>
                  <td>
                    <span className={`badge ${event.status === 'error' ? 'log-level-error' : ''}`}>{event.status ?? 'success'}</span>
                  </td>
                  <td>
                    <Link
                      className="inline-link mono"
                      to={`/websites/${websiteId}/ai-observability/traces/${encodeURIComponent(event.traceId)}?at=${event.createdAt}`}
                    >
                      {event.traceId.slice(0, 12)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
