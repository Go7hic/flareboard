import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generatePersonalApiKey, hashApiKey, type WorkflowTriggerMessage } from '@flareboard/shared';
import { applyTestMigrations, seedTestWebsite, TEST_USER_ID, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerWithEnv, recordingQueue, seedProjectKey } from './helpers/queue';

const KEY = `fb_pk_${'WorkflowTriggerKey'.padEnd(24, '0')}`;
let counter = 0;

async function createWorkflow(trigger: string, filters: unknown[] = [], enabled = true) {
  counter += 1;
  const workflowId = `ingest-wf-${counter}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, trigger_filters, steps, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'record', ?6, '[]', ?7, ?7)`,
  )
    .bind(workflowId, TEST_WEBSITE_ID, `Workflow ${counter}`, trigger, enabled ? 1 : 0, JSON.stringify(filters), now)
    .run();
  return workflowId;
}

function workflowQueue() {
  const recorder = recordingQueue();
  return { queue: recorder.queue, messages: () => recorder.messages as unknown as WorkflowTriggerMessage[] };
}

async function sendEvent(
  queue: ReturnType<typeof workflowQueue>['queue'],
  input: { name: string; ip: string; data?: Record<string, unknown>; url?: string; id?: string; apiKey?: string },
) {
  return fetchWorkerWithEnv(
    '/api/send',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': input.ip,
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
      },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: TEST_WEBSITE_ID,
          hostname: 'example.com',
          url: input.url ?? '/checkout?step=2',
          name: input.name,
          data: input.data,
          id: input.id,
        },
      }),
    },
    { WORKFLOW_QUEUE: queue },
  );
}

describe('workflow triggers from ingest', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await seedProjectKey(env.DB, TEST_WEBSITE_ID, KEY);
  });

  it('queues a trigger with the event snapshot for matching workflows only', async () => {
    const plain = await createWorkflow('wf_order');
    const bigOrders = await createWorkflow('wf_order', [{ field: 'property', key: 'total', operator: 'greater_than', value: '100' }]);
    const smallOrders = await createWorkflow('wf_order', [{ field: 'property', key: 'total', operator: 'less_than', value: '10' }]);
    const personFilter = await createWorkflow('wf_order', [{ field: 'person', key: 'plan', operator: 'equals', value: 'pro' }]);
    const checkoutOnly = await createWorkflow('wf_order', [{ field: 'path', key: '', operator: 'starts_with', value: '/checkout' }]);
    await createWorkflow('wf_order', [], false);
    await createWorkflow('wf_other');

    const { queue, messages } = workflowQueue();
    const response = await sendEvent(queue, { name: 'wf_order', ip: '198.51.100.20', data: { total: 250, sku: 'A-1' }, id: 'buyer-7' });
    expect(response.status).toBe(200);

    expect(messages()).toHaveLength(1);
    const [message] = messages();
    expect(message).toMatchObject({
      type: 'workflow_trigger',
      websiteId: TEST_WEBSITE_ID,
      event: {
        name: 'wf_order',
        hostname: 'example.com',
        urlPath: '/checkout',
        urlQuery: 'step=2',
        properties: { total: 250, sku: 'A-1' },
      },
    });
    expect(message!.event.distinctId).toBeTruthy();
    // Person conditions are checked by the API worker, which can read the person store.
    expect(message!.workflowIds.sort()).toEqual([plain, bigOrders, personFilter, checkoutOnly].sort());
    expect(message!.workflowIds).not.toContain(smallOrders);
  });

  it('queues nothing when no enabled workflow matches', async () => {
    await createWorkflow('wf_quiet', [{ field: 'property', key: 'total', operator: 'exists', value: '' }]);
    const { queue, messages } = workflowQueue();
    await sendEvent(queue, { name: 'wf_quiet', ip: '198.51.100.21' });
    await sendEvent(queue, { name: 'wf_unknown', ip: '198.51.100.21', data: { total: 1 } });
    expect(messages()).toHaveLength(0);
  });

  it('limits triggers per client IP and website', async () => {
    await createWorkflow('wf_throttle_probe');
    const { queue, messages } = workflowQueue();
    for (let i = 0; i < 11; i++) {
      const response = await sendEvent(queue, { name: 'wf_throttle_probe', ip: '203.0.113.10' });
      expect(response.status).toBe(200);
    }
    expect(messages()).toHaveLength(10);
  });

  it('lets a server signed with a personal API key for the site past the per-IP limit', async () => {
    const personalKey = async (userId: string, scopes: string) => {
      const key = generatePersonalApiKey();
      await env.DB.prepare(
        `INSERT INTO personal_api_key (key_id, user_id, name, key_hash, key_prefix, scopes, created_at) VALUES (?1, ?2, 'server', ?3, ?4, ?5, ?6)`,
      )
        .bind(crypto.randomUUID(), userId, await hashApiKey(key), key.slice(0, 10), scopes, Date.now())
        .run();
      return key;
    };
    await env.DB.prepare(`INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES ('wf-stranger', 'wf-stranger', 'hash', 'user', 1, 1)`).run();
    const ownWrite = await personalKey(TEST_USER_ID, 'read,write');
    const ownRead = await personalKey(TEST_USER_ID, 'read');
    const stranger = await personalKey('wf-stranger', 'read,write');
    await createWorkflow('wf_server_renewal');

    const { queue, messages } = workflowQueue();
    for (let i = 0; i < 15; i++) {
      expect((await sendEvent(queue, { name: 'wf_server_renewal', ip: '203.0.113.40', apiKey: ownWrite })).status).toBe(200);
    }
    expect(messages()).toHaveLength(15);

    // A key that cannot write, belongs to someone else or is not a key is refused, not ignored.
    for (const apiKey of [ownRead, stranger, 'fb_sk_not-a-real-key']) {
      expect((await sendEvent(queue, { name: 'wf_server_renewal', ip: '203.0.113.41', apiKey })).status).toBe(401);
    }
    expect(messages()).toHaveLength(15);
  });

  it('queues triggers from PostHog-compatible batches', async () => {
    const workflowId = await createWorkflow('wf_posthog', [{ field: 'property', key: 'plan', operator: 'equals', value: 'pro' }]);
    const { queue, messages } = workflowQueue();
    const event = (plan: string) => ({
      event: 'wf_posthog',
      uuid: crypto.randomUUID(),
      properties: {
        distinct_id: 'ph-user-1',
        $session_id: 'ph-session-wf',
        $current_url: 'https://shop.example.com/upgrade?from=banner',
        $host: 'shop.example.com',
        plan,
      },
      timestamp: new Date().toISOString(),
    });
    const response = await fetchWorkerWithEnv(
      '/batch/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-agent': 'posthog-node/4.2.0', 'cf-connecting-ip': '198.51.100.30' },
        body: JSON.stringify({ api_key: KEY, batch: [event('pro'), event('free')] }),
      },
      { WORKFLOW_QUEUE: queue, EVENT_QUEUE: recordingQueue().queue },
    );
    expect(response.status).toBe(200);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({
      workflowIds: [workflowId],
      event: {
        name: 'wf_posthog',
        distinctId: 'ph-user-1',
        hostname: 'shop.example.com',
        urlPath: '/upgrade',
        urlQuery: 'from=banner',
        properties: expect.objectContaining({ plan: 'pro' }),
      },
    });
  });
});
