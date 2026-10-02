import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, GripVertical } from 'lucide-react';
import { Area, AreaChart } from 'recharts';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { AnalyticsChart } from './AnalyticsChart';
import { InsightResultView } from './InsightResultView';
import { KpiCell, KpiStrip } from './KpiStrip';
import { StatChangeDelta } from './StatChangeDelta';
import { Skeleton } from './ui/skeleton';
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
import { areaMark } from '../lib/chartMarks';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { formatChartTimeLabel, isHourlyChartRange } from '../lib/chartTimeseries';
import { cn } from '../lib/utils';

type Widget = BoardWidget;

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
 * Board grid (12 columns: small 4, medium 6, large 8, full 12). With `onLayoutChange`, widgets
 * can be reordered (drag the grip, or focus it and use the arrow keys) and resized (drag the
 * right edge, the size menu, or arrow keys on the edge).
 */
export function BoardWidgets({
  widgets,
  publicMode,
  rangePreset,
  filters = [],
  onLayoutChange,
  websiteNames,
  insightNames,
}: {
  widgets: Widget[];
  publicMode?: boolean;
  rangePreset: BoardRangePreset;
  /** Board-wide property filters merged into every insight widget. */
  filters?: PropertyFilter[];
  onLayoutChange?: (widgets: Widget[]) => void;
  /** Default titles for unlabeled widgets (the board page knows the names). */
  websiteNames?: Record<string, string>;
  insightNames?: Record<string, string>;
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
    <div className="ws-widgets" ref={gridRef}>
      {widgets.map((w, i) => {
        const fallbackTitle =
          w.type === 'insight'
            ? w.insightName || insightNames?.[w.insightId] || t('insight')
            : websiteNames?.[w.websiteId] || t('boardWidgetStats');
        return (
          <BoardWidgetFrame
            key={widgetKey(w, i)}
            widget={w}
            title={w.label?.trim() || fallbackTitle}
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
        );
      })}
    </div>
  );
}

function BoardWidgetFrame({
  widget,
  title,
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
  title: string;
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

  return (
    <section
      ref={frameRef}
      className={cn(
        'ws-widget',
        `ws-widget--${size}`,
        editable && 'ws-widget--editable',
        dragging && 'ws-widget--dragging',
        dropTarget && 'ws-widget--drop-target',
        previewSize && 'ws-widget--resizing',
      )}
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
      <header className="ws-widget-head">
        {editable ? (
          <button
            type="button"
            className="ws-widget-grip"
            aria-label={t('boardWidgetMoveHint').replace('{position}', String(index + 1)).replace('{count}', String(count))}
            title={t('boardWidgetDrag')}
            onPointerDown={() => onArm(true)}
            onPointerUp={() => onArm(false)}
            onKeyDown={onGripKey}
          >
            <GripVertical aria-hidden />
          </button>
        ) : null}
        <h3 className="ws-widget-title" title={title}>
          {widget.type === 'insight' && linkTitle ? <Link to={`/insights?insight=${widget.insightId}`}>{title}</Link> : title}
        </h3>
        {editable ? (
          <select
            className="select ws-widget-size"
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
      <div className="ws-widget-body">{children}</div>
      {editable ? (
        <div
          className="ws-widget-resize"
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

function WidgetSkeleton() {
  return (
    <div className="ws-widget-skeleton" aria-busy>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  );
}

function WidgetError() {
  return (
    <div className="ws-widget-error" role="status">
      <CircleAlert aria-hidden />
      {t('boardWidgetError')}
    </div>
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
    queryFn: () => api<WebsiteStats>(`/api/websites/${widget.websiteId}/stats?${rangeQs}`),
    placeholderData: keepPreviousData,
  });

  const pageviewsQuery = useQuery({
    queryKey: ['board-widget-pageviews', widget.websiteId, rangePreset],
    enabled: !publicMode && Boolean(widget.websiteId),
    queryFn: () =>
      api<{ pageviews: { x: string; y: number }[] }>(
        `/api/websites/${widget.websiteId}/pageviews?unit=${hourly ? 'hour' : 'day'}&${rangeQs}`,
      ),
    placeholderData: keepPreviousData,
  });

  const stats = widget.stats ? (widget.stats as WebsiteStats) : statsQuery.data;
  const series = widget.series ?? pageviewsQuery.data?.pageviews ?? [];
  const loading = !publicMode && (statsQuery.isLoading || pageviewsQuery.isLoading);
  // Public boards get daily points even for 24 hours; label them as days.
  const hourlyLabels = hourly && series.some((point) => point.x.length > 10);
  const chartData = series.map((p) => ({ x: formatChartTimeLabel(p.x, hourlyLabels), y: p.y }));
  // "0%" between two empty periods says nothing.
  const delta = (change: number | undefined, value: number) =>
    change === undefined || (change === 0 && value === 0) ? undefined : <StatChangeDelta change={change} />;

  if (loading) return <WidgetSkeleton />;
  if (statsQuery.isError && !stats) return <WidgetError />;
  if (!stats) return null;
  const refreshing = statsQuery.isPlaceholderData || pageviewsQuery.isPlaceholderData;

  return (
    <div className={refreshing ? 'ws-widget-content ws-refreshing' : 'ws-widget-content'}>
      <KpiStrip inline columns={3} className="ws-widget-kpis">
        <KpiCell label={t('visitors')} value={formatNumber(stats.visitors.value)} delta={delta(stats.visitors.change, stats.visitors.value)} />
        <KpiCell
          label={t('pageviews')}
          keyColor={chartColors.series.pageviews}
          value={formatNumber(stats.pageviews.value)}
          delta={delta(stats.pageviews.change, stats.pageviews.value)}
        />
        <KpiCell label={t('visits')} value={formatNumber(stats.visits.value)} delta={delta(stats.visits.change, stats.visits.value)} />
      </KpiStrip>
      {chartData.length > 1 ? (
        <div className="ws-result-chart ws-widget-chart">
          <AnalyticsChart
            Chart={AreaChart}
            data={chartData}
            responsive={{ height: '100%' }}
            xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 28 }}
          >
            <Area
              dataKey="y"
              name={t('pageviews')}
              stroke={chartColors.series.pageviews}
              fill={chartColors.series.pageviews}
              {...areaMark(chartColors.panel)}
            />
          </AnalyticsChart>
        </div>
      ) : (
        <p className="ws-muted-line ws-widget-empty">{t('noDataInPeriod')}</p>
      )}
    </div>
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
    placeholderData: keepPreviousData,
  });
  const result = (widget.result as InsightResult | undefined) ?? insightQuery.data?.data;
  const loading = !publicMode && insightQuery.isLoading;
  const error = widget.error ?? (insightQuery.isError ? (insightQuery.error as Error).message : null);

  if (loading) return <WidgetSkeleton />;
  if (error) return <WidgetError />;
  if (!result) return null;
  return (
    <div className={insightQuery.isPlaceholderData ? 'ws-refreshing' : undefined}>
      <InsightResultView result={result} compact />
    </div>
  );
}
