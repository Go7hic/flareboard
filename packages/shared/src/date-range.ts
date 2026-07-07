const MS_DAY = 24 * 60 * 60 * 1000;

export type UtcCalendarPreset = '7d' | '30d' | '90d';

export function utcStartOfDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function utcEndOfDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}

/** Inclusive UTC calendar window of `dayCount` days ending on `now`'s UTC day. */
export function utcCalendarDaysRange(dayCount: number, now = Date.now()) {
  const endAt = utcEndOfDay(now);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (dayCount - 1));
  return { startAt: start.getTime(), endAt };
}

export function rolling24hRange(now = Date.now()) {
  return { startAt: now - MS_DAY, endAt: now };
}

export function rollupDailyRangeEligible(startAt: number, endAt: number): boolean {
  return startAt === utcStartOfDay(startAt) && endAt === utcEndOfDay(endAt) && endAt >= startAt;
}

export function rollupHourlySeriesEligible(startAt: number, endAt: number): boolean {
  return endAt > startAt;
}

/** @deprecated Use rollupDailyRangeEligible */
export function rollupRangeEligible(startAt: number, endAt: number): boolean {
  return rollupDailyRangeEligible(startAt, endAt);
}
