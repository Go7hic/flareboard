import { describe, expect, it } from 'vitest';
import { goalElapsedShare, goalPace, goalPeriodLengthMs, sharePercent } from './goal-metrics';
import { buildRetentionMatrix, RETENTION_RAMP, retentionRampStep } from './retention-matrix';

const DAY = 86_400_000;

describe('goal pace', () => {
  it('uses the calendar length of the month the period started in', () => {
    expect(goalPeriodLengthMs('monthly', Date.UTC(2026, 1, 1))).toBe(28 * DAY);
    expect(goalPeriodLengthMs('monthly', Date.UTC(2026, 9, 1))).toBe(31 * DAY);
    expect(goalPeriodLengthMs('weekly', 0)).toBe(7 * DAY);
    expect(goalPeriodLengthMs('daily', 0)).toBe(DAY);
  });

  it('clamps the elapsed share to the period', () => {
    const start = Date.UTC(2026, 9, 1);
    expect(goalElapsedShare('daily', start, start - DAY)).toBe(0);
    expect(goalElapsedShare('daily', start, start + DAY / 4)).toBeCloseTo(0.25);
    expect(goalElapsedShare('daily', start, start + 3 * DAY)).toBe(1);
  });

  it('is reached at the target, on track at pace, behind otherwise', () => {
    const start = Date.UTC(2026, 9, 1);
    const halfway = start + 3.5 * DAY;
    expect(goalPace({ count: 100, target: 100, period: 'weekly', periodStart: start, now: halfway }).status).toBe('reached');
    expect(goalPace({ count: 50, target: 100, period: 'weekly', periodStart: start, now: halfway }).status).toBe('onTrack');
    const behind = goalPace({ count: 40, target: 100, period: 'weekly', periodStart: start, now: halfway });
    expect(behind.status).toBe('behind');
    expect(behind.expected).toBeCloseTo(50);
  });

  it('returns null shares for an empty whole', () => {
    expect(sharePercent(3, 0)).toBeNull();
    expect(sharePercent(1, 4)).toBe(25);
  });
});

describe('retention matrix', () => {
  const now = Date.UTC(2026, 9, 3, 12); // Saturday 3 Oct 2026
  const rows = [
    { cohortWeek: '2026-09-13', weekOffset: 0, users: 200 },
    { cohortWeek: '2026-09-13', weekOffset: 1, users: 20 },
    { cohortWeek: '2026-09-13', weekOffset: 2, users: 10 },
    { cohortWeek: '2026-09-20', weekOffset: 0, users: 100 },
    { cohortWeek: '2026-09-27', weekOffset: 0, users: 50 },
  ];

  it('fills started weeks without rows with 0 and leaves future weeks empty', () => {
    const matrix = buildRetentionMatrix(rows, now);
    expect(matrix.offsets).toEqual([1, 2]);
    const [first, second, third] = matrix.cohorts;
    expect(first?.cells.map((cell) => cell.users)).toEqual([20, 10]);
    expect(second?.cells.map((cell) => cell.users)).toEqual([0, null]);
    expect(third?.cells.map((cell) => cell.users)).toEqual([null, null]);
    expect(first?.cells[1]?.inProgress).toBe(true);
    expect(first?.cells[0]?.inProgress).toBe(false);
  });

  it('weights averages by cohort size over cohorts that reached the week', () => {
    const matrix = buildRetentionMatrix(rows, now);
    expect(matrix.averages[0]?.pct).toBeCloseTo((20 / 300) * 100);
    expect(matrix.averages[0]?.cohorts).toBe(2);
    expect(matrix.averages[1]?.pct).toBeCloseTo(5);
    expect(matrix.totalUsers).toBe(350);
    expect(matrix.maxPct).toBeCloseTo(10);
  });

  it('maps shares onto the ramp relative to the maximum', () => {
    expect(retentionRampStep(null, 10)).toBe(0);
    expect(retentionRampStep(0, 10)).toBe(0);
    expect(retentionRampStep(10, 10)).toBe(RETENTION_RAMP[RETENTION_RAMP.length - 1]);
    expect(retentionRampStep(0.5, 10)).toBe(RETENTION_RAMP[0]);
  });
});
