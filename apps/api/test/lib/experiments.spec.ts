import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ExperimentMetric } from '@flareboard/shared';
import {
  requiredSampleSizeForProportion,
  twoProportionZTest,
  type ExperimentAllocation,
} from '@flareboard/shared/experiment-stats';
import type { Env } from '../../src/env';
import { getExperimentResults, type ExperimentAnalysisInput } from '../../src/lib/experiments';
import { exposure, seedAnalytics, type SeedEvent, type SeedSession } from '../helpers/experiment-seed';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 1, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const HALF_SPLIT: ExperimentAllocation = { enabled: true, rollout: 50, variants: [], targeted: false };

function analyze(overrides: Partial<ExperimentAnalysisInput> & Pick<ExperimentAnalysisInput, 'flagKey'>) {
  const input: ExperimentAnalysisInput = {
    startAt: BASE,
    endAt: BASE + 7 * DAY,
    primaryMetric: { type: 'conversion', event: 'checkout_completed' },
    secondaryMetrics: [],
    allocation: HALF_SPLIT,
    minimumDetectableEffect: 0.1,
    now: BASE + 7 * DAY,
    ...overrides,
  };
  return getExperimentResults(env as unknown as Env, TEST_WEBSITE_ID, input);
}

function metricRow(result: Awaited<ReturnType<typeof analyze>>, metricIndex: number, variant: string) {
  const row = result.metrics[metricIndex]!.variants.find((item) => item.variant === variant);
  if (!row) throw new Error(`missing ${variant} in metric ${metricIndex}`);
  return row;
}

describe('getExperimentResults', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('counts every exposed unit (far past the old 500-exposure cap) and conversions without $feature/*', async () => {
    const flagKey = 'exp.scale';
    const sessions: SeedSession[] = [];
    const events: SeedEvent[] = [];
    for (let i = 0; i < 700; i++) {
      const variant = i % 2 === 0 ? 'control' : 'test';
      const sessionId = `scale-${i}`;
      sessions.push({ id: sessionId, createdAt: BASE });
      events.push(exposure(`scale-exp-${i}`, sessionId, flagKey, variant, BASE + i * 60_000));
      // A second page load re-exposes the same session: still one unit.
      events.push(exposure(`scale-exp2-${i}`, sessionId, flagKey, variant, BASE + i * 60_000 + 5_000));
      const armIndex = Math.floor(i / 2);
      const converts = variant === 'control' ? armIndex % 10 < 2 : armIndex % 10 < 3;
      if (converts) {
        events.push({ id: `scale-goal-${i}`, sessionId, name: 'checkout_completed', createdAt: BASE + i * 60_000 + 30_000 });
      }
    }
    await seedAnalytics(TEST_WEBSITE_ID, { sessions, events });

    const result = await analyze({ flagKey });

    expect(result.summary.totalUnits).toBe(700);
    expect(result.summary.excludedUnits).toBe(0);
    expect(result.variants).toEqual([
      { variant: 'control', baseline: true, units: 350, share: 0.5, expectedShare: 0.5 },
      { variant: 'test', baseline: false, units: 350, share: 0.5, expectedShare: 0.5 },
    ]);
    const control = metricRow(result, 0, 'control');
    const test = metricRow(result, 0, 'test');
    expect(control).toMatchObject({ sampleSize: 350, total: 70, value: 0.2, comparison: null });
    expect(test).toMatchObject({ sampleSize: 350, total: 105, value: 0.3 });
    const reference = twoProportionZTest({ n: 350, successes: 70 }, { n: 350, successes: 105 });
    expect(test.comparison!.frequentist.pValue).toBeCloseTo(reference.pValue!, 12);
    expect(test.comparison!.frequentist.significant).toBe(true);
    expect(test.comparison!.lift).toBeCloseTo(0.5, 12);
    expect(test.comparison!.bayesian.probabilityToBeatControl).toBeGreaterThan(0.99);
    expect(result.srm).toMatchObject({ status: 'ok', pValue: 1 });
    expect(result.summary).toMatchObject({
      decision: 'ship_variant',
      significantVariant: 'test',
      leaderVariant: 'test',
      bayesianLeader: 'test',
      minimumSampleReached: true,
    });
    expect(result.summary.diagnostics).toContainEqual({ code: 'significant_variant', level: 'success' });

    const required = requiredSampleSizeForProportion(0.2, 0.1)!;
    expect(result.guidance).toMatchObject({
      metricType: 'conversion',
      baseline: 0.2,
      requiredUnitsPerVariant: required,
      currentUnitsPerVariant: 350,
      minimumDetectableEffect: 0.1,
    });
    // 350 units per arm in 7 days = 50/day.
    expect(result.guidance!.estimatedDaysRemaining).toBe(Math.ceil((required - 350) / 50));
    expect(result.trend.reduce((sum, row) => sum + row.units, 0)).toBe(700);
    expect(result.recent).toHaveLength(20);
    expect(result.recent[0]).toMatchObject({ id: 'scale-exp-699', sessionId: 'scale-699', variant: 'test' });
  });

  it('dedups by distinct id across sessions and only counts conversions after the first exposure', async () => {
    const flagKey = 'exp.identity';
    const t0 = BASE + HOUR;
    await seedAnalytics(TEST_WEBSITE_ID, {
      sessions: [
        { id: 'id-u1-a', distinctId: 'user-1', createdAt: t0 },
        { id: 'id-u1-b', distinctId: 'user-1', createdAt: t0 },
        { id: 'id-u1-c', distinctId: 'user-1', createdAt: t0 },
        { id: 'id-u2-a', distinctId: 'user-2', createdAt: t0 },
        { id: 'id-u2-b', distinctId: 'user-2', createdAt: t0 },
        { id: 'id-u3-a', distinctId: 'user-3', createdAt: t0 },
        { id: 'id-anon', createdAt: t0 },
      ],
      events: [
        // user-1: three sessions, one unit; converts in a session other than the exposure's.
        exposure('id-u1-exp-a', 'id-u1-a', flagKey, 'control', t0),
        exposure('id-u1-exp-b', 'id-u1-b', flagKey, 'control', t0 + HOUR),
        exposure('id-u1-exp-c', 'id-u1-c', flagKey, 'control', t0 + 2 * HOUR),
        { id: 'id-u1-goal', sessionId: 'id-u1-c', name: 'checkout_completed', createdAt: t0 + 3 * HOUR },
        // user-2: exposed in one session, converts in another.
        exposure('id-u2-exp', 'id-u2-a', flagKey, 'control', t0 + 10),
        { id: 'id-u2-goal', sessionId: 'id-u2-b', name: 'checkout_completed', createdAt: t0 + DAY },
        // anonymous session: converted before exposure and after the window, neither counts.
        { id: 'id-anon-goal-early', sessionId: 'id-anon', name: 'checkout_completed', createdAt: t0 - 1 },
        exposure('id-anon-exp', 'id-anon', flagKey, 'test', t0),
        { id: 'id-anon-goal-late', sessionId: 'id-anon', name: 'checkout_completed', createdAt: BASE + 8 * DAY },
        // user-3: an exposure before the window start does not decide the variant.
        exposure('id-u3-exp-old', 'id-u3-a', flagKey, 'control', BASE - DAY),
        exposure('id-u3-exp', 'id-u3-a', flagKey, 'test', t0 + 5),
      ],
    });

    const result = await analyze({ flagKey });

    expect(result.summary).toMatchObject({ totalUnits: 4, excludedUnits: 0 });
    expect(metricRow(result, 0, 'control')).toMatchObject({ sampleSize: 2, total: 2, value: 1 });
    expect(metricRow(result, 0, 'test')).toMatchObject({ sampleSize: 2, total: 0, value: 0 });
    const user1 = result.recent.find((item) => item.id === 'id-u1-exp-a');
    expect(user1).toEqual({
      id: 'id-u1-exp-a',
      sessionId: 'id-u1-a',
      variant: 'control',
      urlPath: '/',
      exposedAt: t0,
      converted: true,
      convertedAt: t0 + 3 * HOUR,
    });
    expect(result.recent.find((item) => item.id === 'id-anon-exp')).toMatchObject({ converted: false, convertedAt: null });
    expect(result.recent.map((item) => item.id)).not.toContain('id-u1-exp-b');
  });

  it('excludes units exposed to more than one variant and ignores non-arm responses', async () => {
    const flagKey = 'exp.mixed';
    const t0 = BASE + 2 * HOUR;
    await seedAnalytics(TEST_WEBSITE_ID, {
      sessions: [
        { id: 'mix-a', distinctId: 'mixed-user', createdAt: t0 },
        { id: 'mix-b', distinctId: 'mixed-user', createdAt: t0 },
        { id: 'mix-c', createdAt: t0 },
        { id: 'mix-d', createdAt: t0 },
        { id: 'mix-off', createdAt: t0 },
      ],
      events: [
        exposure('mix-exp-a', 'mix-a', flagKey, 'control', t0),
        exposure('mix-exp-b', 'mix-b', flagKey, 'test', t0 + HOUR),
        { id: 'mix-goal', sessionId: 'mix-b', name: 'checkout_completed', createdAt: t0 + 2 * HOUR },
        exposure('mix-exp-c', 'mix-c', flagKey, 'control', t0),
        exposure('mix-exp-d', 'mix-d', flagKey, 'test', t0),
        { id: 'mix-goal-d', sessionId: 'mix-d', name: 'checkout_completed', createdAt: t0 + HOUR },
        exposure('mix-exp-off', 'mix-off', flagKey, 'false', t0),
        { id: 'mix-goal-off', sessionId: 'mix-off', name: 'checkout_completed', createdAt: t0 + HOUR },
      ],
    });

    const result = await analyze({ flagKey });

    expect(result.summary).toMatchObject({ totalUnits: 2, excludedUnits: 1 });
    expect(result.variants.map((row) => [row.variant, row.units])).toEqual([
      ['control', 1],
      ['test', 1],
    ]);
    expect(metricRow(result, 0, 'control')).toMatchObject({ total: 0 });
    expect(metricRow(result, 0, 'test')).toMatchObject({ total: 1 });
    expect(result.recent.map((item) => item.id).sort()).toEqual(['mix-exp-c', 'mix-exp-d']);
  });

  it('computes count, property sum and property mean secondary metrics per unit', async () => {
    const flagKey = 'exp.metrics';
    const t0 = BASE + 3 * HOUR;
    const purchase = (id: string, sessionId: string, at: number, revenue?: number): SeedEvent => ({
      id,
      sessionId,
      name: 'purchase',
      createdAt: at,
      data: revenue == null ? { plan: 'pro' } : { revenue, plan: 'pro' },
    });
    const click = (id: string, sessionId: string, at: number): SeedEvent => ({
      id,
      sessionId,
      name: 'page_click',
      createdAt: at,
    });
    await seedAnalytics(TEST_WEBSITE_ID, {
      sessions: ['c1', 'c2', 'c3', 't1', 't2', 't3'].map((id) => ({ id: `met-${id}`, createdAt: t0 })),
      events: [
        exposure('met-exp-c1', 'met-c1', flagKey, 'control', t0),
        exposure('met-exp-c2', 'met-c2', flagKey, 'control', t0),
        exposure('met-exp-c3', 'met-c3', flagKey, 'control', t0),
        exposure('met-exp-t1', 'met-t1', flagKey, 'test', t0),
        exposure('met-exp-t2', 'met-t2', flagKey, 'test', t0),
        exposure('met-exp-t3', 'met-t3', flagKey, 'test', t0),
        purchase('met-early', 'met-c2', t0 - HOUR, 999),
        purchase('met-c1-p1', 'met-c1', t0 + 1, 10),
        purchase('met-c1-p2', 'met-c1', t0 + 2, 30),
        click('met-c2-k1', 'met-c2', t0 + 1),
        click('met-c2-k2', 'met-c2', t0 + 2),
        click('met-c2-k3', 'met-c2', t0 + 3),
        purchase('met-c3-p1', 'met-c3', t0 + 1, 20),
        click('met-c3-k1', 'met-c3', t0 + 2),
        purchase('met-t1-p1', 'met-t1', t0 + 1, 50),
        purchase('met-t2-p1', 'met-t2', t0 + 1),
      ],
    });

    const secondaryMetrics: ExperimentMetric[] = [
      { type: 'count', event: 'page_click' },
      { type: 'property_sum', event: 'purchase', property: 'revenue' },
      { type: 'property_mean', event: 'purchase', property: 'revenue' },
    ];
    const result = await analyze({
      flagKey,
      primaryMetric: { type: 'conversion', event: 'purchase' },
      secondaryMetrics,
    });

    expect(result.metrics.map((metric) => [metric.role, metric.metric.type])).toEqual([
      ['primary', 'conversion'],
      ['secondary', 'count'],
      ['secondary', 'property_sum'],
      ['secondary', 'property_mean'],
    ]);
    expect(metricRow(result, 0, 'control')).toMatchObject({ sampleSize: 3, total: 2 });
    expect(metricRow(result, 0, 'control').value).toBeCloseTo(2 / 3, 12);
    expect(metricRow(result, 0, 'test').value).toBeCloseTo(2 / 3, 12);

    // Clicks per unit: control [0, 3, 1], test [0, 0, 0].
    const clicks = metricRow(result, 1, 'control');
    expect(clicks).toMatchObject({ sampleSize: 3, total: 4 });
    expect(clicks.value).toBeCloseTo(4 / 3, 12);
    expect(clicks.standardDeviation).toBeCloseTo(Math.sqrt(((4 / 3) ** 2 + (5 / 3) ** 2 + (1 / 3) ** 2) / 2), 12);
    expect(metricRow(result, 1, 'test')).toMatchObject({ sampleSize: 3, total: 0, value: 0 });

    // Revenue per unit (units without revenue count as 0): control [40, 0, 20], test [50, 0, 0].
    expect(metricRow(result, 2, 'control')).toMatchObject({ sampleSize: 3, total: 60, value: 20 });
    expect(metricRow(result, 2, 'test').value).toBeCloseTo(50 / 3, 12);
    const revenueLift = metricRow(result, 2, 'test').comparison!;
    expect(revenueLift.lift).toBeCloseTo(50 / 3 / 20 - 1, 12);
    expect(revenueLift.frequentist.pValue).not.toBeNull();

    // Mean revenue per purchasing unit: control [20, 20] (c1 averages 10 and 30), test [50].
    expect(metricRow(result, 3, 'control')).toMatchObject({ sampleSize: 2, value: 20, total: 40 });
    expect(metricRow(result, 3, 'test')).toMatchObject({ sampleSize: 1, value: 50 });
    // One unit cannot be tested.
    expect(metricRow(result, 3, 'test').comparison!.frequentist.pValue).toBeNull();
    expect(metricRow(result, 3, 'test').comparison!.bayesian.probabilityToBeatControl).toBeNull();
  });

  it('flags a sample ratio mismatch against the configured split and refuses to pick a winner', async () => {
    const flagKey = 'exp.srm';
    const sessions: SeedSession[] = [];
    const events: SeedEvent[] = [];
    for (let i = 0; i < 500; i++) {
      const variant = i < 300 ? 'control' : 'test';
      sessions.push({ id: `srm-${i}`, createdAt: BASE });
      events.push(exposure(`srm-exp-${i}`, `srm-${i}`, flagKey, variant, BASE + i));
      // The test arm converts far better: without SRM this would ship.
      if (variant === 'test' ? i % 2 === 0 : i % 10 === 0) {
        events.push({ id: `srm-goal-${i}`, sessionId: `srm-${i}`, name: 'checkout_completed', createdAt: BASE + i + 1 });
      }
    }
    await seedAnalytics(TEST_WEBSITE_ID, { sessions, events });

    const result = await analyze({ flagKey });

    // chi-square = 2 * 50^2 / 250 = 20 with 1 degree of freedom.
    expect(result.srm).toMatchObject({ status: 'mismatch', degreesOfFreedom: 1 });
    expect(result.srm!.chiSquare).toBeCloseTo(20, 10);
    expect(result.srm!.pValue).toBeCloseTo(7.744216431044e-6, 15);
    expect(result.summary.decision).toBe('fix_setup');
    expect(result.summary.significantVariant).toBeNull();
    expect(result.summary.diagnostics).toContainEqual({ code: 'sample_ratio_mismatch', level: 'error' });

    // The same data is fine for a 60/40 split.
    const skewed = await analyze({
      flagKey,
      allocation: {
        enabled: true,
        rollout: 100,
        variants: [
          { key: 'control', weight: 60 },
          { key: 'test', weight: 40 },
        ],
        targeted: false,
      },
    });
    expect(skewed.srm).toMatchObject({ status: 'ok' });
    expect(skewed.summary.decision).toBe('ship_variant');
  });

  it('asks to fix the setup when the flag has no control arm', async () => {
    const flagKey = 'exp.no_control';
    await seedAnalytics(TEST_WEBSITE_ID, {
      sessions: [{ id: 'noctl-1', createdAt: BASE }],
      events: [exposure('noctl-exp-1', 'noctl-1', flagKey, 'test', BASE + 1)],
    });

    const result = await analyze({
      flagKey,
      allocation: { enabled: true, rollout: 100, variants: [], targeted: false },
    });

    expect(result.summary).toMatchObject({ totalUnits: 1, controlVariant: null, decision: 'fix_setup' });
    expect(result.summary.diagnostics).toContainEqual({ code: 'missing_control', level: 'warning' });
    expect(metricRow(result, 0, 'test').comparison).toBeNull();
  });

  it('returns an empty, well-formed result without exposures', async () => {
    const result = await analyze({ flagKey: 'exp.nothing' });
    expect(result.summary).toMatchObject({ totalUnits: 0, decision: 'no_data' });
    expect(result.summary.diagnostics).toEqual([{ code: 'no_exposures', level: 'info' }]);
    expect(result.srm).toBeNull();
    expect(result.guidance).toBeNull();
    expect(result.recent).toEqual([]);
    expect(result.trend).toEqual([]);
    // Configured arms are still listed so the page can show the setup.
    expect(result.variants.map((row) => row.variant)).toEqual(['control', 'test']);
  });
});
