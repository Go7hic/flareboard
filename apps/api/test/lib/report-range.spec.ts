import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNEY_LIMIT,
  MAX_JOURNEY_LIMIT,
  MAX_REPORT_RANGE_MS,
  clampJourneyLimit,
  clampReportRange,
} from '../../src/lib/report-range';

describe('clampReportRange', () => {
  it('clamps endAt to now', () => {
    const future = Date.now() + 86_400_000;
    const { endAt } = clampReportRange(1_700_000_000_000, future);
    expect(endAt).toBeLessThanOrEqual(Date.now());
  });

  it('limits range to MAX_REPORT_RANGE_MS', () => {
    const endAt = 1_800_000_000_000;
    const startAt = endAt - MAX_REPORT_RANGE_MS - 86_400_000;
    const result = clampReportRange(startAt, endAt);
    expect(result.endAt - result.startAt).toBeLessThanOrEqual(MAX_REPORT_RANGE_MS);
  });

  it('falls back to 30 days when start >= end', () => {
    const now = Date.now();
    const endAt = now - 60_000;
    const startAt = now;
    const result = clampReportRange(startAt, endAt);
    expect(result.endAt - result.startAt).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('clampJourneyLimit', () => {
  it('returns default for invalid values', () => {
    expect(clampJourneyLimit(0)).toBe(DEFAULT_JOURNEY_LIMIT);
    expect(clampJourneyLimit(-5)).toBe(DEFAULT_JOURNEY_LIMIT);
    expect(clampJourneyLimit(Number.NaN)).toBe(DEFAULT_JOURNEY_LIMIT);
  });

  it('caps at MAX_JOURNEY_LIMIT', () => {
    expect(clampJourneyLimit(500)).toBe(MAX_JOURNEY_LIMIT);
    expect(clampJourneyLimit(12.7)).toBe(12);
  });
});
