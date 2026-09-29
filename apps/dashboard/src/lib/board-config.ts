import {
  BOARD_WIDGET_SIZES,
  normalizeBoardWidgetSize,
  parseBoardFilters,
  type BoardWidgetSize,
} from '@flareboard/shared/dashboards';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import type { DateRangePreset } from './dateRange';

export type BoardRangePreset = Exclude<DateRangePreset, 'custom'>;
/** small / medium / large / full on a 12-column grid (legacy `third` / `half` are read as small / medium). */
export type BoardWidgetWidth = BoardWidgetSize;
export { BOARD_WIDGET_SIZES };

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
  insightName?: string;
  error?: string;
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
  filters: PropertyFilter[];
  widgets: BoardWidget[];
};

export const BOARD_RANGE_PRESET_OPTIONS: BoardRangePreset[] = ['24h', '7d', '30d', '90d'];
const BOARD_RANGE_PRESETS = new Set<BoardRangePreset>(BOARD_RANGE_PRESET_OPTIONS);

export const DEFAULT_BOARD_RANGE_PRESET: BoardRangePreset = '7d';
export const DEFAULT_BOARD_WIDGET_WIDTH: BoardWidgetWidth = 'medium';

export function normalizeBoardRangePreset(value: unknown): BoardRangePreset {
  return typeof value === 'string' && BOARD_RANGE_PRESETS.has(value as BoardRangePreset)
    ? (value as BoardRangePreset)
    : DEFAULT_BOARD_RANGE_PRESET;
}

export function normalizeBoardWidgetWidth(value: unknown): BoardWidgetWidth {
  return normalizeBoardWidgetSize(value);
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

/** Saved widget config without the data a run or public share attaches. */
export function widgetToParameters(widget: BoardWidget | BoardWidgetDraft) {
  const label = widget.label?.trim();
  return widget.type === 'stats'
    ? { type: 'stats' as const, websiteId: widget.websiteId, ...(label ? { label } : {}), width: normalizeBoardWidgetWidth(widget.width) }
    : { type: 'insight' as const, insightId: widget.insightId, ...(label ? { label } : {}), width: normalizeBoardWidgetWidth(widget.width) };
}

export function createBoardParameters(
  drafts: BoardWidgetDraft[],
  rangePreset: BoardRangePreset = DEFAULT_BOARD_RANGE_PRESET,
  filters: PropertyFilter[] = [],
): Record<string, unknown> {
  return {
    rangePreset,
    filters,
    widgets: drafts.filter((d) => (d.type === 'stats' ? d.websiteId : d.insightId)).map(widgetToParameters),
  };
}

/** Parameters with a new widget order / sizes, keeping everything else saved on the board. */
export function withBoardWidgets(parameters: Record<string, unknown>, widgets: BoardWidget[]): Record<string, unknown> {
  return { ...parameters, widgets: widgets.map(widgetToParameters) };
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
            insightName?: unknown;
            error?: unknown;
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
              ...(typeof row.insightName === 'string' ? { insightName: row.insightName } : {}),
              ...(typeof row.error === 'string' ? { error: row.error } : {}),
            };
          }
          return null;
        })
        .filter((w): w is BoardWidget => Boolean(w))
    : [];

  return {
    rangePreset: normalizeBoardRangePreset(parameters.rangePreset),
    filters: parseBoardFilters(parameters),
    widgets,
  };
}

/** Moves the widget at `from` to position `to` (after removal). */
export function moveWidget<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

/**
 * Size whose width is closest to `fraction` of the grid (pointer resize snaps to it).
 * small 1/3, medium 1/2, large 2/3, full 1.
 */
export function sizeForFraction(fraction: number): BoardWidgetWidth {
  const targets: Array<[BoardWidgetWidth, number]> = [
    ['small', 4 / 12],
    ['medium', 6 / 12],
    ['large', 8 / 12],
    ['full', 1],
  ];
  let best: BoardWidgetWidth = 'medium';
  let distance = Infinity;
  for (const [size, value] of targets) {
    const d = Math.abs(value - fraction);
    if (d < distance) {
      distance = d;
      best = size;
    }
  }
  return best;
}

/** URL state of a board view: `?range=30d&filters=<json>` (unsaved overrides of the saved board). */
export function parseBoardUrlState(params: URLSearchParams): { rangePreset?: BoardRangePreset; filters?: PropertyFilter[] } {
  const state: { rangePreset?: BoardRangePreset; filters?: PropertyFilter[] } = {};
  const range = params.get('range');
  if (range && BOARD_RANGE_PRESETS.has(range as BoardRangePreset)) state.rangePreset = range as BoardRangePreset;
  const raw = params.get('filters');
  if (raw !== null) {
    try {
      state.filters = parseBoardFilters({ filters: JSON.parse(raw) as unknown });
    } catch {
      /* ignore malformed URL state */
    }
  }
  return state;
}
