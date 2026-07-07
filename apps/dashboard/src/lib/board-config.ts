import type { DateRangePreset } from './dateRange';

export type BoardRangePreset = Exclude<DateRangePreset, 'custom'>;
export type BoardWidgetWidth = 'third' | 'half' | 'full';

export type StatsWidgetConfig = {
  type: 'stats';
  websiteId: string;
  label?: string;
  width?: BoardWidgetWidth;
  stats?: unknown;
  series?: { x: string; y: number }[];
};

export type InsightWidgetConfig = {
  type: 'insight';
  insightId: string;
  label?: string;
  width?: BoardWidgetWidth;
  result?: unknown;
};

export type BoardWidget = StatsWidgetConfig | InsightWidgetConfig;

export type StatsWidgetDraft = {
  type: 'stats';
  websiteId: string;
  label: string;
  width: BoardWidgetWidth;
};

export type InsightWidgetDraft = {
  type: 'insight';
  insightId: string;
  label: string;
  width: BoardWidgetWidth;
};

export type BoardWidgetDraft = StatsWidgetDraft | InsightWidgetDraft;

export type BoardConfig = {
  rangePreset: BoardRangePreset;
  widgets: BoardWidget[];
};

const BOARD_RANGE_PRESETS = new Set<BoardRangePreset>(['24h', '7d', '30d', '90d']);
const BOARD_WIDGET_WIDTHS = new Set<BoardWidgetWidth>(['third', 'half', 'full']);

export const DEFAULT_BOARD_RANGE_PRESET: BoardRangePreset = '7d';
export const DEFAULT_BOARD_WIDGET_WIDTH: BoardWidgetWidth = 'half';

export function normalizeBoardRangePreset(value: unknown): BoardRangePreset {
  return typeof value === 'string' && BOARD_RANGE_PRESETS.has(value as BoardRangePreset)
    ? (value as BoardRangePreset)
    : DEFAULT_BOARD_RANGE_PRESET;
}

export function normalizeBoardWidgetWidth(value: unknown): BoardWidgetWidth {
  return typeof value === 'string' && BOARD_WIDGET_WIDTHS.has(value as BoardWidgetWidth)
    ? (value as BoardWidgetWidth)
    : DEFAULT_BOARD_WIDGET_WIDTH;
}

export function emptyStatsWidgetDraft(): StatsWidgetDraft {
  return { type: 'stats', websiteId: '', label: '', width: DEFAULT_BOARD_WIDGET_WIDTH };
}

export function emptyInsightWidgetDraft(): InsightWidgetDraft {
  return { type: 'insight', insightId: '', label: '', width: DEFAULT_BOARD_WIDGET_WIDTH };
}

export function boardConfigToDrafts(config: BoardConfig): BoardWidgetDraft[] {
  return config.widgets.map((w) =>
    w.type === 'stats'
      ? { type: 'stats', websiteId: w.websiteId, label: w.label ?? '', width: normalizeBoardWidgetWidth(w.width) }
      : { type: 'insight', insightId: w.insightId, label: w.label ?? '', width: normalizeBoardWidgetWidth(w.width) },
  );
}

export function createBoardParameters(
  drafts: BoardWidgetDraft[],
  rangePreset: BoardRangePreset = DEFAULT_BOARD_RANGE_PRESET,
): Record<string, unknown> {
  return {
    rangePreset,
    widgets: drafts
      .filter((d) => (d.type === 'stats' ? d.websiteId : d.insightId))
      .map((d) =>
        d.type === 'stats'
          ? {
              type: 'stats' as const,
              websiteId: d.websiteId,
              ...(d.label.trim() ? { label: d.label.trim() } : {}),
              width: normalizeBoardWidgetWidth(d.width),
            }
          : {
              type: 'insight' as const,
              insightId: d.insightId,
              ...(d.label.trim() ? { label: d.label.trim() } : {}),
              width: normalizeBoardWidgetWidth(d.width),
            },
      ),
  };
}

export function parseBoardConfig(parameters: Record<string, unknown>): BoardConfig {
  const rawWidgets = parameters.widgets;
  const widgets = Array.isArray(rawWidgets)
    ? rawWidgets
        .map((w): BoardWidget | null => {
          if (typeof w !== 'object' || w === null) return null;
          const row = w as {
            type?: string;
            websiteId?: unknown;
            insightId?: unknown;
            label?: unknown;
            width?: unknown;
            stats?: unknown;
            series?: unknown;
            result?: unknown;
          };
          const label = typeof row.label === 'string' ? row.label : undefined;
          const width = normalizeBoardWidgetWidth(row.width);
          if (row.type === 'stats' && typeof row.websiteId === 'string') {
            return {
              type: 'stats',
              websiteId: row.websiteId,
              ...(label ? { label } : {}),
              width,
              ...(row.stats ? { stats: row.stats } : {}),
              ...(Array.isArray(row.series) ? { series: row.series as { x: string; y: number }[] } : {}),
            };
          }
          if (row.type === 'insight' && typeof row.insightId === 'string') {
            return {
              type: 'insight',
              insightId: row.insightId,
              ...(label ? { label } : {}),
              width,
              ...(row.result ? { result: row.result } : {}),
            };
          }
          return null;
        })
        .filter((w): w is BoardWidget => Boolean(w))
    : [];

  return {
    rangePreset: normalizeBoardRangePreset(parameters.rangePreset),
    widgets,
  };
}
