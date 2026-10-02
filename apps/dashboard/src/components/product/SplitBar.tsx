import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { formatShare } from './format';

export type SplitSegment = {
  key: string;
  label: ReactNode;
  /** Raw amount; segments are drawn as shares of the total. */
  value: number;
  /** CSS color (HTML, so var(--chart-n) works). */
  color: string;
  /** Extra text after the share in the legend ("2,406"). */
  detail?: ReactNode;
  mono?: boolean;
};

/**
 * Part-to-whole as one horizontal stacked bar (dataviz: stacked bar, 2px surface gaps between
 * segments, 4px rounded outer ends) with a legend underneath: color key, label, share, detail.
 * Text stays in text tokens; only the segments and keys carry the series colors.
 */
export function SplitBar({
  segments,
  ariaLabel,
  legend = true,
  className,
}: {
  segments: SplitSegment[];
  ariaLabel: string;
  legend?: boolean;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const visible = segments.filter((segment) => segment.value > 0);
  return (
    <div className={cn('product-split', className)}>
      <div className="product-split-bar" role="img" aria-label={ariaLabel}>
        {total > 0 ? (
          visible.map((segment) => (
            <span
              key={segment.key}
              className="product-split-segment"
              style={{ flexGrow: segment.value, '--split-color': segment.color } as CSSProperties}
              title={`${typeof segment.label === 'string' ? segment.label : segment.key} · ${formatShare((segment.value / total) * 100)}`}
            />
          ))
        ) : (
          <span className="product-split-empty" />
        )}
      </div>
      {legend ? (
        <ul className="product-split-legend">
          {segments.map((segment) => (
            <li key={segment.key}>
              <span
                className="product-split-key"
                style={{ '--split-color': segment.color } as CSSProperties}
                aria-hidden
              />
              <span className={cn('product-split-label', segment.mono && 'mono')}>{segment.label}</span>
              <span className="product-split-share">
                {total > 0 ? formatShare((Math.max(0, segment.value) / total) * 100) : '–'}
              </span>
              {segment.detail ? <span className="product-split-detail">{segment.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A single ratio against 100% (rollout, sample progress): a thin track in a lighter step of
 * the fill's hue, the fill in series slot 1 unless a color is given.
 */
export function Meter({
  value,
  label,
  color = 'var(--chart-1)',
  className,
}: {
  /** 0–100. */
  value: number;
  label: string;
  color?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span
      className={cn('product-meter', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      style={{ '--meter-color': color } as CSSProperties}
    >
      <span className="product-meter-fill" style={{ width: `${clamped}%` }} />
    </span>
  );
}

/** Small square/line key in a series color beside text that names the series. */
export function SeriesKey({ color, shape = 'box' }: { color: string; shape?: 'box' | 'line' }) {
  return (
    <span
      className={cn('chart-legend-key', shape === 'box' && 'is-box')}
      style={{ '--legend-color': color } as CSSProperties}
      aria-hidden
    />
  );
}
