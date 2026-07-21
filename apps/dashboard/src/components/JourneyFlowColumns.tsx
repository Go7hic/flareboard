import { FileText } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildJourneyColumns,
  buildJourneyEdges,
  applyJourneyNodeClick,
  journeyNodeKey,
  nodeConversionPct,
  type JourneyColumnSelection,
  type JourneyColumn,
  type JourneyEdge,
  type JourneyNodeState,
  type JourneyPathRow,
} from '../lib/journey-utils';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

type JourneyFlowColumnsProps = {
  paths: JourneyPathRow[];
  maxDepth: number;
  selectedColumns: JourneyColumnSelection;
  onSelectColumn: (selected: JourneyColumnSelection) => void;
};

type NodeRect = { x: number; y: number; width: number; height: number };

function ColumnHeader({ column, stepNumber }: { column: JourneyColumn; stepNumber: number }) {
  const showDropoff = column.dropOffPct !== null && column.dropOffPct > 0;
  const dropoffLabel = showDropoff ? `${column.dropOffPct}% ${t('journeyDropoff')}` : null;

  return (
    <div className="journey-column-header">
      <span className="journey-column-num">{stepNumber}</span>
      <div className="journey-column-stats">
        {showDropoff ? (
          <span className="journey-column-dropoff journey-column-dropoff--mirror" aria-hidden>
            {dropoffLabel}
          </span>
        ) : null}
        <span className="journey-column-visitors">
          {formatNumber(column.visitorCount)} {t('journeyVisitors')}
        </span>
        {showDropoff ? <span className="journey-column-dropoff">{dropoffLabel}</span> : null}
      </div>
    </div>
  );
}

function FlowNode({
  name,
  count,
  columnIndex,
  state,
  previousVisitorCount,
  onClick,
}: {
  name: string;
  count: number;
  columnIndex: number;
  state: JourneyNodeState;
  previousVisitorCount: number;
  onClick: () => void;
}) {
  const conversion = columnIndex > 0 ? nodeConversionPct(count, previousVisitorCount) : null;
  const stateClass = [
    'journey-flow-node',
    state === 'selected' || state === 'connected' ? 'is-selected' : 'is-inactive',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      data-journey-node={journeyNodeKey(columnIndex, name)}
      className={stateClass}
      onClick={onClick}
      aria-pressed={state === 'selected'}
      title={
        conversion !== null
          ? `${conversion}% ${t('journeyConversion')}`
          : undefined
      }
    >
      <span className="journey-flow-node-icon" aria-hidden>
        <FileText size={14} strokeWidth={2} />
      </span>
      <span className="journey-flow-node-name reports-path-mono">{name}</span>
      <span className="journey-flow-node-count">{formatNumber(count)}</span>
    </button>
  );
}

function bezierPath(from: NodeRect, to: NodeRect): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const dx = Math.max((x2 - x1) * 0.5, 32);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function FlowConnectors({
  edges,
  nodeRects,
  maxCount,
  dimensions,
}: {
  edges: JourneyEdge[];
  nodeRects: Map<string, NodeRect>;
  maxCount: number;
  dimensions: { width: number; height: number };
}) {
  if (!edges.length || dimensions.width <= 0 || dimensions.height <= 0) return null;

  const paths = edges
    .map((edge) => {
      const fromKey = journeyNodeKey(edge.fromColumn, edge.fromName);
      const toKey = journeyNodeKey(edge.toColumn, edge.toName);
      const from = nodeRects.get(fromKey);
      const to = nodeRects.get(toKey);
      if (!from || !to) return null;
      const weight = maxCount > 0 ? 1.5 + (edge.count / maxCount) * 2.5 : 2;
      return { d: bezierPath(from, to), weight };
    })
    .filter(Boolean) as { d: string; weight: number }[];

  if (!paths.length) return null;

  return (
    <svg
      className="journey-flow-connectors"
      width={dimensions.width}
      height={dimensions.height}
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      aria-hidden
    >
      {paths.map((path, idx) => (
        <path
          key={idx}
          d={path.d}
          fill="none"
          className="journey-connector-chain"
          strokeWidth={path.weight}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function JourneyFlowColumns({
  paths,
  maxDepth,
  selectedColumns,
  onSelectColumn,
}: JourneyFlowColumnsProps) {
  const [nodeRects, setNodeRects] = useState<Map<string, NodeRect>>(new Map());
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(
    () => buildJourneyColumns(paths, maxDepth, selectedColumns),
    [paths, maxDepth, selectedColumns],
  );

  const edges = useMemo(
    () => buildJourneyEdges(paths, maxDepth, selectedColumns),
    [paths, maxDepth, selectedColumns],
  );

  const maxEdgeCount = useMemo(() => Math.max(...edges.map((e) => e.count), 1), [edges]);

  const measureNodes = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerBox = container.getBoundingClientRect();
    const next = new Map<string, NodeRect>();

    container.querySelectorAll<HTMLButtonElement>('[data-journey-node]').forEach((el) => {
      const key = el.dataset.journeyNode;
      if (!key) return;
      const box = el.getBoundingClientRect();
      next.set(key, {
        x: box.left - containerBox.left,
        y: box.top - containerBox.top,
        width: box.width,
        height: box.height,
      });
    });

    setNodeRects(next);
    setDimensions({ width: container.scrollWidth, height: container.offsetHeight });
  }, []);

  useLayoutEffect(() => {
    measureNodes();
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => measureNodes());
    observer.observe(container);
    container.querySelectorAll<HTMLButtonElement>('[data-journey-node]').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [measureNodes, columns, edges, selectedColumns]);

  const visibleColumns = columns.filter(
    (col, idx) => col.nodes.length > 0 || idx === 0,
  );
  if (!visibleColumns.some((col) => col.nodes.length > 0)) return null;

  const handleNodeClick = (columnIndex: number, name: string) => {
    onSelectColumn(applyJourneyNodeClick(selectedColumns, columnIndex, name, maxDepth));
  };

  return (
    <div className="journey-flow-columns" aria-label={t('journeyFlowLabel')}>
      <div className="journey-flow-columns-inner">
        <div className="journey-flow-columns-scroll">
          <div ref={containerRef} className="journey-flow-columns-content">
            <FlowConnectors
              edges={edges}
              nodeRects={nodeRects}
              maxCount={maxEdgeCount}
              dimensions={dimensions}
            />
            {visibleColumns.map((column, idx) => {
              const prevVisitorCount =
                idx > 0 ? (visibleColumns[idx - 1]?.visitorCount ?? 0) : column.visitorCount;

              return (
                <div key={column.columnIndex} className="journey-flow-column">
                  <ColumnHeader column={column} stepNumber={column.columnIndex + 1} />
                  <div className="journey-flow-column-nodes">
                    {column.nodes.map((node) => (
                      <FlowNode
                        key={journeyNodeKey(node.columnIndex, node.name)}
                        name={node.name}
                        count={node.count}
                        columnIndex={node.columnIndex}
                        state={node.state}
                        previousVisitorCount={prevVisitorCount}
                        onClick={() => handleNodeClick(node.columnIndex, node.name)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
