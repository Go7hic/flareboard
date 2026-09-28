import { describe, expect, it } from 'vitest';
import {
  evaluateFeatureFlag,
  featureEnrollmentProperty,
  featureFlagNeedsServerEvaluation,
  featureFlagPayloadBytes,
  featureFlagTargetingNeeds,
  FEATURE_FLAG_PAYLOAD_MAX_BYTES,
  type FeatureFlagConditionGroup,
  type FeatureFlagConfigForEvaluation,
} from './feature-flag-evaluator';
import { normalizeFeatureFlagConfig, parsePayloadColumn, serializePayloadColumn } from './feature-flag-config';
import { rolloutBucket, variantBucket } from './flag-hash';
import { createFeatureFlagSchema, featureFlagTargetingRuleSchema, updateFeatureFlagSchema } from './schemas';

function flag(overrides: Partial<FeatureFlagConfigForEvaluation> = {}): FeatureFlagConfigForEvaluation {
  return { key: 'checkout.new_flow', enabled: true, ...overrides };
}

function group(overrides: Partial<FeatureFlagConditionGroup> = {}): FeatureFlagConditionGroup {
  return { conditions: [], rollout: 100, ...overrides };
}

/** Distinct ids whose rollout bucket for `key` is below / at or above `percent`. */
function idsAround(key: string, percent: number) {
  let inside: string | null = null;
  let outside: string | null = null;
  for (let i = 0; (!inside || !outside) && i < 10_000; i++) {
    const id = `user-${i}`;
    if (rolloutBucket(key, id) < percent) inside ??= id;
    else outside ??= id;
  }
  return { inside: inside!, outside: outside! };
}

describe('condition groups', () => {
  const groups = [
    group({ conditions: [{ field: 'path', operator: 'contains', value: '/pricing' }] }),
    group({ conditions: [{ field: 'property', key: 'plan', operator: 'equals', value: 'pro' }] }),
  ];

  it('ORs groups and reports the group that matched', () => {
    const first = evaluateFeatureFlag(flag({ conditionGroups: groups }), { distinctId: 'u', path: '/pricing' });
    expect(first).toMatchObject({ enabled: true, reason: 'match', conditionGroup: 0, variant: 'test' });

    const second = evaluateFeatureFlag(flag({ conditionGroups: groups }), {
      distinctId: 'u',
      path: '/home',
      properties: { plan: 'pro' },
    });
    expect(second).toMatchObject({ enabled: true, reason: 'match', conditionGroup: 1 });
  });

  it('is off with targeting_mismatch when no group matches', () => {
    const result = evaluateFeatureFlag(flag({ conditionGroups: groups }), { distinctId: 'u', path: '/home' });
    expect(result).toMatchObject({
      enabled: false,
      matched: false,
      variant: 'control',
      reason: 'targeting_mismatch',
      conditionGroup: null,
      payload: null,
    });
  });

  it('applies each group rollout to the canonical rollout bucket', () => {
    const key = 'checkout.new_flow';
    const { inside, outside } = idsAround(key, 30);
    const config = flag({ conditionGroups: [group({ rollout: 30 })] });
    expect(evaluateFeatureFlag(config, { distinctId: inside })).toMatchObject({ enabled: true, conditionGroup: 0 });
    expect(evaluateFeatureFlag(config, { distinctId: outside })).toMatchObject({
      enabled: false,
      matched: true,
      reason: 'rollout_miss',
      conditionGroup: 0,
    });
  });

  it('lets a caller outside one group rollout match a later group', () => {
    const { outside } = idsAround('checkout.new_flow', 30);
    const config = flag({
      conditionGroups: [
        group({ rollout: 30 }),
        group({ conditions: [{ field: 'environment', operator: 'equals', value: 'staging' }], rollout: 100 }),
      ],
    });
    expect(evaluateFeatureFlag(config, { distinctId: outside, environment: 'staging' })).toMatchObject({
      enabled: true,
      conditionGroup: 1,
    });
    expect(evaluateFeatureFlag(config, { distinctId: outside, environment: 'production' })).toMatchObject({
      enabled: false,
      reason: 'rollout_miss',
      conditionGroup: 0,
    });
  });

  it('never serves a group at 0%', () => {
    const config = flag({ conditionGroups: [group({ rollout: 0 })] });
    for (let i = 0; i < 50; i++) {
      expect(evaluateFeatureFlag(config, { distinctId: `id-${i}` }).enabled).toBe(false);
    }
  });

  it('serves the group variant override, and the weighted split otherwise', () => {
    const variants = [
      { key: 'a', name: 'A', weight: 50 },
      { key: 'b', name: 'B', weight: 50 },
    ];
    const config = flag({
      variants,
      conditionGroups: [
        group({ conditions: [{ field: 'person', key: 'beta', operator: 'equals', value: 'true' }], variant: 'b' }),
        group(),
      ],
    });
    for (let i = 0; i < 40; i++) {
      const distinctId = `person-${i}`;
      const beta = evaluateFeatureFlag(config, { distinctId, personProperties: { beta: true } });
      expect(beta).toMatchObject({ enabled: true, variant: 'b', conditionGroup: 0 });

      const everyone = evaluateFeatureFlag(config, { distinctId });
      expect(everyone.conditionGroup).toBe(1);
      expect(everyone.variant).toBe(variantBucket('checkout.new_flow', distinctId) < 50 ? 'a' : 'b');
    }
  });

  it('ignores an override that names no variant', () => {
    const config = flag({
      variants: [{ key: 'a', name: 'A', weight: 100 }],
      conditionGroups: [group({ variant: 'gone' })],
    });
    expect(evaluateFeatureFlag(config, { distinctId: 'x' }).variant).toBe('a');
  });

  it('falls back to the legacy targeting rules and rollout when there are no groups', () => {
    const { inside, outside } = idsAround('legacy.flag', 40);
    const legacy = {
      key: 'legacy.flag',
      enabled: true,
      rollout: 40,
      targetingRules: [{ field: 'language' as const, operator: 'starts_with' as const, value: 'en' }],
    };
    expect(evaluateFeatureFlag(legacy, { distinctId: inside, language: 'en-US' }).enabled).toBe(true);
    expect(evaluateFeatureFlag(legacy, { distinctId: outside, language: 'en-US' }).reason).toBe('rollout_miss');
    expect(evaluateFeatureFlag(legacy, { distinctId: inside, language: 'de' }).reason).toBe('targeting_mismatch');
  });
});

describe('payloads', () => {
  it('returns the flag payload for boolean flags only while on', () => {
    const config = flag({ payload: { banner: 'Hello' }, conditionGroups: [group({ rollout: 100 })] });
    expect(evaluateFeatureFlag(config, { distinctId: 'x' }).payload).toEqual({ banner: 'Hello' });
    expect(evaluateFeatureFlag({ ...config, enabled: false }, { distinctId: 'x' }).payload).toBeNull();
  });

  it('returns the served variant payload for multivariate flags', () => {
    const config = flag({
      payload: 'ignored for multivariate flags',
      variants: [
        { key: 'a', name: 'A', weight: 0, payload: { color: 'red' } },
        { key: 'b', name: 'B', weight: 100 },
      ],
      conditionGroups: [group({ conditions: [{ field: 'path', operator: 'equals', value: '/a' }], variant: 'a' }), group()],
    });
    expect(evaluateFeatureFlag(config, { distinctId: 'x', path: '/a' })).toMatchObject({
      variant: 'a',
      payload: { color: 'red' },
    });
    expect(evaluateFeatureFlag(config, { distinctId: 'x', path: '/b' })).toMatchObject({ variant: 'b', payload: null });
  });

  it('measures payloads as UTF-8 JSON and rejects what JSON cannot carry', () => {
    expect(featureFlagPayloadBytes({ a: 1 })).toBe(7);
    expect(featureFlagPayloadBytes('用户')).toBe(8);
    expect(featureFlagPayloadBytes(null)).toBe(4);
    expect(featureFlagPayloadBytes(undefined)).toBeNull();
    expect(featureFlagPayloadBytes(Number.NaN)).toBeNull();
    expect(featureFlagPayloadBytes(() => 1)).toBeNull();
  });

  it('round-trips payloads through the raw column, including JSON strings', () => {
    for (const value of ['plain text', 42, false, [1, 'two'], { nested: { ok: true } }]) {
      expect(parsePayloadColumn(serializePayloadColumn(value))).toEqual(value);
    }
    expect(serializePayloadColumn(null)).toBeNull();
    expect(parsePayloadColumn('null')).toBeNull();
    expect(parsePayloadColumn('{not json')).toBeNull();
  });
});

describe('targeting sources', () => {
  it('reads person properties separately from request properties', () => {
    const config = flag({
      conditionGroups: [group({ conditions: [{ field: 'person', key: 'plan', operator: 'equals', value: 'enterprise' }] })],
    });
    expect(evaluateFeatureFlag(config, { distinctId: 'x', personProperties: { plan: 'Enterprise' } }).enabled).toBe(
      true,
    );
    expect(evaluateFeatureFlag(config, { distinctId: 'x', properties: { plan: 'enterprise' } }).enabled).toBe(false);
  });

  it('reads group properties of the caller group type', () => {
    const config = flag({
      conditionGroups: [
        group({
          conditions: [{ field: 'group_property', groupType: 'company', key: 'seats', operator: 'greater_than', value: '50' }],
        }),
      ],
    });
    expect(evaluateFeatureFlag(config, { distinctId: 'x', groupProperties: { company: { seats: 120 } } }).enabled).toBe(
      true,
    );
    expect(evaluateFeatureFlag(config, { distinctId: 'x', groupProperties: { team: { seats: 120 } } }).enabled).toBe(
      false,
    );
  });

  it('matches cohort membership resolved by the server and fails closed when unknown', () => {
    const inCohort = flag({
      conditionGroups: [group({ conditions: [{ field: 'cohort', operator: 'in_cohort', value: 'c1' }] })],
    });
    const notInCohort = flag({
      conditionGroups: [group({ conditions: [{ field: 'cohort', operator: 'not_in_cohort', value: 'c1' }] })],
    });
    expect(evaluateFeatureFlag(inCohort, { distinctId: 'x', cohorts: { c1: true } }).enabled).toBe(true);
    expect(evaluateFeatureFlag(inCohort, { distinctId: 'x', cohorts: { c1: false } }).enabled).toBe(false);
    expect(evaluateFeatureFlag(notInCohort, { distinctId: 'x', cohorts: { c1: false } }).enabled).toBe(true);
    expect(evaluateFeatureFlag(inCohort, { distinctId: 'x' }).enabled).toBe(false);
    expect(evaluateFeatureFlag(notInCohort, { distinctId: 'x' }).enabled).toBe(false);
  });

  it('fails closed on unknown fields and on numeric comparisons with no value', () => {
    const unknownField = flag({
      conditionGroups: [group({ conditions: [{ field: 'cohorts' as never, operator: 'not_exists', value: '' }] })],
    });
    expect(evaluateFeatureFlag(unknownField, { distinctId: 'x' }).enabled).toBe(false);

    const lessThan = flag({
      conditionGroups: [group({ conditions: [{ field: 'person', key: 'age', operator: 'less_than', value: '30' }] })],
    });
    expect(evaluateFeatureFlag(lessThan, { distinctId: 'x', personProperties: {} }).enabled).toBe(false);
    expect(evaluateFeatureFlag(lessThan, { distinctId: 'x', personProperties: { age: 21 } }).enabled).toBe(true);
  });

  it('lists what the server must load before evaluating', () => {
    const needs = featureFlagTargetingNeeds([
      flag({
        conditionGroups: [
          group({ conditions: [{ field: 'cohort', operator: 'in_cohort', value: 'c1' }] }),
          group({ conditions: [{ field: 'group_property', groupType: 'company', key: 'plan', operator: 'exists', value: '' }] }),
        ],
      }),
      flag({ key: 'early', earlyAccess: true }),
    ]);
    expect(needs).toEqual({ personProperties: true, groups: true, groupTypes: ['company'], cohortIds: ['c1'] });
  });
});

describe('early access enrollment', () => {
  const property = featureEnrollmentProperty('checkout.new_flow');
  const config = flag({
    earlyAccess: true,
    payload: { beta: true },
    conditionGroups: [group({ conditions: [{ field: 'person', key: 'staff', operator: 'equals', value: 'true' }] })],
  });

  it('forces the flag on for enrolled people before any group', () => {
    for (const enrolled of [true, 'true', 1]) {
      expect(evaluateFeatureFlag(config, { distinctId: 'x', personProperties: { [property]: enrolled } })).toMatchObject(
        { enabled: true, reason: 'early_access_enrolled', conditionGroup: null, payload: { beta: true } },
      );
    }
  });

  it('keeps the flag off for people who opted out, even when a group matches', () => {
    expect(
      evaluateFeatureFlag(config, { distinctId: 'x', personProperties: { [property]: false, staff: 'true' } }),
    ).toMatchObject({ enabled: false, reason: 'early_access_opted_out' });
  });

  it('falls through to the groups when no choice is stored', () => {
    expect(evaluateFeatureFlag(config, { distinctId: 'x', personProperties: { staff: 'true' } }).reason).toBe('match');
    expect(evaluateFeatureFlag(config, { distinctId: 'x', personProperties: {} }).reason).toBe('targeting_mismatch');
  });

  it('is ignored when the flag is not an early access feature or is disabled', () => {
    const personProperties = { [property]: true };
    expect(evaluateFeatureFlag({ ...config, earlyAccess: false }, { distinctId: 'x', personProperties }).enabled).toBe(
      false,
    );
    expect(evaluateFeatureFlag({ ...config, enabled: false }, { distinctId: 'x', personProperties }).reason).toBe(
      'disabled',
    );
  });
});

describe('featureFlagNeedsServerEvaluation', () => {
  it('lets the tracker evaluate only a single unconditional group without override', () => {
    expect(featureFlagNeedsServerEvaluation(flag({ conditionGroups: [group({ rollout: 20 })] }))).toBe(false);
    expect(featureFlagNeedsServerEvaluation(flag({ rollout: 50 }))).toBe(false);
    expect(featureFlagNeedsServerEvaluation(flag({ conditionGroups: [group(), group()] }))).toBe(true);
    expect(featureFlagNeedsServerEvaluation(flag({ conditionGroups: [group({ variant: 'a' })] }))).toBe(true);
    expect(
      featureFlagNeedsServerEvaluation(
        flag({ conditionGroups: [group({ conditions: [{ field: 'path', operator: 'equals', value: '/' }] })] }),
      ),
    ).toBe(true);
    expect(featureFlagNeedsServerEvaluation(flag({ earlyAccess: true }))).toBe(true);
  });
});

describe('normalizeFeatureFlagConfig', () => {
  it('turns a legacy row into one group and parses JSON columns', () => {
    const config = normalizeFeatureFlagConfig({
      key: 'legacy',
      enabled: 1,
      rollout: 35,
      variants: JSON.stringify([{ key: 'a', name: 'A', weight: 60, payload: { x: 1 } }, { weight: 10 }]),
      targetingRules: JSON.stringify([{ field: 'path', operator: 'equals', value: '/' }]),
      conditionGroups: null,
      payload: null,
      earlyAccess: 0,
    });
    expect(config).toMatchObject({
      enabled: true,
      earlyAccess: false,
      payload: null,
      variants: [{ key: 'a', name: 'A', weight: 60, payload: { x: 1 } }],
      conditionGroups: [{ conditions: [{ field: 'path', operator: 'equals', value: '/' }], rollout: 35 }],
    });
  });

  it('prefers stored condition groups and survives malformed JSON', () => {
    const config = normalizeFeatureFlagConfig({
      key: 'k',
      enabled: true,
      rollout: 10,
      targetingRules: '[{"field":"path"',
      conditionGroups: [{ conditions: [], rollout: 150, variant: 'b' }],
      payload: '"hello"',
      earlyAccess: true,
    });
    expect(config.conditionGroups).toEqual([{ conditions: [], rollout: 100, variant: 'b' }]);
    expect(config.payload).toBe('hello');
    expect(config.earlyAccess).toBe(true);
  });
});

describe('feature flag schemas', () => {
  it('caps payloads at 16 KB', () => {
    const big = 'x'.repeat(FEATURE_FLAG_PAYLOAD_MAX_BYTES);
    const base = { key: 'k', name: 'K' };
    expect(createFeatureFlagSchema.safeParse({ ...base, payload: big.slice(0, 1000) }).success).toBe(true);
    const tooBig = createFeatureFlagSchema.safeParse({ ...base, payload: big });
    expect(tooBig.success).toBe(false);
    expect(
      updateFeatureFlagSchema.safeParse({ variants: [{ key: 'a', name: 'A', weight: 50, payload: { big } }] }).success,
    ).toBe(false);
  });

  it('rejects variant weights above 100 and duplicate keys', () => {
    expect(
      updateFeatureFlagSchema.safeParse({
        variants: [
          { key: 'a', name: 'A', weight: 60 },
          { key: 'b', name: 'B', weight: 50 },
        ],
      }).success,
    ).toBe(false);
    expect(
      updateFeatureFlagSchema.safeParse({
        variants: [
          { key: 'a', name: 'A', weight: 10 },
          { key: 'a', name: 'A again', weight: 10 },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates the new condition kinds', () => {
    const ok = (rule: unknown) => featureFlagTargetingRuleSchema.safeParse(rule).success;
    expect(ok({ field: 'person', key: 'plan', operator: 'equals', value: 'pro' })).toBe(true);
    expect(ok({ field: 'person', operator: 'equals', value: 'pro' })).toBe(false);
    expect(ok({ field: 'group_property', groupType: 'company', key: 'plan', operator: 'equals', value: 'pro' })).toBe(
      true,
    );
    expect(ok({ field: 'group_property', key: 'plan', operator: 'equals', value: 'pro' })).toBe(false);
    expect(ok({ field: 'cohort', operator: 'in_cohort', value: 'c1' })).toBe(true);
    expect(ok({ field: 'cohort', operator: 'equals', value: 'c1' })).toBe(false);
    expect(ok({ field: 'cohort', operator: 'in_cohort', value: '' })).toBe(false);
    expect(ok({ field: 'path', operator: 'in_cohort', value: 'c1' })).toBe(false);
  });

  it('requires at least one condition group when groups are given', () => {
    expect(createFeatureFlagSchema.safeParse({ key: 'k', name: 'K', conditionGroups: [] }).success).toBe(false);
    const parsed = createFeatureFlagSchema.parse({ key: 'k', name: 'K', conditionGroups: [{ conditions: [] }] });
    expect(parsed.conditionGroups).toEqual([{ conditions: [], rollout: 100 }]);
  });
});
