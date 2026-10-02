import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../lib/utils';

export type ChartLegendItem = {
  label: ReactNode;
  /** Any CSS color, including var(--chart-1) (this is HTML, not an SVG attribute). */
  color: string;
  /** Line key for lines/areas, box for bars (mirrors the mark). */
  shape?: 'line' | 'box';
};

/**
 * Legend for charts with two or more series (none for a single series: the card title names
 * it). Sits in the card header's actions, top right. Text stays in text tokens; only the key
 * carries the series color.
 */
export function ChartLegend({ items, className }: { items: ChartLegendItem[]; className?: string }) {
  if (items.length < 2) return null;
  return (
    <div className={cn('chart-legend', className)}>
      {items.map((item, index) => (
        <span key={index} className="chart-legend-item">
          <span
            className={cn('chart-legend-key', item.shape === 'box' && 'is-box')}
            style={{ '--legend-color': item.color } as CSSProperties}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
