import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

export type BreakdownColumn = {
  label: ReactNode;
  /** Header becomes a sort button when given. */
  onSort?: () => void;
  sort?: 'ascending' | 'descending' | 'none';
};

export type BreakdownItem = {
  id: string;
  label: ReactNode;
  /** Full text for the hover title when the label truncates. */
  title?: string;
  /** One cell per column, already formatted. */
  values: ReactNode[];
  /** 0..1 share of the largest row; drawn as the row's background bar. */
  share: number;
  mono?: boolean;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
};

/**
 * Ranked rows with a share bar behind each (console v2): label left, values right-aligned with
 * tabular figures. The bar is a 12% wash of the series color, so the text stays in text tokens.
 */
export function BreakdownList({
  items,
  columns,
  labelHeader,
  color,
  className,
}: {
  items: BreakdownItem[];
  columns: BreakdownColumn[];
  labelHeader?: ReactNode;
  /** CSS color for the share bars (HTML, so var(--chart-n) works). Defaults to slot 1. */
  color?: string;
  className?: string;
}) {
  const style = {
    '--breakdown-cols': columns.length,
    ...(color ? { '--breakdown-color': color } : {}),
  } as CSSProperties;

  return (
    <div className={cn('breakdown', className)} style={style} role="table">
      <div className="breakdown-head" role="row">
        <span role="columnheader">{labelHeader}</span>
        {columns.map((column, index) => (
          <span key={index} role="columnheader" aria-sort={column.onSort ? column.sort ?? 'none' : undefined}>
            {column.onSort ? (
              <button type="button" className="breakdown-sort" onClick={column.onSort}>
                {column.label}
                {column.sort === 'ascending' ? ' ↑' : column.sort === 'descending' ? ' ↓' : ''}
              </button>
            ) : (
              column.label
            )}
          </span>
        ))}
      </div>
      {items.map((item) => {
        const content = (
          <>
            <span
              className="breakdown-bar"
              style={{ width: `${Math.max(0, Math.min(1, item.share)) * 100}%` }}
              aria-hidden
            />
            <span className="breakdown-label" role="cell">
              {item.icon}
              <span className={cn('breakdown-label-text', item.mono && 'is-mono')} title={item.title}>
                {item.label}
              </span>
            </span>
            {item.values.map((value, index) => (
              <span
                key={index}
                role="cell"
                className={index === 0 ? 'breakdown-value' : 'breakdown-value-muted'}
              >
                {value}
              </span>
            ))}
          </>
        );
        if (item.href) {
          return (
            <Link key={item.id} to={item.href} className="breakdown-row" role="row">
              {content}
            </Link>
          );
        }
        if (item.onClick) {
          return (
            <button key={item.id} type="button" className="breakdown-row" role="row" onClick={item.onClick}>
              {content}
            </button>
          );
        }
        return (
          <div key={item.id} className="breakdown-row" role="row">
            {content}
          </div>
        );
      })}
    </div>
  );
}
