import { describe, expect, it } from 'vitest';
import { utcCalendarDaysRange } from './date-range';
import {
  formatDayBucketLabel,
  formatHourBucketLabel,
  isValidSiteTimezone,
  siteCalendarDaysRange,
  siteCustomRange,
  siteEndOfDay,
  siteStartOfDay,
} from './timezone';

describe('isValidSiteTimezone', () => {
  it('accepts common IANA zones', () => {
    expect(isValidSiteTimezone('UTC')).toBe(true);
    expect(isValidSiteTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidSiteTimezone('America/New_York')).toBe(true);
  });

  it('rejects invalid zones', () => {
    expect(isValidSiteTimezone('Not/AZone')).toBe(false);
    expect(isValidSiteTimezone('')).toBe(false);
  });
});

describe('siteStartOfDay / siteEndOfDay', () => {
  it('uses UTC midnight boundaries', () => {
    const now = Date.parse('2026-07-07T15:30:00.000Z');
    expect(siteStartOfDay(now, 'UTC')).toBe(Date.parse('2026-07-07T00:00:00.000Z'));
    expect(siteEndOfDay(now, 'UTC')).toBe(Date.parse('2026-07-07T23:59:59.999Z'));
  });

  it('uses Asia/Shanghai local midnights (UTC+8)', () => {
    const now = Date.parse('2026-07-07T15:30:00.000Z');
    expect(siteStartOfDay(now, 'Asia/Shanghai')).toBe(Date.parse('2026-07-06T16:00:00.000Z'));
    expect(siteEndOfDay(now, 'Asia/Shanghai')).toBe(Date.parse('2026-07-07T15:59:59.999Z'));
  });
});

describe('siteCalendarDaysRange', () => {
  const now = Date.parse('2026-07-07T15:30:00.000Z');

  it('differs from UTC for Asia/Shanghai 7d', () => {
    const utc = utcCalendarDaysRange(7, now);
    const shanghai = siteCalendarDaysRange(7, 'Asia/Shanghai', now);
    expect(shanghai.startAt).not.toBe(utc.startAt);
    expect(shanghai.endAt).not.toBe(utc.endAt);
    expect(shanghai.startAt).toBe(Date.parse('2026-06-30T16:00:00.000Z'));
    expect(shanghai.endAt).toBe(Date.parse('2026-07-07T15:59:59.999Z'));
  });

  it('matches UTC for UTC timezone', () => {
    const utc = utcCalendarDaysRange(7, now);
    const site = siteCalendarDaysRange(7, 'UTC', now);
    expect(site.startAt).toBe(utc.startAt);
    expect(site.endAt).toBe(utc.endAt);
  });
});

describe('siteCustomRange', () => {
  it('interprets datetime-local strings in site timezone', () => {
    const { startAt, endAt } = siteCustomRange(
      '2026-07-07T09:00',
      '2026-07-07T17:00',
      'Asia/Shanghai',
    );
    expect(startAt).toBe(Date.parse('2026-07-07T01:00:00.000Z'));
    expect(endAt).toBe(Date.parse('2026-07-07T09:00:00.000Z'));
  });
});

describe('formatHourBucketLabel', () => {
  it('formats UTC bucket in site timezone', () => {
    const label = formatHourBucketLabel('2026-07-07 08:00', 'Asia/Shanghai');
    expect(label).toMatch(/7\/7/);
    expect(label).toMatch(/16:00/);
  });
});

describe('formatDayBucketLabel', () => {
  it('formats UTC day bucket in site timezone', () => {
    const label = formatDayBucketLabel('2026-07-07', 'Asia/Shanghai');
    expect(label).toMatch(/7\/7/);
  });
});

describe('America/New_York DST edge', () => {
  it('handles spring-forward day boundaries', () => {
    const now = Date.parse('2026-03-09T12:00:00.000Z');
    const start = siteStartOfDay(now, 'America/New_York');
    const end = siteEndOfDay(now, 'America/New_York');
    expect(end - start).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(end - start).toBeLessThan(25 * 60 * 60 * 1000);
  });
});

describe('siteOffsetSegments', () => {
  it('is a single segment for UTC', async () => {
    const { siteOffsetSegments } = await import('./timezone');
    expect(siteOffsetSegments(Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31), 'UTC')).toEqual([
      { until: Infinity, offsetMs: 0 },
    ]);
  });

  it('splits at DST transitions', async () => {
    const { siteOffsetSegments } = await import('./timezone');
    // US DST 2026 starts 2026-03-08 07:00 UTC (2am EST) and ends 2026-11-01 06:00 UTC.
    const segments = siteOffsetSegments(Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31), 'America/New_York');
    expect(segments).toEqual([
      { until: Date.UTC(2026, 2, 8, 7), offsetMs: -5 * 3_600_000 },
      { until: Date.UTC(2026, 10, 1, 6), offsetMs: -4 * 3_600_000 },
      { until: Infinity, offsetMs: -5 * 3_600_000 },
    ]);
  });
});

describe('formatDayBucketLabel for far-east zones', () => {
  it('keeps the bucket date in UTC+13', () => {
    expect(formatDayBucketLabel('2026-03-05', 'Pacific/Tongatapu')).toBe(
      new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'numeric', day: 'numeric' }).format(
        new Date(Date.UTC(2026, 2, 5, 12)),
      ),
    );
  });
});
