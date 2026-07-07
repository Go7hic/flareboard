import { describe, expect, it } from 'vitest';
import {
  rollupDailyRangeEligible,
  rollupHourlySeriesEligible,
  rolling24hRange,
  utcCalendarDaysRange,
  utcEndOfDay,
  utcStartOfDay,
} from './date-range';

describe('utcCalendarDaysRange', () => {
  it('returns UTC day boundaries for 7 days', () => {
    const now = Date.parse('2026-07-07T15:30:00.000Z');
    const { startAt, endAt } = utcCalendarDaysRange(7, now);
    expect(startAt).toBe(Date.parse('2026-07-01T00:00:00.000Z'));
    expect(endAt).toBe(Date.parse('2026-07-07T23:59:59.999Z'));
    expect(rollupDailyRangeEligible(startAt, endAt)).toBe(true);
  });

  it('covers 30 inclusive UTC days', () => {
    const now = Date.parse('2026-07-07T12:00:00.000Z');
    const { startAt, endAt } = utcCalendarDaysRange(30, now);
    const days = (endAt - utcStartOfDay(startAt)) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(rollupDailyRangeEligible(startAt, endAt)).toBe(true);
  });
});

describe('rolling24hRange', () => {
  it('is not daily-rollups eligible but supports hourly series', () => {
    const now = Date.parse('2026-07-07T15:30:00.000Z');
    const { startAt, endAt } = rolling24hRange(now);
    expect(endAt - startAt).toBe(24 * 60 * 60 * 1000);
    expect(rollupDailyRangeEligible(startAt, endAt)).toBe(false);
    expect(rollupHourlySeriesEligible(startAt, endAt)).toBe(true);
  });
});

describe('rollupDailyRangeEligible', () => {
  it('rejects rolling windows', () => {
    const endAt = Date.now();
    const startAt = endAt - 7 * 24 * 60 * 60 * 1000;
    expect(rollupDailyRangeEligible(startAt, endAt)).toBe(false);
  });

  it('accepts aligned UTC days', () => {
    const startAt = utcStartOfDay(Date.now());
    const endAt = utcEndOfDay(Date.now());
    expect(rollupDailyRangeEligible(startAt, endAt)).toBe(true);
  });
});
