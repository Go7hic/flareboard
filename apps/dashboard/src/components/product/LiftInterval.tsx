import { cn } from '../../lib/utils';

/**
 * A lift's 95% interval drawn around a zero line (domain ±`domain`, as fractions). Green when the
 * whole interval is above zero, red when below, gray when it crosses zero: the color means
 * significance, and the text next to it carries the numbers.
 */
export function LiftInterval({
  interval,
  lift,
  domain,
  label,
}: {
  interval: [number, number] | null | undefined;
  lift: number | null | undefined;
  domain: number;
  label: string;
}) {
  if (!interval) return null;
  const scale = (value: number) => Math.max(0, Math.min(100, 50 + (value / domain) * 50));
  const [low, high] = interval;
  const tone = low > 0 ? 'positive' : high < 0 ? 'negative' : 'neutral';
  const left = scale(Math.min(low, high));
  const right = scale(Math.max(low, high));
  return (
    <span className={cn('product-lift', `product-lift--${tone}`)} role="img" aria-label={label}>
      <span className="product-lift-zero" />
      <span className="product-lift-range" style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} />
      {lift != null ? <span className="product-lift-point" style={{ left: `${scale(lift)}%` }} /> : null}
    </span>
  );
}

/** Symmetric domain that fits every interval of a metric table (at least ±5%). */
export function liftDomain(intervals: Array<[number, number] | null | undefined>) {
  const extent = intervals.reduce((max, interval) => {
    if (!interval) return max;
    return Math.max(max, Math.abs(interval[0]), Math.abs(interval[1]));
  }, 0);
  return Math.max(0.05, extent * 1.15);
}
