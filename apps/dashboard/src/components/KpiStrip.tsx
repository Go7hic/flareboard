import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';

/**
 * One card of headline numbers split by hairlines (console v2). Cells can be selectable, in
 * which case they act as the tabs of the chart below them (overview metric switching).
 */
export function KpiStrip({
  children,
  columns,
  inline = false,
  className,
  label,
}: {
  children: ReactNode;
  /** Cells per row on wide screens (defaults to the number of children, capped at 6). */
  columns?: number;
  /** Inside a detail card: no outer box, only top/bottom hairlines. */
  inline?: boolean;
  className?: string;
  /** Accessible name when cells are selectable (they form a tab list). */
  label?: string;
}) {
  const count = Array.isArray(children) ? children.filter(Boolean).length : 1;
  const cols = Math.min(columns ?? count, 6);
  return (
    <div
      className={cn('kpi-strip', inline && 'kpi-strip--inline', className)}
      style={{ '--kpi-cols': cols } as CSSProperties}
      data-cols={cols}
      role={label ? 'tablist' : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function KpiCell({
  label,
  value,
  unit,
  delta,
  hint,
  keyColor,
  keyShape = 'line',
  selected,
  onSelect,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small suffix after the value ("ms", "%", "/ visit"). */
  unit?: ReactNode;
  /** Usually <StatChangeDelta />. */
  delta?: ReactNode;
  hint?: ReactNode;
  /** Series color key beside the label when the cell drives a chart series. */
  keyColor?: string;
  /** Match the chart's legend: a line key for lines, a square for bars. */
  keyShape?: 'line' | 'box';
  selected?: boolean;
  onSelect?: () => void;
  /** Full value for the tooltip when `value` is compacted. */
  title?: string;
}) {
  const body = (
    <>
      <span className="kpi-label">
        {keyColor ? (
          <span
            className={keyShape === 'box' ? 'kpi-label-key is-box' : 'kpi-label-key'}
            style={{ '--kpi-key': keyColor } as CSSProperties}
            aria-hidden
          />
        ) : null}
        {label}
      </span>
      <span className="kpi-value-row">
        <span className="kpi-value" title={title}>
          {value}
          {unit ? <span className="kpi-value-unit">{unit}</span> : null}
        </span>
        {delta}
      </span>
      {hint ? <span className="kpi-hint">{hint}</span> : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={selected ?? false}
        className={cn('kpi-cell', selected && 'is-selected')}
        onClick={onSelect}
      >
        {body}
      </button>
    );
  }

  return <div className={cn('kpi-cell', selected && 'is-selected')}>{body}</div>;
}

/** Skeleton in the strip's final shape (no layout jump when data arrives). */
export function KpiStripSkeleton({ cells = 4, inline = false }: { cells?: number; inline?: boolean }) {
  return (
    <KpiStrip columns={cells} inline={inline}>
      {Array.from({ length: cells }, (_, index) => (
        <div key={index} className="kpi-cell" aria-hidden>
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-2 h-7 w-3/4" />
        </div>
      ))}
    </KpiStrip>
  );
}
