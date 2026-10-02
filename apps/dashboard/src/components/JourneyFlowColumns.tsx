import { ArrowDownRight } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ProgressMeter } from './behavior/ProgressMeter';
import { formatRate } from './behavior/format';
import {
  applyJourneyNodeClick,
  buildJourneyColumns,
  buildJourneyEdges,
  journeyNodeKey,
  type JourneyColumn,
  type JourneyColumnNode,
  type JourneyColumnSelection,
  type JourneyEdge,
  type JourneyPathRow,
} from '../lib/journey-utils';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { cn } from '../lib/utils';

type JourneyFlowColumnsProps = {
  paths: JourneyPathRow[];
  maxDepth: number;
  selectedColumns: JourneyColumnSelection;
  onSelectColumn: (selected: JourneyColumnSelection) => void;
};

type NodeRect = { x: number; y: number; width: number; height: number };
type HoveredNode = { columnIndex: number; name: string };

/** Pages listed per step before "Show more" (a selected page always shows). */
const COLUMN_LIMIT = 8;
const STATE_RANK: Record<JourneyColumnNode['state'], number> = { selected: 0, connected: 1, inactive: 2 };

function bezierPath(from: NodeRect, to: NodeRect): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const dx = Math.max((x2 - x1) * 0.5, 16);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function FlowConnectors({
  edges,
  nodeRects,
  size,
  color,
  preview,
}: {
  edges: JourneyEdge[];
  nodeRects: Map<string, NodeRect>;
  size: { width: number; height: number };
  color: string;
  preview: boolean;
}) {
  if (!edges.length || size.width <= 0 || size.height <= 0) return null;
  const maxCount = Math.max(...edges.map((edge) => edge.count), 1);
  return (
    <svg
      className={cn('behavior-journey-links', preview && 'is-preview')}
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-hidden
    >
      {edges.map((edge) => {
        const from = nodeRects.get(journeyNodeKey(edge.fromColumn, edge.fromName));
        const to = nodeRects.get(journeyNodeKey(edge.toColumn, edge.toName));
        if (!from || !to) return null;
        return (
          <path
            key={`${edge.fromColumn}:${edge.fromName}>${edge.toName}`}
            d={bezierPath(from, to)}
            fill="none"
            stroke={color}
            strokeOpacity={preview ? 0.28 : 0.4}
            strokeWidth={1.5 + (edge.count / maxCount) * 4}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

function ColumnHeader({ column, firstCount }: { column: JourneyColumn; firstCount: number }) {
  const dropOff = column.dropOffPct !== null && column.dropOffPct > 0 ? column.dropOffPct : null;
  return (
    <div className="behavior-journey-col-head">
      <div className="behavior-journey-col-title">
        <span>{t('behaviorJourneyStepN').replace('{n}', String(column.columnIndex + 1))}</span>
        {dropOff !== null ? (
          <span className="behavior-journey-dropoff" title={t('behaviorJourneyDropoffTitle')}>
            <ArrowDownRight aria-hidden strokeWidth={2} />
            {t('behaviorJourneyDropoff').replace('{pct}', formatRate(dropOff))}
          </span>
        ) : null}
      </div>
      <div className="behavior-journey-col-count">
        <strong>{formatNumber(column.visitorCount)}</strong> {t('journeyVisitors')}
      </div>
      <ProgressMeter
        size="sm"
        value={firstCount > 0 ? column.visitorCount / firstCount : 0}
        label={t('behaviorJourneyStepN').replace('{n}', String(column.columnIndex + 1))}
      />
    </div>
  );
}

function FlowNode({
  node,
  total,
  state,
  onClick,
  onPreview,
}: {
  node: JourneyColumnNode;
  /** Visitors at this step across all pages, for the share bar. */
  total: number;
  state: JourneyColumnNode['state'] | 'idle';
  onClick: () => void;
  onPreview: (on: boolean) => void;
}) {
  const share = total > 0 ? node.count / total : 0;
  return (
    <button
      type="button"
      data-journey-node={journeyNodeKey(node.columnIndex, node.name)}
      className={cn('behavior-journey-node', `is-${state}`)}
      onClick={onClick}
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
      aria-pressed={state === 'selected'}
      title={`${node.name} · ${formatNumber(node.count)} ${t('journeyVisitors')} · ${formatRate(share * 100)}`}
    >
      <span className="behavior-journey-node-bar" style={{ width: `${share * 100}%` }} aria-hidden />
      <span className="behavior-journey-node-name">{node.name}</span>
      <span className="behavior-journey-node-count">{formatNumber(node.count)}</span>
    </button>
  );
}

/**
 * Columns of pages per step (console v2): each step lists its pages with visitor counts and a
 * share bar, the column header shows how many visitors are left and the drop-off from the step
 * before. Hovering a page previews where its visitors go next; clicking pins that path.
 */
export function JourneyFlowColumns({ paths, maxDepth, selectedColumns, onSelectColumn }: JourneyFlowColumnsProps) {
  const chartColors = useChartColors();
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodeRects, setNodeRects] = useState<Map<string, NodeRect>>(new Map());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<HoveredNode | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const columns = useMemo(
    () => buildJourneyColumns(paths, maxDepth, selectedColumns),
    [paths, maxDepth, selectedColumns],
  );

  // Hover previews the selection a click would make, without moving anything on the page.
  const previewSelection = useMemo(() => {
    if (!hovered || selectedColumns[hovered.columnIndex] === hovered.name) return null;
    return applyJourneyNodeClick(selectedColumns, hovered.columnIndex, hovered.name, maxDepth);
  }, [hovered, selectedColumns, maxDepth]);

  const previewColumns = useMemo(
    () => (previewSelection ? buildJourneyColumns(paths, maxDepth, previewSelection) : null),
    [paths, maxDepth, previewSelection],
  );

  const edges = useMemo(
    () => buildJourneyEdges(paths, maxDepth, previewSelection ?? selectedColumns),
    [paths, maxDepth, previewSelection, selectedColumns],
  );

  const hasSelection = selectedColumns.some((step) => step !== null);
  const visibleColumns = columns.filter((column, index) => column.nodes.length > 0 || index === 0);
  const firstCount = visibleColumns[0]?.visitorCount ?? 0;

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const next = new Map<string, NodeRect>();
    container.querySelectorAll<HTMLElement>('[data-journey-node]').forEach((element) => {
      const key = element.dataset.journeyNode;
      if (!key) return;
      const rect = element.getBoundingClientRect();
      next.set(key, { x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height });
    });
    setNodeRects(next);
    setSize({ width: container.scrollWidth, height: container.offsetHeight });
  }, []);

  // Re-measure when the rendered nodes change (data, depth, pinned path, expanded columns) or
  // the card resizes; hover never moves a node, so it does not trigger a measure.
  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, paths, maxDepth, selectedColumns, expanded]);

  if (!visibleColumns.some((column) => column.nodes.length > 0)) return null;

  function toggleExpanded(columnIndex: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(columnIndex)) next.delete(columnIndex);
      else next.add(columnIndex);
      return next;
    });
  }

  return (
    <div className="behavior-journey-scroll" aria-label={t('journeyFlowLabel')}>
      <div ref={containerRef} className="behavior-journey-columns">
        <FlowConnectors
          edges={edges}
          nodeRects={nodeRects}
          size={size}
          color={chartColors.accent}
          preview={Boolean(previewSelection)}
        />
        {visibleColumns.map((column) => {
          const columnTotal = column.nodes.reduce((sum, node) => sum + node.count, 0);
          const isExpanded = expanded.has(column.columnIndex);
          // With a pinned path, the pages on it lead their column; the rest follow, dimmed.
          const ordered = hasSelection
            ? [...column.nodes].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || b.count - a.count)
            : column.nodes;
          const shown = isExpanded
            ? ordered
            : ordered.filter((node, index) => index < COLUMN_LIMIT || node.state === 'selected');
          const hiddenCount = column.nodes.length - shown.length;
          const previewNodes = previewColumns?.[column.columnIndex]?.nodes;
          return (
            <div key={column.columnIndex} className="behavior-journey-col">
              <ColumnHeader column={column} firstCount={firstCount} />
              <div className="behavior-journey-nodes">
                {shown.map((node) => {
                  const previewState = previewNodes?.find((candidate) => candidate.name === node.name)?.state;
                  const state = previewState ?? (hasSelection ? node.state : 'idle');
                  return (
                    <FlowNode
                      key={journeyNodeKey(node.columnIndex, node.name)}
                      node={node}
                      total={columnTotal}
                      state={state}
                      onClick={() =>
                        onSelectColumn(applyJourneyNodeClick(selectedColumns, node.columnIndex, node.name, maxDepth))
                      }
                      onPreview={(on) =>
                        setHovered((current) =>
                          on
                            ? { columnIndex: node.columnIndex, name: node.name }
                            : current?.columnIndex === node.columnIndex && current.name === node.name
                              ? null
                              : current,
                        )
                      }
                    />
                  );
                })}
                {hiddenCount > 0 || (isExpanded && column.nodes.length > COLUMN_LIMIT) ? (
                  <button
                    type="button"
                    className="behavior-journey-more"
                    onClick={() => toggleExpanded(column.columnIndex)}
                  >
                    {isExpanded ? t('behaviorShowFewer') : t('behaviorShowMoreN').replace('{n}', formatNumber(hiddenCount))}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
