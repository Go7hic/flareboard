import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { WorkflowStep } from '@flareboard/shared';
import type { Env } from '../../src/env';
import type { WorkflowRunParams } from '../../src/lib/workflow-runtime';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const SECRET = 'whsec_runner_test_secret';
let counter = 0;

type Captured = { url: string; method: string; headers: Headers; body: string };

function mockFetch(responses: Array<number | Error>) {
  const calls: Captured[] = [];
  let index = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init as RequestInit);
    calls.push({ url: request.url, method: request.method, headers: request.headers, body: await request.text() });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return new Response(next >= 500 ? 'upstream down' : 'ok', { status: next });
  });
  return calls;
}

async function createWorkflow(steps: WorkflowStep[], overrides: { enabled?: boolean } = {}) {
  counter += 1;
  const workflowId = `runner-wf-${counter}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, trigger_filters, steps, signing_secret, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'signup', ?4, 'multi', '[]', ?5, ?6, ?7, ?7)`,
  )
    .bind(workflowId, TEST_WEBSITE_ID, `Runner ${counter}`, overrides.enabled === false ? 0 : 1, JSON.stringify(steps), SECRET, now)
    .run();
  return workflowId;
}

async function startRun(workflowId: string, steps: WorkflowStep[], distinctId: string | null = null) {
  const executionId = `runner-exec-${counter}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO workflow_execution (execution_id, workflow_id, website_id, event_id, event_name, status, created_at)
     VALUES (?1, ?2, ?3, ?4, 'signup', 'queued', ?5)`,
  )
    .bind(executionId, workflowId, TEST_WEBSITE_ID, `evt-${counter}`, now)
    .run();
  const params: WorkflowRunParams = {
    executionId,
    websiteId: TEST_WEBSITE_ID,
    workflowId,
    workflowName: `Runner ${counter}`,
    website: { id: TEST_WEBSITE_ID, name: 'Test Site', domain: 'example.com' },
    steps,
    event: {
      id: `evt-${counter}`,
      name: 'signup',
      createdAt: now,
      sessionId: 'sess-1',
      visitId: 'visit-1',
      distinctId,
      hostname: 'example.com',
      urlPath: '/pricing',
      urlQuery: null,
      properties: { plan: 'pro', amount: 49 },
    },
  };
  return { executionId, params };
}

async function run(steps: WorkflowStep[], options: { distinctId?: string; enabled?: boolean } = {}) {
  const workflowId = await createWorkflow(steps, options);
  const { executionId, params } = await startRun(workflowId, steps, options.distinctId ?? null);
  await using instance = await introspectWorkflowInstance((env as unknown as Env).WORKFLOW_RUNNER!, executionId);
  await instance.modify(async (m) => {
    await m.disableSleeps();
  });
  await (env as unknown as Env).WORKFLOW_RUNNER!.create({ id: executionId, params });
  await instance.waitForStatus('complete');
  const execution = await env.DB.prepare(
    `SELECT status, error, attempts, response_code as responseCode, next_retry_at as nextRetryAt, completed_at as completedAt
     FROM workflow_execution WHERE execution_id = ?1`,
  )
    .bind(executionId)
    .first<{ status: string; error: string | null; attempts: number; responseCode: number | null; nextRetryAt: number | null; completedAt: number | null }>();
  const attempts = await env.DB.prepare(
    `SELECT step_index as stepIndex, step_type as stepType, attempt, status, response_code as responseCode, error,
            response_body as responseBody, next_retry_at as nextRetryAt
     FROM workflow_execution_attempt WHERE execution_id = ?1 ORDER BY step_index, attempt`,
  )
    .bind(executionId)
    .all<{ stepIndex: number; stepType: string; attempt: number; status: string; responseCode: number | null; error: string | null; responseBody: string | null; nextRetryAt: number | null }>();
  return { executionId, workflowId, execution: execution!, attempts: attempts.results ?? [] };
}

const webhook = (overrides: Partial<Extract<WorkflowStep, { type: 'webhook' }>> = {}): WorkflowStep => ({
  id: 'hook',
  type: 'webhook',
  url: 'https://hooks.example.com/in',
  method: 'POST',
  headers: [{ key: 'Authorization', value: 'Bearer {{person.properties.token}}' }],
  body: '{"event": "{{event.name}}", "plan": {{event.properties.plan}}, "email": "{{person.properties.email}}"}',
  ...overrides,
});

describe('WorkflowRunner', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await testSiteDb(TEST_WEBSITE_ID)
      .prepare(
        `INSERT OR REPLACE INTO person (person_id, website_id, distinct_id, properties_json, created_at, updated_at)
         VALUES ('runner-person', ?1, 'user-1', ?2, ?3, ?3)`,
      )
      .bind(TEST_WEBSITE_ID, JSON.stringify({ email: 'ada@example.com', token: 't0k', plan: 'free' }), Date.now())
      .run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers a signed, rendered webhook and records the attempt', async () => {
    const calls = mockFetch([200]);
    const result = await run([webhook()], { distinctId: 'user-1' });

    expect(result.execution).toMatchObject({ status: 'success', attempts: 1, responseCode: 200, error: null });
    expect(result.execution.completedAt).toBeGreaterThan(0);
    expect(result.attempts).toEqual([
      expect.objectContaining({ stepIndex: 0, stepType: 'webhook', attempt: 1, status: 'success', responseCode: 200, responseBody: 'ok' }),
    ]);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://hooks.example.com/in');
    expect(JSON.parse(call!.body)).toEqual({ event: 'signup', plan: 'pro', email: 'ada@example.com' });
    expect(call!.headers.get('authorization')).toBe('Bearer t0k');
    expect(call!.headers.get('x-flareboard-delivery')).toBe(`${result.executionId}:0`);
    const timestamp = call!.headers.get('x-flareboard-timestamp')!;
    const expected = createHmac('sha256', SECRET).update(`${timestamp}.${call!.body}`).digest('hex');
    expect(call!.headers.get('x-flareboard-signature')).toBe(`v1=${expected}`);
  });

  it('retries retryable failures with exponential back-off and records every attempt', async () => {
    mockFetch([503, new Error('connection reset'), 200]);
    const before = Date.now();
    const result = await run([webhook()]);

    expect(result.execution).toMatchObject({ status: 'success', attempts: 3, responseCode: 200, nextRetryAt: null });
    expect(result.attempts.map((row) => [row.attempt, row.status, row.responseCode])).toEqual([
      [1, 'retrying', 503],
      [2, 'retrying', null],
      [3, 'success', 200],
    ]);
    expect(result.attempts[0]!.error).toBe('Destination returned 503');
    expect(result.attempts[0]!.responseBody).toBe('upstream down');
    expect(result.attempts[1]!.error).toContain('connection reset');
    // 30s after the first failure, 2 minutes after the second.
    expect(result.attempts[0]!.nextRetryAt! - before).toBeGreaterThanOrEqual(30_000);
    expect(result.attempts[0]!.nextRetryAt! - Date.now()).toBeLessThanOrEqual(30_000);
    expect(result.attempts[1]!.nextRetryAt! - before).toBeGreaterThanOrEqual(120_000);
  });

  it('gives up after five attempts', async () => {
    const calls = mockFetch([500]);
    const result = await run([webhook()]);

    expect(calls).toHaveLength(5);
    expect(result.execution.status).toBe('failed');
    expect(result.execution.error).toBe('Destination returned 500 (gave up after 5 attempts)');
    expect(result.attempts.map((row) => row.status)).toEqual(['retrying', 'retrying', 'retrying', 'retrying', 'failed']);
    expect(result.attempts[4]!.nextRetryAt).toBeNull();
  });

  it('does not retry permanent client errors and stops the flow', async () => {
    const calls = mockFetch([404, 200]);
    const result = await run([webhook(), webhook({ id: 'second', url: 'https://second.example.com/' })]);

    expect(calls).toHaveLength(1);
    expect(result.execution).toMatchObject({ status: 'failed', attempts: 1, responseCode: 404, error: 'Destination returned 404' });
  });

  it('refuses private destinations without sending anything', async () => {
    const calls = mockFetch([200]);
    const result = await run([webhook({ url: 'http://169.254.169.254/latest/meta-data' })]);

    expect(calls).toHaveLength(0);
    expect(result.execution.status).toBe('failed');
    expect(result.execution.error).toMatch(/^Destination refused/);
  });

  it('records delays, then stops at a condition that fails on fresh person properties', async () => {
    const calls = mockFetch([200]);
    const result = await run(
      [
        { id: 'wait', type: 'delay', minutes: 60 * 24 },
        { id: 'only-pro', type: 'condition', conditions: [{ field: 'person', key: 'plan', operator: 'equals', value: 'pro' }] },
        webhook(),
      ],
      { distinctId: 'user-1' },
    );

    expect(calls).toHaveLength(0);
    expect(result.execution).toMatchObject({ status: 'stopped', error: 'Stopped by a condition step' });
    expect(result.attempts.map((row) => [row.stepType, row.status])).toEqual([
      ['delay', 'waiting'],
      ['condition', 'stopped'],
    ]);
    expect(result.attempts[0]!.nextRetryAt).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it('continues past a passing condition and sends Slack messages with escaped values', async () => {
    const calls = mockFetch([200]);
    const result = await run(
      [
        { id: 'cond', type: 'condition', conditions: [{ field: 'property', key: 'amount', operator: 'greater_than', value: '10' }] },
        { id: 'slack', type: 'slack', webhookUrl: 'https://hooks.slack.com/services/T0/B0/xyz', message: 'New <{{event.name}}> {{event.properties.plan}}' },
      ],
    );
    expect(result.execution.status).toBe('success');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body)).toEqual({ text: 'New <signup> pro' });
    expect(calls[0]!.headers.get('x-flareboard-signature')).toBeNull();
  });

  it('cancels pending executions of a disabled workflow', async () => {
    const calls = mockFetch([200]);
    const result = await run([webhook()], { enabled: false });
    expect(calls).toHaveLength(0);
    expect(result.execution).toMatchObject({ status: 'cancelled', error: 'Workflow was disabled or deleted' });
  });

  it('throttles deliveries beyond the per-website hourly cap', async () => {
    mockFetch([200]);
    const { WORKFLOW_DELIVERIES_PER_HOUR } = await import('../../src/lib/workflow-runtime');
    const { checkIpRateLimit } = await import('../../src/lib/rate-limit');
    for (let i = 0; i < WORKFLOW_DELIVERIES_PER_HOUR; i++) {
      await checkIpRateLimit(env as unknown as Env, 'workflow-delivery', TEST_WEBSITE_ID, WORKFLOW_DELIVERIES_PER_HOUR, 3600);
    }
    const result = await run([webhook()]);
    expect(result.execution.status).toBe('throttled');
    expect(result.attempts).toEqual([expect.objectContaining({ status: 'throttled' })]);
  });
});
