import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import type { Env } from '../../src/env';
import { applyTestMigrations } from '../helpers/migrations';
import { createTestUser } from '../helpers/auth';

const SECRET = 'whsec_billing_spec';
const CLOUD_PRICE = 'price_cloud_spec';

async function signature(payload: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return `t=${timestamp},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Stripe telling us the subscription changed status. */
async function subscriptionUpdated(userId: string, status: string) {
  const payload = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_spec',
        customer: 'cus_spec',
        status,
        current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30,
        items: { data: [{ price: { id: CLOUD_PRICE } }] },
        metadata: { userId },
      },
    },
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request('http://example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': await signature(payload) },
      body: payload,
    }),
    { ...(env as unknown as Env), STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_CLOUD: CLOUD_PRICE } as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(200);
  return env.DB.prepare('SELECT plan_id AS planId, status FROM user_subscription WHERE user_id = ?1')
    .bind(userId)
    .first<{ planId: string; status: string }>();
}

describe('Stripe subscription status', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('keeps the paid plan while Stripe retries a failed payment, and drops it when Stripe gives up', async () => {
    const userId = await createTestUser('billing-past-due', 'billing-password');
    expect(await subscriptionUpdated(userId, 'active')).toEqual({ planId: 'cloud', status: 'active' });
    expect(await subscriptionUpdated(userId, 'past_due')).toEqual({ planId: 'cloud', status: 'past_due' });
    expect(await subscriptionUpdated(userId, 'active')).toEqual({ planId: 'cloud', status: 'active' });
    expect(await subscriptionUpdated(userId, 'unpaid')).toEqual({ planId: 'free', status: 'unpaid' });
  });
});
