import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/**
 * Thin meter (dataviz): the fill is series slot 1, the track a lighter step of the same hue, so
 * the whole bar reads as one quantity. `marker` (0..1) draws a hairline tick, e.g. the pace a
 * goal should have reached by now.
 */
export function ProgressMeter({
  value,
  marker,
  label,
  markerLabel,
  className,
  size = 'md',
}: {
  /** 0..1 (clamped). */
  value: number;
  marker?: number | null;
  /** Accessible name of the meter. */
  label: string;
  markerLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const markerAt = marker == null || !Number.isFinite(marker) ? null : Math.max(0, Math.min(1, marker));
  return (
    <span
      className={cn('behavior-meter', size === 'sm' && 'behavior-meter--sm', className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <span className="behavior-meter-fill" style={{ width: `${clamped * 100}%` }} />
      {markerAt !== null ? (
        <span
          className="behavior-meter-marker"
          style={{ '--meter-marker': `${markerAt * 100}%` } as CSSProperties}
          title={markerLabel}
          aria-hidden
        />
      ) : null}
    </span>
  );
}
