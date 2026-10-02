import { formatDateTime, formatRelativeTime, formatShortDateTime } from '../../lib/format';

/**
 * "3 min ago" (or a short date-time with `short`), with the full timestamp in the tooltip and
 * the machine value in `dateTime`. Renders "-" for a missing value.
 */
export function RelativeTime({
  value,
  short = false,
  timeZone,
  className,
}: {
  value: string | number | null | undefined;
  /** "Oct 2, 23:32" instead of "3 h ago". */
  short?: boolean;
  timeZone?: string;
  className?: string;
}) {
  if (value == null || value === '') return <span className={className}>-</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={className}>-</span>;
  return (
    <time
      className={className}
      dateTime={date.toISOString()}
      title={formatDateTime(date.getTime(), { timeZone })}
    >
      {short ? formatShortDateTime(date, { timeZone }) : formatRelativeTime(date)}
    </time>
  );
}
