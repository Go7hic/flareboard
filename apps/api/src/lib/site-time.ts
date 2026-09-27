import { siteOffsetSegments } from '@flareboard/shared/timezone';

/**
 * SQL for `column` (epoch ms) shifted to the site's wall clock, so strftime buckets
 * follow the site's calendar days. Offsets (including DST changes) are computed in JS
 * for [startAt, endAt] and inlined as integers; UTC sites get the column unchanged.
 */
export function siteLocalMsSql(column: string, startAt: number, endAt: number, timezone = 'UTC'): string {
  if (!timezone || timezone === 'UTC') return column;
  const segments = siteOffsetSegments(startAt, endAt, timezone);
  const last = segments[segments.length - 1]!;
  if (segments.length === 1) return `(${column} + ${last.offsetMs})`;
  const cases = segments
    .slice(0, -1)
    .map((segment) => `WHEN ${column} < ${segment.until} THEN ${segment.offsetMs}`)
    .join(' ');
  return `(${column} + CASE ${cases} ELSE ${last.offsetMs} END)`;
}

/** Day/month/year series bucket in site-local time; hour buckets stay UTC (the dashboard converts them). */
export function seriesTimezone(unit: string, timezone: string | null | undefined): string {
  return unit === 'hour' ? 'UTC' : timezone || 'UTC';
}
