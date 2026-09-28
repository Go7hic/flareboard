import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import migration0044 from '../../../../packages/db/migrations/0044_experiment_metrics.sql?raw';
import { exposure, seedAnalytics, type SeedEvent, type SeedSession } from '../helpers/experiment-seed';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 10, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function insertFlag(flagId: string, key: string, variants: unknown[], rollout = 100) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO feature_flag
      (flag_id, website_id, key, name, description, enabled, rollout, variants, targeting_rules, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?3, '', 1, ?4, ?5, '[]', ?6, ?6)`,
  )
    .bind(flagId, TEST_WEBSITE_ID, key, rollout, JSON.stringify(variants), BASE)
    .run();
}

type ExperimentBody = {
  id: string;
  status: string;
  goalEvent: string;
  primaryMetric: { type: string; event: string; property?: string };
  secondaryMetrics: Array<{ type: string; event: string; property?: string }>;
  minimumDetectableEffect: number | null;
  startedAt: number | null;
  endedAt: number | null;
};

const api = (path: string) => `/api/websites/${TEST_WEBSITE_ID}/experiments${path}`;

describe('experiment routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates experiments with primary and secondary metrics, and still accepts a legacy goalEvent', async () => {
    const flagId = '00000000-0000-0000-0000-00000000e201';
    await insertFlag(flagId, 'exp.crud', []);
    const headers = await authHeader();

    const created = await fetchWorkerJson<ExperimentBody>(api(''), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Pricing page',
        featureFlagId: flagId,
        primaryMetric: { type: 'property_sum', event: 'purchase', property: 'revenue' },
        secondaryMetrics: [
          { type: 'conversion', event: 'signup', property: 'ignored' },
          { type: 'count', event: 'page_click' },
        ],
        minimumDetectableEffect: 5,
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      goalEvent: 'purchase',
      primaryMetric: { type: 'property_sum', event: 'purchase', property: 'revenue' },
      secondaryMetrics: [
        { type: 'conversion', event: 'signup' },
        { type: 'count', event: 'page_click' },
      ],
      minimumDetectableEffect: 5,
      status: 'draft',
      startedAt: null,
    });
    expect(created.body.secondaryMetrics[0]).not.toHaveProperty('property');

    const legacy = await fetchWorkerJson<ExperimentBody>(api(''), {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Legacy', featureFlagId: flagId, goalEvent: 'checkout_completed' }),
    });
    expect(legacy.response.status).toBe(201);
    expect(legacy.body).toMatchObject({
      goalEvent: 'checkout_completed',
      primaryMetric: { type: 'conversion', event: 'checkout_completed' },
      secondaryMetrics: [],
      minimumDetectableEffect: null,
    });

    // goalEvent on update only renames the primary metric's event.
    const renamed = await fetchWorkerJson<ExperimentBody>(api(`/${created.body.id}`), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ goalEvent: 'order_paid', minimumDetectableEffect: null }),
    });
    expect(renamed.body).toMatchObject({
      goalEvent: 'order_paid',
      primaryMetric: { type: 'property_sum', event: 'order_paid', property: 'revenue' },
      minimumDetectableEffect: null,
    });

    const list = await fetchWorkerJson<ExperimentBody[]>(api(''), { headers });
    expect(list.body.find((item) => item.id === created.body.id)?.secondaryMetrics).toHaveLength(2);
  });

  it('rejects invalid metric definitions', async () => {
    const flagId = '00000000-0000-0000-0000-00000000e202';
    await insertFlag(flagId, 'exp.invalid', []);
    const headers = await authHeader();
    const post = (body: unknown) =>
      fetchWorkerJson<{ message: string }>(api(''), { method: 'POST', headers, body: JSON.stringify(body) });

    expect((await post({ name: 'No metric', featureFlagId: flagId })).response.status).toBe(400);
    expect(
      (await post({ name: 'No property', featureFlagId: flagId, primaryMetric: { type: 'property_mean', event: 'buy' } }))
        .response.status,
    ).toBe(400);
    const tooMany = Array.from({ length: 6 }, (_, index) => ({ type: 'count', event: `e${index}` }));
    expect(
      (
        await post({
          name: 'Too many',
          featureFlagId: flagId,
          primaryMetric: { type: 'conversion', event: 'buy' },
          secondaryMetrics: tooMany,
        })
      ).response.status,
    ).toBe(400);
  });

  it('analyzes only the experiment window and reopening clears the end date', async () => {
    const flagId = '00000000-0000-0000-0000-00000000e203';
    const flagKey = 'exp.window';
    await insertFlag(flagId, flagKey, [], 50);
    const headers = await authHeader();
    const created = await fetchWorkerJson<ExperimentBody>(api(''), {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Window', featureFlagId: flagId, goalEvent: 'signup', status: 'running' }),
    });
    const startedAt = created.body.startedAt!;
    expect(startedAt).toEqual(expect.any(Number));

    await seedAnalytics(TEST_WEBSITE_ID, {
      sessions: [
        { id: 'win-before', createdAt: startedAt - 60_000 },
        { id: 'win-after', createdAt: startedAt },
      ],
      events: [
        exposure('win-exp-before', 'win-before', flagKey, 'control', startedAt - 60_000),
        exposure('win-exp-after', 'win-after', flagKey, 'test', startedAt + 1),
      ],
    });

    const results = await fetchWorkerJson<{
      window: { startAt: number };
      summary: { totalUnits: number };
      variants: Array<{ variant: string; units: number }>;
    }>(api(`/${created.body.id}/results`), { headers });
    expect(results.response.status).toBe(200);
    expect(results.body.window.startAt).toBe(startedAt);
    expect(results.body.summary.totalUnits).toBe(1);
    expect(results.body.variants).toEqual([
      expect.objectContaining({ variant: 'control', units: 0 }),
      expect.objectContaining({ variant: 'test', units: 1 }),
    ]);

    const completed = await fetchWorkerJson<ExperimentBody>(api(`/${created.body.id}`), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'completed' }),
    });
    expect(completed.body.endedAt).toEqual(expect.any(Number));
    const reopened = await fetchWorkerJson<ExperimentBody>(api(`/${created.body.id}`), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'running' }),
    });
    expect(reopened.body).toMatchObject({ status: 'running', endedAt: null, startedAt });
  });

  it('ships a significant winning variant back to its feature flag and keeps the original split for SRM', async () => {
    const flagId = '00000000-0000-0000-0000-00000000e101';
    const experimentId = '00000000-0000-0000-0000-00000000e102';
    const flagKey = 'checkout.apply_winner';
    await insertFlag(flagId, flagKey, [
      { key: 'control', name: 'Control', weight: 34 },
      { key: 'variant_a', name: 'Variant A', weight: 33 },
      { key: 'variant_b', name: 'Variant B', weight: 33 },
    ]);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO experiment
        (experiment_id, website_id, feature_flag_id, name, description, status, goal_event, primary_metric, started_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'Checkout experiment', '', 'running', 'checkout_completed',
               '{"type":"conversion","event":"checkout_completed"}', ?4, ?4, ?4)`,
    )
      .bind(experimentId, TEST_WEBSITE_ID, flagId, BASE)
      .run();

    const sessions: SeedSession[] = [];
    const events: SeedEvent[] = [];
    const rates: Record<string, number> = { control: 20, variant_a: 32, variant_b: 20 };
    for (const [arm, conversions] of Object.entries(rates)) {
      for (let i = 0; i < 40; i++) {
        const sessionId = `apply-${arm}-${i}`;
        sessions.push({ id: sessionId, createdAt: BASE });
        events.push(exposure(`apply-exp-${arm}-${i}`, sessionId, flagKey, arm, BASE + i, { featureProperty: true }));
        if (i < conversions) {
          events.push({ id: `apply-goal-${arm}-${i}`, sessionId, name: 'checkout_completed', createdAt: BASE + 1000 + i });
        }
      }
    }
    await seedAnalytics(TEST_WEBSITE_ID, { sessions, events });

    const headers = await authHeader();
    const { response, body } = await fetchWorkerJson<{
      appliedVariant: string;
      experiment: { status: string; endedAt: number | null };
      featureFlag: { rollout: number; variants: Array<{ key: string; weight: number }> };
    }>(api(`/${experimentId}/apply`), { method: 'POST', headers });

    expect(response.status).toBe(200);
    expect(body.appliedVariant).toBe('variant_a');
    expect(body.experiment.status).toBe('completed');
    expect(body.experiment.endedAt).toEqual(expect.any(Number));
    expect(body.featureFlag.rollout).toBe(100);
    expect(body.featureFlag.variants).toEqual([
      { key: 'control', name: 'Control', weight: 0 },
      { key: 'variant_a', name: 'Variant A', weight: 100 },
      { key: 'variant_b', name: 'Variant B', weight: 0 },
    ]);

    // The flag now serves only the winner, but the check still uses the split the test ran with.
    const after = await fetchWorkerJson<{ srm: { status: string; expectedShares: Record<string, number> } }>(
      api(`/${experimentId}/results`),
      { headers },
    );
    expect(after.body.srm.status).toBe('ok');
    expect(after.body.srm.expectedShares.control).toBeCloseTo(0.34, 12);
  });

  it('refuses to apply without a significant winner', async () => {
    const flagId = '00000000-0000-0000-0000-00000000e204';
    await insertFlag(flagId, 'exp.nowinner', []);
    const headers = await authHeader();
    const created = await fetchWorkerJson<ExperimentBody>(api(''), {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Nothing', featureFlagId: flagId, goalEvent: 'signup', status: 'running' }),
    });
    const { response } = await fetchWorkerJson(api(`/${created.body.id}/apply`), { method: 'POST', headers });
    expect(response.status).toBe(400);
  });

  it('migration 0044 turns a legacy goal event into a primary metric and captures running allocations', async () => {
    const flagId = '00000000-0000-0000-0000-00000000e205';
    await insertFlag(flagId, 'exp.legacy', [{ key: 'test', weight: 50 }], 80);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO experiment
        (experiment_id, website_id, feature_flag_id, name, status, goal_event, created_at)
       VALUES ('legacy-running', ?1, ?2, 'Legacy', 'running', 'signup', ?3),
              ('legacy-draft', ?1, ?2, 'Legacy draft', 'draft', 'visit', ?3)`,
    )
      .bind(TEST_WEBSITE_ID, flagId, BASE)
      .run();

    for (const statement of migration0044.split(';').map((part) => part.trim())) {
      if (/^(--[^\n]*\n\s*)*UPDATE/i.test(statement)) await env.DB.prepare(statement).run();
    }

    const rows = await env.DB.prepare(
      `SELECT experiment_id as id, primary_metric as primaryMetric, secondary_metrics as secondaryMetrics, allocation
       FROM experiment WHERE experiment_id IN ('legacy-running', 'legacy-draft') ORDER BY experiment_id`,
    ).all<{ id: string; primaryMetric: string; secondaryMetrics: string; allocation: string | null }>();
    const [draft, running] = rows.results;
    expect(JSON.parse(draft!.primaryMetric)).toEqual({ type: 'conversion', event: 'visit' });
    expect(draft!.secondaryMetrics).toBe('[]');
    expect(draft!.allocation).toBeNull();
    expect(JSON.parse(running!.primaryMetric)).toEqual({ type: 'conversion', event: 'signup' });
    expect(JSON.parse(running!.allocation!)).toEqual({
      enabled: true,
      rollout: 80,
      variants: [{ key: 'test', weight: 50 }],
      targeted: false,
    });
  });
});
