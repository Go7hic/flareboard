import { useQuery } from '@tanstack/react-query';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { Line, LineChart } from 'recharts';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { AnalyticsChart } from './AnalyticsChart';
import { InsightResultView } from './InsightResultView';
import { StatCard } from './ui/stat-card';
import { api, type InsightResult, type WebsiteStats } from '../lib/api';
import {
  BOARD_WIDGET_SIZES,
  moveWidget,
  normalizeBoardWidgetWidth,
  sizeForFraction,
  type BoardRangePreset,
  type BoardWidget,
  type BoardWidgetWidth,
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

const SIZE_LABEL_KEYS: Record<BoardWidgetWidth, string> = {
  small: 'boardWidgetSizeSmall',
  medium: 'boardWidgetSizeMedium',
  large: 'boardWidgetSizeLarge',
  full: 'boardWidgetSizeFull',
};

export function boardWidgetSizeLabel(size: BoardWidgetWidth) {
  return t(SIZE_LABEL_KEYS[size]);
}

function widgetKey(widget: Widget, index: number) {
  // Type in the key: a slot that switches stats <-> insight must remount (different hooks).
  return `${widget.type}:${widget.type === 'stats' ? widget.websiteId : widget.insightId}:${index}`;
}

/**
 * Board grid. With `onLayoutChange`, widgets can be reordered (drag the grip, or focus it and use
 * the arrow keys) and resized (drag the right edge, the size menu, or arrow keys on the edge).
 */
export function BoardWidgets({
  widgets,
  publicMode,
  rangePreset,
  filters = [],
  onLayoutChange,
}: {
  widgets: Widget[];
  publicMode?: boolean;
  rangePreset: BoardRangePreset;
  /** Board-wide property filters merged into every insight widget. */
  filters?: PropertyFilter[];
  onLayoutChange?: (widgets: Widget[]) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [armedIndex, setArmedIndex] = useState<number | null>(null);
  const editable = Boolean(onLayoutChange) && !publicMode;

  function commitMove(from: number, to: number) {
    if (!onLayoutChange || from === to) return;
    onLayoutChange(moveWidget(widgets, from, to));
  }

  function resize(index: number, width: BoardWidgetWidth) {
    if (!onLayoutChange || normalizeBoardWidgetWidth(widgets[index]?.width) === width) return;
    onLayoutChange(widgets.map((w, i) => (i === index ? { ...w, width } : w)));
  }

  return (
    <div className="board-widgets-grid" ref={gridRef}>
      {widgets.map((w, i) => (
        <BoardWidgetFrame
          key={widgetKey(w, i)}
          widget={w}
          index={i}
          count={widgets.length}
          editable={editable}
          linkTitle={!publicMode && !editable}
          gridRef={gridRef}
          dragging={dragIndex === i}
          dropTarget={dragIndex !== null && overIndex === i && dragIndex !== i}
          draggable={editable && armedIndex === i}
          onArm={(armed) => setArmedIndex(armed ? i : null)}
          onDragStart={() => setDragIndex(i)}
          onDragOver={() => setOverIndex(i)}
          onDrop={() => {
            if (dragIndex !== null) commitMove(dragIndex, i);
            setDragIndex(null);
            setOverIndex(null);
            setArmedIndex(null);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
            setArmedIndex(null);
          }}
          onMove={(delta) => commitMove(i, Math.max(0, Math.min(widgets.length - 1, i + delta)))}
          onResize={(width) => resize(i, width)}
        >
          {w.type === 'insight' ? (
            <InsightBoardWidget widget={w} publicMode={publicMode} rangePreset={rangePreset} filters={filters} />
          ) : (
            <StatsBoardWidget widget={w} publicMode={publicMode} rangePreset={rangePreset} />
          )}
        </BoardWidgetFrame>
      ))}
    </div>
  );
}

function BoardWidgetFrame({
  widget,
  index,
  count,
  editable,
  linkTitle,
  gridRef,
  dragging,
  dropTarget,
  draggable,
  onArm,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onResize,
  children,
}: {
  widget: Widget;
  index: number;
  count: number;
  editable: boolean;
  linkTitle: boolean;
  gridRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  dropTarget: boolean;
  draggable: boolean;
  onArm: (armed: boolean) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onMove: (delta: number) => void;
  onResize: (width: BoardWidgetWidth) => void;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLElement>(null);
  const [previewSize, setPreviewSize] = useState<BoardWidgetWidth | null>(null);
  const size = previewSize ?? normalizeBoardWidgetWidth(widget.width);
  const title =
    widget.label?.trim() ||
    (widget.type === 'insight' ? widget.insightName || t('insight') : t('boardWidgetStats'));

  function onGripKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(-1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(1);
    }
  }

  function stepSize(delta: number) {
    const at = BOARD_WIDGET_SIZES.indexOf(size);
    const next = BOARD_WIDGET_SIZES[Math.max(0, Math.min(BOARD_WIDGET_SIZES.length - 1, at + delta))];
    if (next) onResize(next);
  }

  function onResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    const grid = gridRef.current;
    const frame = frameRef.current;
    if (!grid || !frame) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const gridWidth = grid.getBoundingClientRect().width;
    const left = frame.getBoundingClientRect().left;
    let latest = size;
    const move = (e: PointerEvent) => {
      latest = sizeForFraction((e.clientX - left) / Math.max(gridWidth, 1));
      setPreviewSize(latest);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setPreviewSize(null);
      onResize(latest);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  const className = [
    'board-stat-widget',
    `board-stat-widget--${size}`,
    editable ? 'board-widget--editable' : '',
    dragging ? 'board-widget--dragging' : '',
    dropTarget ? 'board-widget--drop-target' : '',
    previewSize ? 'board-widget--resizing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      ref={frameRef}
      className={className}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!editable) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOver();
      }}
      onDrop={(event) => {
        if (!editable) return;
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <header className="board-widget-head">
        {editable ? (
          <button
            type="button"
            className="board-widget-grip"
            aria-label={t('boardWidgetMoveHint').replace('{position}', String(index + 1)).replace('{count}', String(count))}
            title={t('boardWidgetDrag')}
            onPointerDown={() => onArm(true)}
            onPointerUp={() => onArm(false)}
            onKeyDown={onGripKey}
          >
            <GripVertical size={14} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
        <h3 className="board-stat-widget-title">
          {widget.type === 'insight' && linkTitle ? (
            <Link to={`/insights?insight=${widget.insightId}`}>{title}</Link>
          ) : (
            title
          )}
        </h3>
        {editable ? (
          <select
            className="select board-widget-size-select"
            aria-label={t('boardWidgetWidth')}
            value={size}
            onChange={(event) => onResize(normalizeBoardWidgetWidth(event.target.value))}
          >
            {BOARD_WIDGET_SIZES.map((option) => (
              <option key={option} value={option}>
                {boardWidgetSizeLabel(option)}
              </option>
            ))}
          </select>
        ) : null}
      </header>
      {children}
      {editable ? (
        <div
          className="board-widget-resize"
          role="slider"
          tabIndex={0}
          aria-label={t('boardWidgetResize')}
          aria-valuemin={1}
          aria-valuemax={BOARD_WIDGET_SIZES.length}
          aria-valuenow={BOARD_WIDGET_SIZES.indexOf(size) + 1}
          aria-valuetext={boardWidgetSizeLabel(size)}
          onPointerDown={onResizeStart}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              stepSize(-1);
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              stepSize(1);
            }
          }}
        />
      ) : null}
    </section>
  );
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
    <>
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
                  stroke={chartColors.series.pageviews}
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
    </>
  );
}

function InsightBoardWidget({
  widget,
  publicMode,
  rangePreset,
  filters,
}: {
  widget: InsightWidgetConfig;
  publicMode?: boolean;
  rangePreset: BoardRangePreset;
  filters: PropertyFilter[];
}) {
  const range = presetToRange(rangePreset);
  const filterJson = filters.length ? JSON.stringify(filters) : '';
  const qs = `${rangeQueryString(range.startAt, range.endAt)}${filterJson ? `&filters=${encodeURIComponent(filterJson)}` : ''}`;
  const insightQuery = useQuery({
    queryKey: ['board-widget-insight', widget.insightId, rangePreset, filterJson],
    enabled: !publicMode && Boolean(widget.insightId),
    queryFn: () => api<{ data: InsightResult }>(`/api/insights/${widget.insightId}/run?${qs}`),
  });
  const result = (widget.result as InsightResult | undefined) ?? insightQuery.data?.data;
  const loading = !publicMode && insightQuery.isLoading;
  const error = widget.error ?? (insightQuery.isError ? (insightQuery.error as Error).message : null);

  return (
    <>
      {loading ? <div className="skeleton skeleton-block" aria-busy /> : null}
      {!loading && error ? <p className="text-muted board-stat-widget-empty">{t('boardWidgetError')}</p> : null}
      {!loading && !error && result ? (
        <div className="board-insight-widget-body">
          <InsightResultView result={result} compact />
        </div>
      ) : null}
    </>
  );
}
