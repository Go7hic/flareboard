import { describe, expect, it } from 'vitest';
import { PLAN_IDS, PLANS, planForPublic } from '../../../../packages/shared/src/billing';
import { BILLING_PLAN_IDS } from './api';
import { LANDING_PLANS, usageGracePercent } from './landing-links';

describe('LANDING_PLANS', () => {
  it('lists the hosted plans in the same order as the API', () => {
    expect(LANDING_PLANS.map((plan) => plan.id)).toEqual([...PLAN_IDS]);
    expect([...BILLING_PLAN_IDS]).toEqual([...PLAN_IDS]);
  });

  it('matches the plan definitions the API enforces', () => {
    for (const plan of LANDING_PLANS) {
      expect(plan).toMatchObject(planForPublic(PLANS[plan.id]));
    }
  });
});

describe('usageGracePercent', () => {
  it('turns the grace multiple into a percentage over the allowance', () => {
    expect(usageGracePercent({ usageGraceMultiple: 1.2 })).toBe(20);
    expect(usageGracePercent({ usageGraceMultiple: 1 })).toBe(0);
  });
});
