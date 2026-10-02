import { getLocale } from '../../lib/i18n';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Axis label for a time bucket: time of day for short ranges, otherwise the date. */
export function bucketTickLabel(start: number, spanMs: number, timeZone?: string) {
  const date = new Date(start);
  if (spanMs <= 2 * DAY) {
    return date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  }
  return date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone });
}

/** Tooltip title for a bucket: "Oct 2, 14:00 – 15:00". */
export function bucketRangeLabel(start: number, end: number, timeZone?: string) {
  const startText = new Date(start).toLocaleString(getLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  const sameDay =
    new Date(start).toLocaleDateString('en-CA', { timeZone }) === new Date(end).toLocaleDateString('en-CA', { timeZone });
  const endText = sameDay
    ? new Date(end).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
    : new Date(end).toLocaleString(getLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
      });
  return `${startText} – ${endText}`;
}

/**
 * Category ticks for a bucketed series: the buckets that start a new label (a new day on long
 * ranges), thinned evenly to at most `maxTicks`. Pass with `interval: 0`.
 */
export function bucketTicks(rows: Array<{ i: number; tick: string }>, maxTicks = 8): number[] {
  const labelled = rows.filter((row) => row.tick).map((row) => row.i);
  if (labelled.length <= maxTicks) return labelled;
  const step = Math.ceil(labelled.length / maxTicks);
  return labelled.filter((_, index) => index % step === 0);
}
