import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSecureToken, getPlan, ROLES } from '@flareboard/shared';
import worker from '../../src/index';
import { planIdFromStripePrice, getStripePriceId } from '../../src/lib/billing';
import { applyTestMigrations } from '../helpers/migrations';

const NEW_USER = 'checkout-new-user';
const CLOUD_USER = 'checkout-cloud-user';
const STRIPE = {
  HOSTED_MODE: 'true',
  STRIPE_SECRET_KEY: 'sk_test_checkout',
  STRIPE_PRICE_CLOUD: 'price_cloud_19',
  STRIPE_PRICE_BUSINESS: 'price_business_99',
};

type StripeCall = { path: string; method: string; body: URLSearchParams };

function mockStripe() {
  const calls: StripeCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call = { path: url.pathname, method: init?.method ?? 'GET', body: new URLSearchParams(String(init?.body ?? '')) };
    calls.push(call);
    if (call.path === '/v1/checkout/sessions') return Response.json({ url: 'https://checkout.stripe.test/session' });
    if (call.path === '/v1/subscriptions/sub_cloud' && call.method === 'GET') {
      return Response.json({ id: 'sub_cloud', items: { data: [{ id: 'si_cloud', price: { id: 'price_cloud_19' } }] } });
    }
    if (call.path === '/v1/subscriptions/sub_cloud') return Response.json({ id: 'sub_cloud' });
    return Response.json({ error: { message: `unexpected ${call.path}` } }, { status: 400 });
  });
  return calls;
}

async function checkout(userId: string, planId: string) {
  const token = await createSecureToken({ userId, role: ROLES.user }, env.APP_SECRET);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request('http://example.com/api/billing/checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    }),
    { ...env, ...STRIPE },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('checkout for Cloud and Business', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, email, created_at, updated_at)
       VALUES (?1, ?1, 'x', 'user', 'new@example.test', ?3, ?3), (?2, ?2, 'x', 'user', 'cloud@example.test', ?3, ?3)`,
    )
      .bind(NEW_USER, CLOUD_USER, now)
      .run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO user_subscription (user_id, plan_id, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, created_at, updated_at)
       VALUES (?1, 'cloud', 'active', 'cus_cloud', 'sub_cloud', 'price_cloud_19', ?2, ?2)`,
    )
      .bind(CLOUD_USER, now)
      .run();
  });

  afterEach(() => vi.restoreAllMocks());

  it('maps each paid plan to its own Stripe price', () => {
    const configured = { ...env, ...STRIPE };
    expect(getStripePriceId(configured, 'cloud')).toBe('price_cloud_19');
    expect(getStripePriceId(configured, 'business')).toBe('price_business_99');
    // A legacy price never stands in for Business.
    expect(getStripePriceId({ ...env, STRIPE_PRICE_HOBBY: 'price_hobby' }, 'business')).toBeNull();
    expect(planIdFromStripePrice(configured, 'price_business_99')).toBe('business');
    expect(planIdFromStripePrice(configured, 'price_cloud_19')).toBe('cloud');
    expect(getPlan('business').monthlyPriceUsd).toBe(99);
  });

  it('sends a new customer to Stripe Checkout with the chosen plan', async () => {
    const calls = mockStripe();
    const result = await checkout(NEW_USER, 'business');
    expect(result).toEqual({ status: 200, body: { url: 'https://checkout.stripe.test/session' } });
    expect(calls[0]!.body.get('line_items[0][price]')).toBe('price_business_99');
    expect(calls[0]!.body.get('metadata[planId]')).toBe('business');
  });

  it('switches an existing subscription in place instead of opening a second one', async () => {
    const calls = mockStripe();
    const result = await checkout(CLOUD_USER, 'business');
    expect(result).toEqual({ status: 200, body: { switched: true, planId: 'business' } });
    const update = calls.find((call) => call.method === 'POST' && call.path === '/v1/subscriptions/sub_cloud')!;
    expect(update.body.get('items[0][id]')).toBe('si_cloud');
    expect(update.body.get('items[0][price]')).toBe('price_business_99');
    expect(update.body.get('proration_behavior')).toBe('create_prorations');
    expect(calls.some((call) => call.path === '/v1/checkout/sessions')).toBe(false);
    const row = await env.DB.prepare(`SELECT plan_id FROM user_subscription WHERE user_id = ?1`).bind(CLOUD_USER).first<{ plan_id: string }>();
    expect(row!.plan_id).toBe('business');

    mockStripe();
    expect((await checkout(CLOUD_USER, 'business')).status).toBe(400);
    expect((await checkout(CLOUD_USER, 'enterprise')).status).toBe(400);
  });
});
