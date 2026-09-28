import { useQuery } from '@tanstack/react-query';
import { Line, LineChart } from 'recharts';
import { AnalyticsChart } from './AnalyticsChart';
import { InsightResultView } from './InsightResultView';
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
import { formatChartTimeLabel, isHourlyChartRange } from '../lib/chartTimeseries';

type Widget = BoardWidget;

const compactXAxis = {
  interval: 'preserveStartEnd' as const,
  tickLine: false,
  axisLine: false,
};

const compactYAxis = {
  tickLine: false,
  axisLine: false,
  width: 44,
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
        // Type in the key: a slot that switches stats <-> insight must remount (different hooks).
        <BoardWidget
          key={`${w.type}:${w.type === 'stats' ? w.websiteId : w.insightId}:${i}`}
          widget={w}
          publicMode={publicMode}
          rangePreset={rangePreset}
        />
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
  if (widget.type === 'insight') {
    return <InsightBoardWidget widget={widget} publicMode={publicMode} rangePreset={rangePreset} />;
  }
  return <StatsBoardWidget widget={widget} publicMode={publicMode} rangePreset={rangePreset} />;
}

function StatsBoardWidget({
  widget,
  publicMode,
  rangePreset,
}: {
  widget: StatsWidgetConfig;
  publicMode?: boolean;
  rangePreset: BoardRangePreset;
}) {
  const chartColors = useChartColors();
  const range = presetToRange(rangePreset);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  // A 24h board needs hourly points; daily buckets gave one or two dots.
  const hourly = isHourlyChartRange(range.startAt, range.endAt);

  const statsQuery = useQuery({
    queryKey: ['board-widget-stats', widget.websiteId, rangePreset],
    enabled: !publicMode && Boolean(widget.websiteId),
    queryFn: () =>
      api<WebsiteStats>(`/api/websites/${widget.websiteId}/stats?${rangeQs}`),
  });

  const pageviewsQuery = useQuery({
    queryKey: ['board-widget-pageviews', widget.websiteId, rangePreset],
    enabled: !publicMode && Boolean(widget.websiteId),
    queryFn: () =>
      api<{ pageviews: { x: string; y: number }[] }>(
        `/api/websites/${widget.websiteId}/pageviews?unit=${hourly ? 'hour' : 'day'}&${rangeQs}`,
      ),
  });

  const stats = widget.stats ? (widget.stats as WebsiteStats) : statsQuery.data;
  const series = widget.series ?? pageviewsQuery.data?.pageviews ?? [];
  const loading = !publicMode && (statsQuery.isLoading || pageviewsQuery.isLoading);
  const chartData = series.map((p) => ({ x: formatChartTimeLabel(p.x, hourly), y: p.y }));

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
                margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                responsive={{ width: '100%', height: '100%' }}
                xAxis={{ dataKey: 'x', tick: { fontSize: 11 }, ...compactXAxis }}
                yAxis={{ allowDecimals: false, tick: { fontSize: 11 }, ...compactYAxis }}
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
        <div className="board-insight-widget-body">
          <InsightResultView result={result} compact />
        </div>
      ) : null}
    </section>
  );
}
