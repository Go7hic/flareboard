import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Line, LineChart } from 'recharts';
import { AnalyticsChart } from './AnalyticsChart';
import { StatCard } from './ui/stat-card';
import { api, type InsightResult, type WebsiteStats } from '../lib/api';
import {
  type BoardRangePreset,
  type BoardWidget,
  type InsightWidgetConfig,
  type StatsWidgetConfig,
} from '../lib/board-config';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

type Widget = BoardWidget;

function formatChartLabel(x: string) {
  const parts = x.split('-');
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return x;
}

const compactXAxis = {
  interval: 'preserveStartEnd' as const,
  tickLine: false,
  axisLine: false,
};

const compactYAxis = {
  tickLine: false,
  axisLine: false,
  width: 40,
};

function boardWidgetClassName(widget: Widget) {
  return `board-stat-widget board-stat-widget--${widget.width ?? 'half'}`;
}

export function BoardWidgets({
  widgets,
  publicMode,
  rangePreset,
}: {
  widgets: Widget[];
  publicMode?: boolean;
  rangePreset: BoardRangePreset;
}) {
  return (
    <div className="board-widgets-grid">
      {widgets.map((w, i) => (
        <BoardWidget key={i} widget={w} publicMode={publicMode} rangePreset={rangePreset} />
      ))}
    </div>
  );
}

function BoardWidget({
  widget,
  publicMode,
  rangePreset,
}: {
  widget: Widget;
  publicMode?: boolean;
  rangePreset: BoardRangePreset;
}) {
  const chartColors = useChartColors();

  if (widget.type === 'insight') {
    return <InsightBoardWidget widget={widget} publicMode={publicMode} rangePreset={rangePreset} />;
  }

  const range = presetToRange(rangePreset);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);

  const statsQuery = useQuery({
    queryKey: ['board-widget-stats', widget.websiteId, rangePreset],
    enabled: !publicMode && widget.type === 'stats' && Boolean(widget.websiteId),
    queryFn: () =>
      api<WebsiteStats>(`/api/websites/${widget.websiteId}/stats?${rangeQs}`),
  });

  const pageviewsQuery = useQuery({
    queryKey: ['board-widget-pageviews', widget.websiteId, rangePreset],
    enabled: !publicMode && widget.type === 'stats' && Boolean(widget.websiteId),
    queryFn: () =>
      api<{ pageviews: { x: string; y: number }[] }>(
        `/api/websites/${widget.websiteId}/pageviews?unit=day&${rangeQs}`,
      ),
  });

  const stats = widget.type === 'stats' && widget.stats ? (widget.stats as WebsiteStats) : statsQuery.data;
  const series =
    widget.type === 'stats' && widget.series
      ? widget.series
      : (pageviewsQuery.data?.pageviews ?? []);
  const loading = !publicMode && (statsQuery.isLoading || pageviewsQuery.isLoading);
  const chartData = series.map((p) => ({ x: formatChartLabel(p.x), y: p.y }));

  return (
    <section className={boardWidgetClassName(widget)}>
      <h3 className="board-stat-widget-title">{widget.label?.trim() || t('boardWidgetStats')}</h3>
      {loading ? (
        <div className="board-stat-widget-skeleton" aria-busy>
          <div className="skeleton" style={{ height: '2.5rem' }} />
          <div className="skeleton skeleton-block" style={{ height: '4.5rem' }} />
        </div>
      ) : null}
      {!loading && stats ? (
        <>
          <div className="board-stat-widget-kpis">
            <StatCard label={t('pageviews')} value={formatNumber(stats.pageviews.value)} variant="primary" size="secondary" />
            <StatCard label={t('visitors')} value={formatNumber(stats.visitors.value)} size="secondary" />
            <StatCard label={t('visits')} value={formatNumber(stats.visits.value)} size="secondary" />
          </div>
          <div className="board-stat-widget-chart">
            {chartData.length > 0 ? (
              <AnalyticsChart
                Chart={LineChart}
                data={chartData}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                responsive={{ width: '100%', height: '100%' }}
                xAxis={{ dataKey: 'x', tick: { fontSize: 10 }, ...compactXAxis }}
                yAxis={{ allowDecimals: false, tick: { fontSize: 10 }, ...compactYAxis }}
              >
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke={chartColors.accent}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </AnalyticsChart>
            ) : (
              <p className="text-muted board-stat-widget-empty">{t('noDataInPeriod')}</p>
            )}
          </div>
          <p className="text-muted board-stat-widget-period">{t(`boardWidgetPeriod${rangePreset}`)}</p>
        </>
      ) : null}
    </section>
  );
}

function InsightBoardWidget({
  widget,
  publicMode,
  rangePreset,
}: {
  widget: InsightWidgetConfig;
  publicMode?: boolean;
  rangePreset: BoardRangePreset;
}) {
  const chartColors = useChartColors();
  const range = presetToRange(rangePreset);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const insightQuery = useQuery({
    queryKey: ['board-widget-insight', widget.insightId, rangePreset],
    enabled: !publicMode && Boolean(widget.insightId),
    queryFn: () => api<{ data: InsightResult }>(`/api/insights/${widget.insightId}/run?${rangeQs}`),
  });
  const result = (widget.result as InsightResult | undefined) ?? insightQuery.data?.data;
  const loading = !publicMode && insightQuery.isLoading;

  return (
    <section className={boardWidgetClassName(widget)}>
      <h3 className="board-stat-widget-title">{widget.label?.trim() || t('insight')}</h3>
      {loading ? <div className="skeleton skeleton-block" aria-busy /> : null}
      {!loading && result ? (
        <div className="board-stat-widget-chart">
          {result.kind === 'trend' ? (
            <AnalyticsChart
              Chart={LineChart}
              data={result.series.map((point) => ({ x: formatChartLabel(point.x), y: point.y }))}
              responsive={{ width: '100%', height: '100%' }}
              xAxis={{ dataKey: 'x', tick: { fontSize: 10 }, ...compactXAxis }}
              yAxis={{ allowDecimals: false, tick: { fontSize: 10 }, ...compactYAxis }}
            >
              <Line type="monotone" dataKey="y" stroke={chartColors.accent} strokeWidth={2} dot={false} />
            </AnalyticsChart>
          ) : result.kind === 'funnel' ? (
            <AnalyticsChart
              Chart={BarChart}
              data={result.steps.map((step) => ({ x: step.step, y: step.count }))}
              layout="vertical"
              responsive={{ width: '100%', height: '100%' }}
              grid={{ horizontal: false }}
              xAxis={{ type: 'number', tick: { fontSize: 10 } }}
              yAxis={{ type: 'category', dataKey: 'x', width: 80, tick: { fontSize: 10 } }}
            >
              <Bar dataKey="y" fill={chartColors.accent} radius={[0, 4, 4, 0]} />
            </AnalyticsChart>
          ) : result.kind === 'table' ? (
            <ul className="list-plain">
              {result.rows.slice(0, 5).map((row) => (
                <li key={row.x} className="list-item list-row">
                  <span>{row.x}</span>
                  <span className="list-row-value">{formatNumber(row.y)}</span>
                </li>
              ))}
            </ul>
          ) : result.kind === 'path' ? (
            <ul className="list-plain">
              {result.next.slice(0, 5).map((row) => (
                <li key={row.path} className="list-item list-row">
                  <span>{row.path}</span>
                  <span className="list-row-value">{formatNumber(row.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted board-stat-widget-empty">{t('boardInsightSummary')}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
