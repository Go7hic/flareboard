/**
 * Pure helpers behind the goals page. Goal periods are UTC calendar windows (today, this week
 * from Monday, this month), the same windows the API counts in (`getGoalReport`).
 */

export type GoalPeriod = 'daily' | 'weekly' | 'monthly';
export type GoalStatus = 'reached' | 'onTrack' | 'behind';

const DAY = 86_400_000;

/** Length of the period that started at `periodStart` (a month has 28–31 days). */
export function goalPeriodLengthMs(period: string | null | undefined, periodStart: number): number {
  if (period === 'daily') return DAY;
  if (period === 'weekly') return 7 * DAY;
  const start = new Date(periodStart);
  const monthStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
  const nextMonth = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  return nextMonth - monthStart;
}

/** Share of the period elapsed at `now`, 0..1. */
export function goalElapsedShare(period: string | null | undefined, periodStart: number, now: number): number {
  const length = goalPeriodLengthMs(period, periodStart);
  if (length <= 0) return 1;
  return Math.max(0, Math.min(1, (now - periodStart) / length));
}

/**
 * Reached once the count meets the target; otherwise on track while the count keeps pace with
 * the time elapsed in the period (a 1,800 monthly target expects 600 ten days into a 30-day month).
 */
export function goalPace({
  count,
  target,
  period,
  periodStart,
  now,
}: {
  count: number;
  target: number;
  period: string | null | undefined;
  periodStart: number;
  now: number;
}): { status: GoalStatus; expected: number; elapsed: number } {
  const elapsed = goalElapsedShare(period, periodStart, now);
  const expected = target * elapsed;
  if (target > 0 && count >= target) return { status: 'reached', expected, elapsed };
  return { status: count >= expected ? 'onTrack' : 'behind', expected, elapsed };
}

/** Share (0..100) of `part` in `whole`, or null when the whole is empty. */
export function sharePercent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return (part / whole) * 100;
}
