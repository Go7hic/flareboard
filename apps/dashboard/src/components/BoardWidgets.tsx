import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type WebsiteStats } from '../lib/api';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';

const BOARD_WIDGET_DAYS = 7;

export type StatsWidgetConfig = {
  type: 'stats';
  websiteId: string;
  label?: string;
  stats?: WebsiteStats;
  series?: { x: string; y: number }[];
};

export type StatsWidgetDraft = {
  type: 'stats';
  websiteId: string;
  label: string;
};

export type BoardWidget =
  | StatsWidgetConfig
  | { type: 'title'; text: string };

type Widget = BoardWidget;

function formatChartLabel(x: string) {
  const parts = x.split('-');
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return x;
}

export function emptyStatsWidgetDraft(): StatsWidgetDraft {
  return { type: 'stats', websiteId: '', label: '' };
}

export function statsWidgetsToDrafts(widgets: StatsWidgetConfig[]): StatsWidgetDraft[] {
  return widgets.map((w) => ({
    type: 'stats',
    websiteId: w.websiteId,
    label: w.label ?? '',
  }));
}

export function draftsToBoardParameters(drafts: StatsWidgetDraft[]): Record<string, unknown> {
  return {
    widgets: drafts
      .filter((d) => d.websiteId)
      .map((d) => ({
        type: 'stats' as const,
        websiteId: d.websiteId,
        ...(d.label.trim() ? { label: d.label.trim() } : {}),
      })),
  };
}

export function BoardWidgets({ widgets, publicMode }: { widgets: Widget[]; publicMode?: boolean }) {
  return (
    <div className="board-widgets-grid">
      {widgets.map((w, i) => (
        <BoardWidget key={i} widget={w} publicMode={publicMode} />
      ))}
    </div>
  );
}

function BoardWidget({ widget, publicMode }: { widget: Widget; publicMode?: boolean }) {
  const chartColors = useChartColors();

  if (widget.type === 'title') {
    return (
      <section className="board-widget-title">
        <h2 className="section-title">{widget.text}</h2>
      </section>
    );
  }

  const range = presetToRange('7d');
  const rangeQs = rangeQueryString(range.startAt, range.endAt);

  const statsQuery = useQuery({
    queryKey: ['board-widget-stats', widget.websiteId, BOARD_WIDGET_DAYS],
    enabled: !publicMode && widget.type === 'stats' && Boolean(widget.websiteId),
    queryFn: () =>
      api<WebsiteStats>(`/api/websites/${widget.websiteId}/stats?${rangeQs}`),
  });

  const pageviewsQuery = useQuery({
    queryKey: ['board-widget-pageviews', widget.websiteId, BOARD_WIDGET_DAYS],
    enabled: !publicMode && widget.type === 'stats' && Boolean(widget.websiteId),
    queryFn: () =>
      api<{ pageviews: { x: string; y: number }[] }>(
        `/api/websites/${widget.websiteId}/pageviews?unit=day&${rangeQs}`,
      ),
  });

  const stats =
    widget.type === 'stats' && widget.stats ? widget.stats : statsQuery.data;
  const series =
    widget.type === 'stats' && widget.series
      ? widget.series
      : (pageviewsQuery.data?.pageviews ?? []);
  const loading = !publicMode && (statsQuery.isLoading || pageviewsQuery.isLoading);
  const chartData = series.map((p) => ({ x: formatChartLabel(p.x), y: p.y }));

  return (
    <section className="board-stat-widget">
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
            <div className="stat-card stat-card-primary">
              <div className="stat-label">{t('pageviews')}</div>
              <div className="stat-value">{stats.pageviews.value.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('visitors')}</div>
              <div className="stat-value">{stats.visitors.value.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('visits')}</div>
              <div className="stat-value">{stats.visits.value.toLocaleString()}</div>
            </div>
          </div>
          <div className="board-stat-widget-chart">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartColors.border}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="x"
                    tick={{ fontSize: 10, fill: chartColors.muted }}
                    stroke={chartColors.border}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    width={32}
                    tick={{ fontSize: 10, fill: chartColors.muted }}
                    stroke={chartColors.border}
                  />
                  <Tooltip
                    contentStyle={{
                      background: chartColors.panel,
                      border: `1px solid ${chartColors.border}`,
                      borderRadius: 8,
                      fontSize: 12,
                      color: chartColors.text,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="y"
                    stroke={chartColors.accent}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted board-stat-widget-empty">{t('noDataInPeriod')}</p>
            )}
          </div>
          <p className="text-muted board-stat-widget-period">{t('boardWidgetPeriod7d')}</p>
        </>
      ) : null}
    </section>
  );
}

export function parseBoardWidgets(parameters: Record<string, unknown>): StatsWidgetConfig[] {
  const raw = parameters.widgets;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (w): w is StatsWidgetConfig =>
      typeof w === 'object' &&
      w !== null &&
      (w as BoardWidget).type === 'stats' &&
      typeof (w as { websiteId?: string }).websiteId === 'string',
  );
}
