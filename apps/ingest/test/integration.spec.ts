import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorker, fetchWorkerJson } from './helpers/fetch-worker';

describe('ingest integration', () => {
  it('GET / returns service metadata', async () => {
    const { response, body } = await fetchWorkerJson<{ name: string; version: string }>('/');
    expect(response.status).toBe(200);
    expect(body.name).toBe('flareboard-ingest');
    expect(body.version).toBe('0.0.1');
  });

  it('GET /api/heartbeat returns ok', async () => {
    const { response, body } = await fetchWorkerJson<{ ok: boolean }>('/api/heartbeat');
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('GET /script.js returns tracker JavaScript', async () => {
    const response = await fetchWorker('/script.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('javascript');
    const text = await response.text();
    expect(text).toContain('data-website-id');
  });

  it('GET /script.js exposes identity helpers', async () => {
    const response = await fetchWorker('/script.js');
    const text = await response.text();

    expect(text).toContain('identify:function');
    expect(text).toContain('setDistinctId');
    expect(text).toContain('alias:function');
    expect(text).toContain('reset:function');
    expect(text).toContain('getDistinctId:function');
  });

  it('GET /recorder.js returns recorder JavaScript', async () => {
    const response = await fetchWorker('/recorder.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('javascript');
    const text = await response.text();
    expect(text).toContain('rrweb');
  });
});

describe('POST /api/send', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('rejects invalid JSON payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{not-json',
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/invalid json/i);
  });

  it('rejects null JSON payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/expected json object/i);
  });

  it('rejects schema-invalid payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event', payload: {} }),
    });
    expect(response.status).toBe(400);
    expect(body.message).toBeTruthy();
  });

  it('returns 400 when website does not exist', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: '00000000-0000-0000-0000-000000000098',
          hostname: 'example.com',
          url: '/',
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/website not found/i);
  });

  it('accepts a valid pageview event for an existing website', async () => {
    await seedTestWebsite(env.DB);

    const { response, body } = await fetchWorkerJson<{ cache?: string; sessionId?: string }>(
      '/api/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event',
          payload: {
            website: TEST_WEBSITE_ID,
            hostname: 'example.com',
            url: '/docs',
            title: 'Docs',
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(body.sessionId).toBeTruthy();
    expect(body.cache).toBeTruthy();
  });

  it('records workflow executions when an event matches an enabled workflow', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, created_at, updated_at)
       VALUES ('workflow-send-email', ?1, 'Notify sales', 'checkout_completed', 1, 'record', ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, now)
      .run();

    const { response } = await fetchWorkerJson<{ cache?: string; sessionId?: string }>(
      '/api/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event',
          payload: {
            website: TEST_WEBSITE_ID,
            hostname: 'example.com',
            url: '/checkout',
            name: 'checkout_completed',
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const row = await env.DB.prepare(
      `SELECT workflow_id as workflowId, status, event_name as eventName
       FROM workflow_execution
       WHERE website_id = ?1 AND workflow_id = 'workflow-send-email'
       LIMIT 1`,
    )
      .bind(TEST_WEBSITE_ID)
      .first<{ workflowId: string; status: string; eventName: string }>();

    expect(row).toEqual({
      workflowId: 'workflow-send-email',
      status: 'recorded',
      eventName: 'checkout_completed',
    });
  });

  it('stores identify payloads in the person table', async () => {
    await seedTestWebsite(env.DB);

    const { response } = await fetchWorkerJson<{ cache?: string; sessionId?: string }>(
      '/api/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'identify',
          payload: {
            website: TEST_WEBSITE_ID,
            id: 'identify-user-1',
            data: { email: 'identify@example.com', plan: 'pro' },
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const row = await env.DB.prepare(
      `SELECT distinct_id as distinctId, properties_json as propertiesJson
       FROM person
       WHERE website_id = ?1 AND distinct_id = 'identify-user-1'
       LIMIT 1`,
    )
      .bind(TEST_WEBSITE_ID)
      .first<{ distinctId: string; propertiesJson: string }>();

    expect(row?.distinctId).toBe('identify-user-1');
    expect(JSON.parse(row!.propertiesJson)).toMatchObject({
      email: 'identify@example.com',
      plan: 'pro',
    });
  });

  it('tags matched actions on ingest for custom events', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO action_definition (action_id, website_id, name, description, rules, created_at, updated_at)
       VALUES ('action-checkout', ?1, 'Checkout started', '', ?2, ?3, ?3)`,
    )
      .bind(
        TEST_WEBSITE_ID,
        JSON.stringify([{ field: 'event_name', operator: 'equals', value: 'checkout_started' }]),
        now,
      )
      .run();

    const { appendMatchedActionTags } = await import('../src/lib/actions');
    const tagged = await appendMatchedActionTags(env, TEST_WEBSITE_ID, {
      eventName: 'checkout_started',
      urlPath: '/checkout',
      data: { plan: 'pro' },
    });

    expect(tagged.$flareboard_action_ids).toBe('action-checkout');
    expect(tagged.$flareboard_action_names).toBe('Checkout started');
  });

  it('captures trace and span fields for log events', async () => {
    await seedTestWebsite(env.DB);

    const { response } = await fetchWorkerJson<{ cache?: string; sessionId?: string }>(
      '/api/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'log',
          payload: {
            website: TEST_WEBSITE_ID,
            hostname: 'example.com',
            url: '/checkout',
            level: 'error',
            message: 'Payment span failed',
            traceId: 'trace-ingest-1',
            spanId: 'span-payment',
            parentSpanId: 'span-root',
            service: 'payments',
            operation: 'POST /payments',
            durationMs: 240,
            status: 'error',
          },
        }),
      },
    );

    expect(response.status).toBe(200);
  });
});

describe('POST /api/batch', () => {
  it('rejects non-array payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event' }),
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/expected array/i);
  });
});

describe('GET /api/tracker-config', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('requires website query param', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/tracker-config');
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/website query param required/i);
  });

  it('returns 404 for unknown website', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>(
      '/api/tracker-config?website=00000000-0000-0000-0000-000000000098',
    );
    expect(response.status).toBe(404);
    expect(body.message).toMatch(/not found/i);
  });

  it('returns default tracker config for an existing website', async () => {
    await seedTestWebsite(env.DB);

    const { response, body } = await fetchWorkerJson<{
      heatmapSampleRate: number;
      heatmapEnabled: boolean;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);

    expect(response.status).toBe(200);
    expect(body.heatmapSampleRate).toBe(0.1);
    expect(body.heatmapEnabled).toBe(true);
  });

  it('returns survey type and options for active choice surveys', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, options, enabled, created_at, updated_at)
       VALUES ('choice-survey', ?1, 'Plan feedback', 'Which plan fits?', 'choice', ?2, 1, ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, JSON.stringify(['Free', 'Pro', 'Enterprise']), now)
      .run();
    await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);

    const { response, body } = await fetchWorkerJson<{
      surveys: Array<{ id: string; type: string; options?: string[] }>;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);

    expect(response.status).toBe(200);
    expect(body.surveys).toContainEqual(
      expect.objectContaining({
        id: 'choice-survey',
        type: 'choice',
        options: ['Free', 'Pro', 'Enterprise'],
      }),
    );
  });

  it('returns survey trigger event and display delay in tracker config', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, trigger_event, display_delay_seconds, created_at, updated_at)
       VALUES ('trigger-survey', ?1, 'Checkout feedback', 'How was checkout?', 'rating', 1, 'checkout_started', 3, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, now)
      .run();
    await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);

    const { response, body } = await fetchWorkerJson<{
      surveys: Array<{ id: string; triggerEvent?: string; displayDelaySeconds?: number }>;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);

    expect(response.status).toBe(200);
    expect(body.surveys).toContainEqual(
      expect.objectContaining({
        id: 'trigger-survey',
        triggerEvent: 'checkout_started',
        displayDelaySeconds: 3,
      }),
    );
  });

  it('returns survey display rules in tracker config', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    const displayRules = [
      { field: 'path', operator: 'contains', value: '/checkout' },
      { field: 'property', key: 'plan', operator: 'equals', value: 'pro' },
    ];
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, display_rules, created_at, updated_at)
       VALUES ('rules-survey', ?1, 'Checkout feedback', 'How was checkout?', 'rating', 1, ?2, ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, JSON.stringify(displayRules), now)
      .run();
    await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);

    const { response, body } = await fetchWorkerJson<{
      surveys: Array<{ id: string; displayRules?: typeof displayRules }>;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);

    expect(response.status).toBe(200);
    expect(body.surveys).toContainEqual(
      expect.objectContaining({
        id: 'rules-survey',
        displayRules,
      }),
    );
  });

  it('returns feature flag variants in tracker config', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    const variants = [
      { key: 'variant_a', name: 'New checkout', weight: 40 },
      { key: 'variant_b', name: 'Original checkout', weight: 30 },
    ];
    await env.DB.prepare(
      `INSERT INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, variants, created_at, updated_at)
       VALUES ('flag-variants', ?1, 'checkout.flow', 'Checkout flow', '', 1, 80, ?2, ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, JSON.stringify(variants), now)
      .run();
    await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);

    const { response, body } = await fetchWorkerJson<{
      featureFlags: Array<{
        key: string;
        rollout: number;
        variants: Array<{ key: string; name: string; weight: number }>;
      }>;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);

    expect(response.status).toBe(200);
    expect(body.featureFlags).toContainEqual(
      expect.objectContaining({
        key: 'checkout.flow',
        rollout: 80,
        variants,
      }),
    );
  });

  it('does not expose targeting rules in tracker config', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    const targetingRules = [
      { field: 'path', operator: 'contains', value: '/pricing' },
      { field: 'language', operator: 'starts_with', value: 'en' },
    ];
    await env.DB.prepare(
      `INSERT INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, targeting_rules, created_at, updated_at)
       VALUES ('flag-targeting', ?1, 'pricing.banner', 'Pricing banner', '', 1, 100, ?2, ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, JSON.stringify(targetingRules), now)
      .run();
    await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);

    const { response, body } = await fetchWorkerJson<{
      featureFlags: Array<{
        key: string;
        targeted?: boolean;
        targetingRules?: unknown;
      }>;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);

    expect(response.status).toBe(200);
    const flag = body.featureFlags.find((item) => item.key === 'pricing.banner');
    expect(flag).toMatchObject({ key: 'pricing.banner', targeted: true });
    expect(flag).not.toHaveProperty('targetingRules');
  });
});

describe('POST /api/feature-flags/evaluate', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('evaluates targeted flags without exposing rules', async () => {
    await seedTestWebsite(env.DB);
    const now = Date.now();
    const flagKey = 'pricing.evaluate';
    const targetingRules = [
      { field: 'path', operator: 'contains', value: '/pricing' },
      { field: 'language', operator: 'starts_with', value: 'en' },
    ];
    await env.DB.prepare(
      `INSERT INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, targeting_rules, created_at, updated_at)
       VALUES ('flag-eval', ?1, ?2, 'Pricing banner', '', 1, 100, ?3, ?4, ?4)`,
    )
      .bind(TEST_WEBSITE_ID, flagKey, JSON.stringify(targetingRules), now)
      .run();

    const matching = await fetchWorkerJson<{ results: Record<string, string> }>(
      '/api/feature-flags/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website: TEST_WEBSITE_ID,
          keys: [flagKey],
          context: { path: '/pricing', language: 'en-US' },
        }),
      },
    );

    expect(matching.response.status).toBe(200);
    expect(matching.body.results[flagKey]).toBe('test');

    const mismatch = await fetchWorkerJson<{ results: Record<string, string> }>(
      '/api/feature-flags/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website: TEST_WEBSITE_ID,
          keys: [flagKey],
          context: { path: '/home', language: 'en-US' },
        }),
      },
    );

    expect(mismatch.response.status).toBe(200);
    expect(mismatch.body.results[flagKey]).toBe('control');
  });

  it('returns false for unknown flag keys', async () => {
    await seedTestWebsite(env.DB);

    const { response, body } = await fetchWorkerJson<{ results: Record<string, boolean> }>(
      '/api/feature-flags/evaluate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website: TEST_WEBSITE_ID,
          keys: ['missing.flag'],
          context: { path: '/' },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(body.results['missing.flag']).toBe(false);
  });
});
