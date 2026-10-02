import { formatDateTime, formatShortDateTime } from '../../lib/format';
import { cn } from '../../lib/utils';
import { relativeLabel } from './format';

/**
 * A date as "3 min ago" (or "Oct 2, 23:32" with `format="short"`), the full timestamp in the
 * tooltip. Lists and tables use it so long dates never truncate.
 */
export function RelativeTime({
  value,
  format = 'relative',
  className,
}: {
  value: number | string | null | undefined;
  format?: 'relative' | 'short';
  className?: string;
}) {
  if (value == null) return <span className={className}>-</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={className}>-</span>;
  return (
    <time className={cn('traffic-time', className)} dateTime={date.toISOString()} title={formatDateTime(date.getTime())}>
      {format === 'short' ? formatShortDateTime(date) : relativeLabel(date)}
    </time>
  );
}
