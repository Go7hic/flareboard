import { describe, expect, it } from 'vitest';
import {
  WEBSITE_SAFETY_CAP,
  currentMonthKey,
  getPlan,
  isUnlimitedWebsites,
  normalizePlanId,
  planForPublic,
  websiteLimitForEnforcement,
} from './billing';

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
    expect(free.dataPortabilityEnabled).toBe(false);
    expect(free.warehouseEnabled).toBe(false);
    expect(free.experimentationEnabled).toBe(false);
    expect(free.surveysEnabled).toBe(false);
    expect(free.maxWebsites).toBe(1);
    expect(cloud.maxWebsites).toBeNull();
    expect(isUnlimitedWebsites(free)).toBe(false);
    expect(isUnlimitedWebsites(cloud)).toBe(true);
    expect(websiteLimitForEnforcement(free)).toBe(1);
    expect(websiteLimitForEnforcement(cloud)).toBe(WEBSITE_SAFETY_CAP);
    expect(cloud.replayEnabled).toBe(true);
    expect(cloud.emailReportsEnabled).toBe(true);
    expect(cloud.heatmapsEnabled).toBe(true);
    expect(cloud.teamsEnabled).toBe(true);
    expect(cloud.dataPortabilityEnabled).toBe(true);
    expect(cloud.warehouseEnabled).toBe(true);
    expect(cloud.experimentationEnabled).toBe(true);
    expect(cloud.surveysEnabled).toBe(true);
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
      maxWebsites: null,
      maxEventsPerMonth: 1_000_000,
      maxReplaysPerMonth: 5_000,
      maxOtelRowsPerMonth: 500_000,
      maxRetentionDays: 730,
      usageGraceMultiple: 1.2,
      replayEnabled: true,
      emailReportsEnabled: true,
      heatmapsEnabled: true,
      teamsEnabled: true,
      dataPortabilityEnabled: true,
      warehouseEnabled: true,
      experimentationEnabled: true,
      surveysEnabled: true,
      monthlyPriceUsd: 19,
    });
    expect('stripePriceEnvKey' in pub).toBe(false);
  });
});
