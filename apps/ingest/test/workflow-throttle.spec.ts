import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerJson } from './helpers/fetch-worker';

const TRIGGER_EVENT = 'wf_throttle_probe';
const TRIGGER_IP = '203.0.113.10';
const DELIVERY_IP_PREFIX = '203.0.113.';

async function sendTriggerEvent(ip: string, eventName = TRIGGER_EVENT) {
  return fetchWorkerJson<{ cache?: string; sessionId?: string }>('/api/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify({
      type: 'event',
      payload: {
        website: TEST_WEBSITE_ID,
        hostname: 'example.com',
        url: '/checkout',
        name: eventName,
      },
    }),
  });
}

describe('workflow public trigger throttling', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('limits workflow triggers per IP and website before recording executions', async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, created_at, updated_at)
       VALUES ('workflow-ip-trigger-limit', ?1, 'IP limit probe', ?2, 1, 'record', ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, TRIGGER_EVENT, now)
      .run();

    for (let i = 0; i < 11; i++) {
      const { response } = await sendTriggerEvent(TRIGGER_IP);
      expect(response.status).toBe(200);
    }

    const count = await env.DB.prepare(
      `SELECT COUNT(*) as total
       FROM workflow_execution
       WHERE website_id = ?1 AND workflow_id = 'workflow-ip-trigger-limit'`,
    )
      .bind(TEST_WEBSITE_ID)
      .first<{ total: number }>();

    expect(count?.total).toBe(10);
  });

  it('marks outbound workflow deliveries throttled after the hourly website cap', async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, action_config, created_at, updated_at)
       VALUES ('workflow-delivery-limit', ?1, 'Delivery limit probe', ?2, 1, 'webhook', ?3, ?4, ?4)`,
    )
      .bind(
        TEST_WEBSITE_ID,
        'wf_delivery_probe',
        JSON.stringify({ url: 'https://example.com/webhook' }),
        now,
      )
      .run();

    for (let i = 0; i < 61; i++) {
      const { response } = await sendTriggerEvent(`${DELIVERY_IP_PREFIX}${100 + i}`, 'wf_delivery_probe');
      expect(response.status).toBe(200);
    }

    const throttled = await env.DB.prepare(
      `SELECT status
       FROM workflow_execution
       WHERE website_id = ?1 AND workflow_id = 'workflow-delivery-limit' AND status = 'throttled'
       LIMIT 1`,
    )
      .bind(TEST_WEBSITE_ID)
      .first<{ status: string }>();

    expect(throttled).toEqual({ status: 'throttled' });
  });
});
