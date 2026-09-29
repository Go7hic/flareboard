import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE_PATH = `/api/websites/${TEST_WEBSITE_ID}/workflows`;

async function authHeader(role = 'admin') {
  const token = await createSecureToken({ userId: TEST_USER_ID, role }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type WorkflowBody = {
  id: string;
  name: string;
  description: string;
  triggerEvent: string;
  enabled: boolean;
  actionType: string;
  filters: unknown[];
  steps: Array<Record<string, unknown>>;
  signingSecret?: string;
  signingSecretPreview: string | null;
};

const FLOW_STEPS = [
  { id: 'wait', type: 'delay', minutes: 30 },
  { id: 'pro', type: 'condition', conditions: [{ field: 'property', key: 'plan', operator: 'equals', value: 'pro' }] },
  {
    id: 'hook',
    type: 'webhook',
    url: 'https://hooks.example.com/in',
    method: 'POST',
    headers: [{ key: 'Authorization', value: 'Bearer secret-token' }],
    body: '{"event": "{{event.name}}", "plan": {{event.properties.plan}}}',
  },
  { id: 'slack', type: 'slack', webhookUrl: 'https://hooks.slack.com/services/T/B/secret', message: 'New {{event.name}}' },
];

async function createFlow(overrides: Record<string, unknown> = {}) {
  return fetchWorkerJson<WorkflowBody>(BASE_PATH, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({
      name: 'Pro signups',
      description: 'Ping sales',
      triggerEvent: 'signup',
      filters: [{ field: 'path', operator: 'starts_with', value: '/pricing' }],
      steps: FLOW_STEPS,
      ...overrides,
    }),
  });
}

describe('workflow routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates, lists, updates, lists executions, and deletes legacy workflows', async () => {
    const created = await fetchWorkerJson<WorkflowBody>(BASE_PATH, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'Signup webhook',
        triggerEvent: 'signup',
        actionType: 'webhook',
        actionConfig: { url: 'https://example.com/hooks/signup', note: 'Legacy note' },
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        name: 'Signup webhook',
        triggerEvent: 'signup',
        description: 'Legacy note',
        actionType: 'webhook',
        steps: [expect.objectContaining({ type: 'webhook', url: 'https://example.com/hooks/signup', method: 'POST' })],
      }),
    );

    const list = await fetchWorkerJson<Array<{ id: string; name: string }>>(BASE_PATH, { headers: await authHeader() });
    expect(list.response.status).toBe(200);
    expect(list.body.some((row) => row.id === created.body.id)).toBe(true);

    const updated = await fetchWorkerJson<{ name: string }>(`${BASE_PATH}/${created.body.id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Signup webhook v2' }),
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.name).toBe('Signup webhook v2');

    const executions = await fetchWorkerJson<{ executions: unknown[] }>(`${BASE_PATH}/${created.body.id}/executions`, {
      headers: await authHeader(),
    });
    expect(executions.response.status).toBe(200);
    expect(Array.isArray(executions.body.executions)).toBe(true);

    const deleted = await fetchWorkerJson<{ ok: boolean }>(`${BASE_PATH}/${created.body.id}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
  });

  it('stores multi-step flows and returns the signing secret only once', async () => {
    const created = await createFlow();
    expect(created.response.status).toBe(201);
    expect(created.body.signingSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(created.body.signingSecretPreview).toBe(`whsec_…${created.body.signingSecret!.slice(-4)}`);
    expect(created.body.actionType).toBe('multi');
    expect(created.body.steps).toHaveLength(4);
    expect(created.body.filters).toEqual([{ field: 'path', key: '', operator: 'starts_with', value: '/pricing' }]);

    const list = await fetchWorkerJson<WorkflowBody[]>(BASE_PATH, { headers: await authHeader() });
    const listed = list.body.find((row) => row.id === created.body.id)!;
    expect(listed.signingSecret).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(created.body.signingSecret);
    expect(listed.steps[2]).toMatchObject({ headers: [{ key: 'Authorization', value: 'Bearer secret-token' }] });

    const rotated = await fetchWorkerJson<{ signingSecret: string }>(`${BASE_PATH}/${created.body.id}/rotate-secret`, {
      method: 'POST',
      headers: await authHeader(),
    });
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.signingSecret).toMatch(/^whsec_/);
    expect(rotated.body.signingSecret).not.toBe(created.body.signingSecret);
  });

  it('hides credentials in steps from read-only members and refuses their writes', async () => {
    const created = await createFlow();
    const viewer = await authHeader('view-only');
    const list = await fetchWorkerJson<WorkflowBody[]>(BASE_PATH, { headers: viewer });
    const listed = list.body.find((row) => row.id === created.body.id)!;
    expect(JSON.stringify(listed)).not.toContain('secret-token');
    expect(JSON.stringify(listed)).not.toContain('/services/T/B/secret');

    const test = await fetchWorkerJson(`${BASE_PATH}/${created.body.id}/test`, { method: 'POST', headers: viewer, body: '{}' });
    expect(test.response.status).toBe(403);
    const rotate = await fetchWorkerJson(`${BASE_PATH}/${created.body.id}/rotate-secret`, { method: 'POST', headers: viewer });
    expect(rotate.response.status).toBe(403);
  });

  it.each([
    [{ steps: [{ id: 'h', type: 'webhook', url: 'http://127.0.0.1:8080/admin' }] }, 'url'],
    [{ steps: [{ id: 'h', type: 'webhook', url: 'https://x.example.com', body: '{"a": {{event.name}' }] }, 'body'],
    [{ steps: [{ id: 'd', type: 'delay', minutes: 20_000 }] }, 'minutes'],
    [{ filters: [{ field: 'property', operator: 'equals', value: 'x' }] }, 'key'],
    [{ steps: undefined, actionType: 'webhook', actionConfig: { url: 'http://localhost/hook' } }, 'url'],
  ])('rejects invalid definitions %#', async (overrides, field) => {
    const created = await createFlow(overrides);
    expect(created.response.status).toBe(400);
    expect(JSON.stringify(created.body)).toContain(field);
  });

  it('previews a flow against a sample event without sending', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const created = await createFlow();
    const preview = await fetchWorkerJson<{
      matched: boolean;
      sent: boolean;
      steps: Array<{ type: string; status: string; request: { body: string | null; headers: Array<{ key: string; value: string }> } | null }>;
    }>(`${BASE_PATH}/${created.body.id}/test`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ event: { properties: { plan: 'pro' }, url: '/pricing?x=1' }, send: false }),
    });
    expect(preview.response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(preview.body.matched).toBe(true);
    expect(preview.body.sent).toBe(false);
    expect(preview.body.steps.map((step) => step.status)).toEqual(['skipped', 'passed', 'rendered', 'rendered']);
    expect(JSON.parse(preview.body.steps[2]!.request!.body!)).toEqual({ event: 'signup', plan: 'pro' });

    const unmatched = await fetchWorkerJson<{ matched: boolean; steps: Array<{ status: string }> }>(
      `${BASE_PATH}/${created.body.id}/test`,
      { method: 'POST', headers: await authHeader(), body: JSON.stringify({ event: { url: '/blog' } }) },
    );
    expect(unmatched.body.matched).toBe(false);
    expect(unmatched.body.steps.every((step) => step.status === 'not_reached')).toBe(true);
  });

  it('sends a signed test delivery and returns the destination response', async () => {
    const created = await createFlow({ filters: [], steps: [FLOW_STEPS[2]] });
    const bodies: Array<{ headers: Headers; body: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init as RequestInit);
      bodies.push({ headers: request.headers, body: await request.text() });
      return new Response('x'.repeat(5000), { status: 202 });
    });
    const result = await fetchWorkerJson<{
      sent: boolean;
      steps: Array<{ status: string; response: { statusCode: number; body: string } }>;
    }>(`${BASE_PATH}/${created.body.id}/test`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ event: { properties: { plan: 'pro' } }, send: true }),
    });
    expect(result.response.status).toBe(200);
    expect(result.body.sent).toBe(true);
    expect(result.body.steps[0]).toMatchObject({ status: 'sent', response: { statusCode: 202 } });
    // Response bodies are truncated.
    expect(result.body.steps[0]!.response.body.length).toBeLessThanOrEqual(1001);
    expect(bodies).toHaveLength(1);
    const { headers, body } = bodies[0]!;
    expect(headers.get('x-flareboard-test')).toBe('1');
    const expected = createHmac('sha256', created.body.signingSecret!)
      .update(`${headers.get('x-flareboard-timestamp')}.${body}`)
      .digest('hex');
    expect(headers.get('x-flareboard-signature')).toBe(`v1=${expected}`);
  });

  it('filters executions by status and date and returns per-attempt details', async () => {
    const created = await createFlow();
    const id = created.body.id;
    const day = Date.UTC(2026, 3, 1);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO workflow_execution (execution_id, workflow_id, website_id, event_name, status, error, attempts, response_code, created_at)
         VALUES ('route-exec-1', ?1, ?2, 'signup', 'failed', 'Destination returned 500 (gave up after 5 attempts)', 5, 500, ?3),
                ('route-exec-2', ?1, ?2, 'signup', 'success', NULL, 1, 200, ?4)`,
      ).bind(id, TEST_WEBSITE_ID, day, day + 2 * 86_400_000),
      env.DB.prepare(
        `INSERT INTO workflow_execution_attempt (attempt_id, execution_id, workflow_id, website_id, step_index, step_type, attempt, status, response_code, error, next_retry_at, created_at)
         VALUES ('route-exec-1:2:1', 'route-exec-1', ?1, ?2, 2, 'webhook', 1, 'retrying', 500, 'Destination returned 500', ?3, ?3),
                ('route-exec-1:2:2', 'route-exec-1', ?1, ?2, 2, 'webhook', 2, 'failed', 500, 'Destination returned 500', NULL, ?3)`,
      ).bind(id, TEST_WEBSITE_ID, day),
    ]);

    const failed = await fetchWorkerJson<{ executions: Array<{ id: string }>; summary: { executions: number } }>(
      `${BASE_PATH}/${id}/executions?status=failed`,
      { headers: await authHeader() },
    );
    expect(failed.body.executions.map((row) => row.id)).toEqual(['route-exec-1']);

    const ranged = await fetchWorkerJson<{ executions: Array<{ id: string }> }>(
      `${BASE_PATH}/${id}/executions?from=${day + 86_400_000}&to=${day + 3 * 86_400_000}`,
      { headers: await authHeader() },
    );
    expect(ranged.body.executions.map((row) => row.id)).toEqual(['route-exec-2']);

    const detail = await fetchWorkerJson<{
      execution: { id: string; attempts: number; responseCode: number };
      attempts: Array<{ attempt: number; status: string; responseCode: number }>;
    }>(`${BASE_PATH}/${id}/executions/route-exec-1`, { headers: await authHeader() });
    expect(detail.response.status).toBe(200);
    expect(detail.body.execution).toMatchObject({ id: 'route-exec-1', attempts: 5, responseCode: 500 });
    expect(detail.body.attempts.map((row) => [row.attempt, row.status])).toEqual([
      [1, 'retrying'],
      [2, 'failed'],
    ]);

    const missing = await fetchWorkerJson(`${BASE_PATH}/${id}/executions/nope`, { headers: await authHeader() });
    expect(missing.response.status).toBe(404);

    // Deleting a workflow removes its execution log too (D1 enforces the foreign keys).
    const deleted = await fetchWorkerJson(`${BASE_PATH}/${id}`, { method: 'DELETE', headers: await authHeader() });
    expect(deleted.response.status).toBe(200);
    const left = await env.DB.prepare(`SELECT COUNT(*) as n FROM workflow_execution WHERE workflow_id = ?1`).bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
