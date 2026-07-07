import { describe, expect, it } from 'vitest';
import {
  evaluateFeatureFlag,
  type FeatureFlagEvaluationContext,
  type FeatureFlagRule,
} from '@flareboard/shared';

const baseContext: FeatureFlagEvaluationContext = {
  distinctId: 'user-123',
  userId: 'account-owner',
  path: '/pricing',
  url: 'https://example.com/pricing?plan=pro',
  hostname: 'example.com',
  referrer: 'https://google.com/search',
  language: 'zh-CN',
  userAgent: 'Mozilla/5.0',
  environment: 'production',
  release: '2.1.0',
  groups: { account: 'acme' },
  properties: { plan: 'pro', seats: 12 },
};

function flag(targetingRules: FeatureFlagRule[] = []) {
  return {
    key: 'checkout.new_flow',
    enabled: true,
    rollout: 100,
    variants: [
      { key: 'variant_a', name: 'Variant A', weight: 50 },
      { key: 'variant_b', name: 'Variant B', weight: 50 },
    ],
    targetingRules,
  };
}

describe('evaluateFeatureFlag', () => {
  it('matches richer targeting fields and returns a stable variant', () => {
    const result = evaluateFeatureFlag(
      flag([
        { field: 'environment', operator: 'equals', value: 'production' },
        { field: 'release', operator: 'starts_with', value: '2.' },
        { field: 'userId', operator: 'equals', value: 'account-owner' },
        { field: 'distinctId', operator: 'contains', value: 'user' },
        { field: 'group', key: 'account', operator: 'equals', value: 'acme' },
        { field: 'property', key: 'plan', operator: 'equals', value: 'pro' },
      ]),
      baseContext,
    );

    expect(result.matched).toBe(true);
    expect(['variant_a', 'variant_b']).toContain(result.variant);
    expect(evaluateFeatureFlag(flag(), baseContext).variant).toBe(result.variant);
  });

  it('returns control when a targeting rule does not match', () => {
    const result = evaluateFeatureFlag(
      flag([{ field: 'property', key: 'plan', operator: 'equals', value: 'enterprise' }]),
      baseContext,
    );

    expect(result).toMatchObject({
      enabled: false,
      matched: false,
      variant: 'control',
      reason: 'targeting_mismatch',
    });
  });

  it('supports numeric comparisons for properties', () => {
    expect(
      evaluateFeatureFlag(
        flag([{ field: 'property', key: 'seats', operator: 'greater_than_or_equal', value: '10' }]),
        baseContext,
      ).matched,
    ).toBe(true);
    expect(
      evaluateFeatureFlag(
        flag([{ field: 'property', key: 'seats', operator: 'less_than', value: '10' }]),
        baseContext,
      ).matched,
    ).toBe(false);
  });
});
