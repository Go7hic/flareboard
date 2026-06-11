import { describe, expect, it } from 'vitest';
import { currentMonthKey, getPlan, normalizePlanId, planForPublic } from './billing';

describe('billing helpers', () => {
  it('normalizes legacy plan ids to cloud', () => {
    expect(normalizePlanId('hobby')).toBe('cloud');
    expect(normalizePlanId('pro')).toBe('cloud');
    expect(normalizePlanId('free')).toBe('free');
    expect(normalizePlanId(undefined)).toBe('free');
  });

  it('returns plan definitions', () => {
    const free = getPlan('free');
    const cloud = getPlan('cloud');
    expect(free.emailReportsEnabled).toBe(false);
    expect(free.heatmapsEnabled).toBe(false);
    expect(free.teamsEnabled).toBe(false);
    expect(free.maxWebsites).toBe(1);
    expect(cloud.maxWebsites).toBe(10);
    expect(cloud.replayEnabled).toBe(true);
    expect(cloud.emailReportsEnabled).toBe(true);
    expect(cloud.heatmapsEnabled).toBe(true);
    expect(cloud.teamsEnabled).toBe(true);
  });

  it('formats current month key in UTC', () => {
    expect(currentMonthKey(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03');
    expect(currentMonthKey(new Date('2025-12-31T23:59:59Z'))).toBe('2025-12');
  });

  it('strips stripe env keys from public plan shape', () => {
    const pub = planForPublic(getPlan('cloud'));
    expect(pub).toEqual({
      id: 'cloud',
      name: 'Cloud',
      maxWebsites: 10,
      maxEventsPerMonth: 1_000_000,
      replayEnabled: true,
      emailReportsEnabled: true,
      heatmapsEnabled: true,
      teamsEnabled: true,
      monthlyPriceUsd: 12,
    });
    expect('stripePriceEnvKey' in pub).toBe(false);
  });
});
