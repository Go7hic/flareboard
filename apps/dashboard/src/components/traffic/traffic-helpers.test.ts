import { describe, expect, it } from 'vitest';
import { percentChange } from './format';
import { alignCompareSeries, bucketKeys, fillSeries, shiftBucketKey } from './series';
import { p75Rating, vitalParts } from './vitals';

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('bucket keys', () => {
  it('covers a rolling 24 hours with 25 UTC hour buckets', () => {
    const end = Date.UTC(2026, 9, 2, 17, 20);
    const keys = bucketKeys(end - DAY, end, 'hour');
    expect(keys).toHaveLength(25);
    expect(keys[0]).toBe('2026-10-01 17:00');
    expect(keys[24]).toBe('2026-10-02 17:00');
  });

  it('lists site-local days, including the last one', () => {
    // 2026-10-01 16:00Z is already Oct 2 in Shanghai (UTC+8).
    const keys = bucketKeys(Date.UTC(2026, 9, 1, 16), Date.UTC(2026, 9, 3, 15), 'day', 'Asia/Shanghai');
    expect(keys).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('collapses days into months', () => {
    const keys = bucketKeys(Date.UTC(2026, 6, 15), Date.UTC(2026, 9, 2), 'month', 'UTC');
    expect(keys).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
  });
});

describe('shiftBucketKey', () => {
  it('moves hours, days and months across boundaries', () => {
    expect(shiftBucketKey('2026-09-30 23:00', 'hour', 2)).toBe('2026-10-01 01:00');
    expect(shiftBucketKey('2026-03-01', 'day', -1)).toBe('2026-02-28');
    expect(shiftBucketKey('2026-01', 'month', -1)).toBe('2025-12');
  });
});

describe('fillSeries', () => {
  it('zero-fills buckets the API left out', () => {
    expect(fillSeries([{ x: 'b', y: 3 }], ['a', 'b', 'c'])).toEqual([
      { x: 'a', y: 0 },
      { x: 'b', y: 3 },
      { x: 'c', y: 0 },
    ]);
  });
});

describe('alignCompareSeries', () => {
  it('pairs buckets by the gap between the periods, not by array index', () => {
    const startAt = Date.UTC(2026, 8, 3);
    const endAt = Date.UTC(2026, 9, 3) - 1;
    const previousStartAt = startAt - 30 * DAY;
    // The previous period only has data on its last two days (tracking started then).
    const points = alignCompareSeries({
      current: [
        { x: '2026-09-03', y: 10 },
        { x: '2026-10-02', y: 20 },
      ],
      previous: [
        { x: '2026-09-01', y: 7 },
        { x: '2026-09-02', y: 8 },
      ],
      unit: 'day',
      startAt,
      endAt,
      previousStartAt,
      timeZone: 'UTC',
    });
    expect(points).toHaveLength(30);
    expect(points[0]).toMatchObject({ key: '2026-09-03', current: 10, previous: null, previousKey: '2026-08-04' });
    expect(points.at(-2)).toMatchObject({ key: '2026-10-01', previous: 7 });
    expect(points.at(-1)).toMatchObject({ key: '2026-10-02', current: 20, previous: 8, previousKey: '2026-09-02' });
  });

  it('lines hourly periods up and fills gaps after the first comparison bucket with zero', () => {
    const endAt = Date.UTC(2026, 9, 2, 17, 30);
    const startAt = endAt - DAY;
    const points = alignCompareSeries({
      current: [],
      previous: [
        { x: '2026-09-30 17:00', y: 4 },
        { x: '2026-09-30 19:00', y: 6 },
      ],
      unit: 'hour',
      startAt,
      endAt,
      previousStartAt: startAt - DAY,
      timeZone: 'UTC',
    });
    expect(points[0]).toMatchObject({ key: '2026-10-01 17:00', previous: 4 });
    expect(points[1]).toMatchObject({ key: '2026-10-01 18:00', previous: 0 });
    expect(points[2]).toMatchObject({ key: '2026-10-01 19:00', previous: 6 });
    expect(points[1].previousKey).toBe('2026-09-30 18:00');
    expect(endAt - startAt).toBe(24 * HOUR);
  });
});

describe('Web Vitals helpers', () => {
  it('rates the 75th percentile from the bucket counts', () => {
    expect(p75Rating({ good: 75, needsImprovement: 20, poor: 5, total: 100 })).toBe('good');
    expect(p75Rating({ good: 68, needsImprovement: 25, poor: 7, total: 100 })).toBe('needsImprovement');
    expect(p75Rating({ good: 50, needsImprovement: 20, poor: 30, total: 100 })).toBe('poor');
    expect(p75Rating({ good: 0, needsImprovement: 0, poor: 0, total: 0 })).toBeNull();
  });

  it('formats milliseconds as ms or s and keeps CLS unitless', () => {
    expect(vitalParts('lcp', 2242.11)).toEqual({ value: '2.24', unit: 's' });
    expect(vitalParts('inp', 161.79)).toEqual({ value: '162', unit: 'ms' });
    expect(vitalParts('cls', 0.0715)).toEqual({ value: '0.072', unit: '' });
    expect(vitalParts('ttfb', null)).toEqual({ value: '-', unit: '' });
  });
});

describe('percentChange', () => {
  it('has no change without a previous value to compare to', () => {
    expect(percentChange(10, 0)).toBeUndefined();
    expect(percentChange(10, undefined)).toBeUndefined();
    expect(percentChange(15, 10)).toBe(50);
  });
});
