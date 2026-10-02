import { formatDateTime, formatRelativeTime, formatShortDate, formatShortDateTime } from '../../lib/format';
import { toDate } from './format';

type DateInput = string | number | Date | null | undefined;

/** "3 min ago" / "2 天前" with the full timestamp on hover (past events; future skew reads as just now). */
export function RelativeTime({ value, className }: { value: DateInput; className?: string }) {
  const date = toDate(value);
  if (!date) return <span className={className}>–</span>;
  return (
    <time className={className} dateTime={date.toISOString()} title={formatDateTime(date.getTime())}>
      {formatRelativeTime(date)}
    </time>
  );
}

/** "Oct 2" (or "Oct 2, 23:32" with `withTime`) with the full timestamp on hover. */
export function ShortDate({
  value,
  withTime = false,
  timeZone,
  className,
}: {
  value: DateInput;
  withTime?: boolean;
  timeZone?: string;
  className?: string;
}) {
  const date = toDate(value);
  if (!date) return <span className={className}>–</span>;
  return (
    <time className={className} dateTime={date.toISOString()} title={formatDateTime(date.getTime(), { timeZone })}>
      {withTime ? formatShortDateTime(date, { timeZone }) : formatShortDate(date, { timeZone })}
    </time>
  );
}
