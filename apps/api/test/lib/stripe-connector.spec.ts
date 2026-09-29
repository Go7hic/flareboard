import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import {
  loadStripeSyncState,
  StripeApiError,
  syncStripeDataSource,
} from '../../src/lib/stripe-connector';
import {
  createWarehouseDataSource,
  deleteWarehouseDataSource,
  getWarehouseDataSource,
  syncWarehouseDataSource,
  updateWarehouseDataSource,
} from '../../src/lib/warehouse';
import { loadWarehouseCredential } from '../../src/lib/warehouse-credentials';
import { getRevenueAttribution, getRevenueReport, getSubscriptionMetrics } from '../../src/lib/revenue-analytics';
import { createFakeStripe, subscriptionLine, unix, type FakeStripe } from '../helpers/fake-stripe';
import { applyTestMigrations } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const API_KEY = 'rk_test_51FakeRestrictedKey0001';
const OWNER = 'stripe-owner';
const appEnv = env as unknown as Env;
let siteSeq = 0;

async function createWebsite() {
  siteSeq++;
  const websiteId = `stripe-site-${siteSeq}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    `INSERT INTO website (website_id, name, domain, user_id, created_at, updated_at) VALUES (?1, 'Shop', 'shop.test', ?2, 0, 0)`,
  )
    .bind(websiteId, OWNER)
    .run();
  return websiteId;
}

async function createStripeSource(websiteId: string) {
  return createWarehouseDataSource(appEnv, websiteId, OWNER, {
    name: 'Stripe',
    type: 'stripe',
    enabled: true,
    config: { apiKey: API_KEY },
  });
}

async function count(websiteId: string, table: string, dataSourceId: string) {
  const row = await testSiteDb(websiteId)
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE website_id = ?1 AND data_source_id = ?2`)
    .bind(websiteId, dataSourceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** A small account: 3 customers, 2 subscriptions, 3 invoices, 3 charges, 1 refund. */
function seedAccount(stripe: FakeStripe) {
  const jan = unix(2026, 1, 5);
  stripe.customers.push(
    { id: 'cus_A', object: 'customer', created: jan, email: 'Ada@Example.com', name: 'Ada', metadata: {}, address: { line1: 'secret street' } },
    { id: 'cus_B', object: 'customer', created: jan + 60, email: 'bob@example.com', name: 'Bob', metadata: { distinct_id: 'user-bob' } },
    { id: 'cus_C', object: 'customer', created: jan + 120, email: null, name: 'Cy', metadata: {} },
  );
  stripe.subscriptions.push(
    {
      id: 'sub_A',
      object: 'subscription',
      created: jan,
      customer: 'cus_A',
      status: 'active',
      currency: 'usd',
      start_date: jan,
      items: { data: [{ id: 'si_A', quantity: 1, price: { unit_amount: 2000, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
    },
    {
      id: 'sub_B',
      object: 'subscription',
      created: jan + 60,
      customer: 'cus_B',
      status: 'active',
      currency: 'usd',
      start_date: jan + 60,
      items: { data: [{ id: 'si_B', quantity: 2, price: { unit_amount: 12000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 } } }] },
    },
  );
  // Invoice A carries 2 lines inline and a third behind `has_more` (fetched from /lines).
  const lineA1 = subscriptionLine('il_A1', 'sub_A', 2000, jan);
  const lineA2 = subscriptionLine('il_A2', 'sub_A', 500, jan, 1, { proration: true });
  const lineA3 = subscriptionLine('il_A3', 'sub_A', 300, jan, 1, { type: 'invoiceitem', subscription: null, price: null });
  stripe.invoiceLines.set('in_A', [lineA1, lineA2, lineA3]);
  stripe.invoices.push(
    {
      id: 'in_A',
      object: 'invoice',
      created: jan,
      customer: 'cus_A',
      subscription: 'sub_A',
      status: 'paid',
      currency: 'usd',
      total: 2800,
      amount_paid: 2800,
      status_transitions: { paid_at: jan + 5 },
      lines: { object: 'list', data: [lineA1, lineA2], has_more: true },
      hosted_invoice_url: 'https://invoice.stripe.com/secret',
    },
    {
      id: 'in_B',
      object: 'invoice',
      created: jan + 60,
      customer: 'cus_B',
      subscription: 'sub_B',
      status: 'paid',
      currency: 'usd',
      total: 24000,
      amount_paid: 24000,
      lines: { object: 'list', data: [subscriptionLine('il_B1', 'sub_B', 24000, jan + 60, 12, { quantity: 2 })], has_more: false },
    },
    {
      id: 'in_void',
      object: 'invoice',
      created: jan + 90,
      customer: 'cus_C',
      subscription: null,
      status: 'void',
      currency: 'usd',
      total: 999,
      amount_paid: 0,
      lines: { object: 'list', data: [], has_more: false },
    },
  );
  stripe.charges.push(
    { id: 'ch_A', object: 'charge', created: jan + 5, customer: 'cus_A', invoice: 'in_A', amount: 2800, amount_captured: 2800, amount_refunded: 0, currency: 'usd', status: 'succeeded', paid: true, captured: true, payment_method_details: { card: { last4: '4242' } } },
    { id: 'ch_B', object: 'charge', created: jan + 65, customer: 'cus_B', invoice: 'in_B', amount: 24000, amount_captured: 24000, amount_refunded: 0, currency: 'usd', status: 'succeeded', paid: true, captured: true },
    { id: 'ch_failed', object: 'charge', created: jan + 95, customer: 'cus_C', amount: 999, amount_captured: 0, currency: 'usd', status: 'failed', paid: false, captured: false },
  );
  stripe.refunds.push({ id: 're_B', object: 'refund', created: jan + 100, charge: 'ch_B', amount: 4000, currency: 'usd', status: 'succeeded' });
}

describe('Stripe connector', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (?1, ?1, 'x', 'admin', 0, 0)`,
    )
      .bind(OWNER)
      .run();
  });

  it('stores the restricted key encrypted and never in the returned config', async () => {
    const websiteId = await createWebsite();
    const source = await createStripeSource(websiteId);
    expect(source.config).toEqual({ apiKeyHint: 'rk_test_…0001' });
    const row = await env.DB.prepare(`SELECT ciphertext, hint FROM warehouse_credential WHERE data_source_id = ?1`)
      .bind(source.id)
      .first<{ ciphertext: string; hint: string }>();
    expect(row!.ciphertext).not.toContain('FakeRestricted');
    expect(row!.hint).toBe('rk_test_…0001');
    const raw = await env.DB.prepare(`SELECT config_json FROM warehouse_data_source WHERE data_source_id = ?1`)
      .bind(source.id)
      .first<{ config_json: string }>();
    expect(raw!.config_json).not.toContain('FakeRestricted');
    expect(await loadWarehouseCredential(appEnv, websiteId, source.id)).toBe(API_KEY);

    await expect(
      createWarehouseDataSource(appEnv, websiteId, OWNER, { name: 'x', type: 'stripe', enabled: true, config: { apiKey: 'sk_live_full_access' } }),
    ).rejects.toThrow(/restricted API key/);
    await expect(
      createWarehouseDataSource(appEnv, websiteId, OWNER, { name: 'x', type: 'postgres', enabled: true, config: {} }),
    ).rejects.toThrow(/Unsupported data source type/);
  });

  it('backfills with pagination, resumes from the saved cursor, and upserts idempotently', async () => {
    const websiteId = await createWebsite();
    const source = await createStripeSource(websiteId);
    const stripe = createFakeStripe(API_KEY);
    seedAccount(stripe);
    const now = Date.UTC(2026, 1, 1);
    const opts = { fetch: stripe.fetch, sleep: async () => {}, now, pageSize: 2 };

    // Budget of 4 requests: event probe, customers page 1 + 2, subscriptions page 1.
    const first = await syncStripeDataSource(appEnv, websiteId, source.id, { ...opts, maxRequests: 4 });
    expect(first.complete).toBe(false);
    expect(first.requests).toBe(4);
    const saved = await loadStripeSyncState(appEnv, websiteId, source.id);
    expect(saved.phase).toBe('backfill');
    expect(saved.resource).toBe(2); // customers and subscriptions done, invoices next
    expect(await count(websiteId, 'stripe_customer', source.id)).toBe(3);
    expect(await count(websiteId, 'stripe_invoice', source.id)).toBe(0);
    expect(stripe.calls[1]).toBe('/v1/customers?limit=2');
    expect(stripe.calls[2]).toBe('/v1/customers?limit=2&starting_after=cus_B');

    const second = await syncStripeDataSource(appEnv, websiteId, source.id, { ...opts, maxRequests: 50 });
    expect(second.complete).toBe(true);
    expect(second.phase).toBe('events');
    // Resumed at invoices: no customer or subscription page was fetched again.
    const resumedCalls = stripe.calls.slice(4);
    expect(resumedCalls.some((call) => call.startsWith('/v1/customers'))).toBe(false);
    expect(resumedCalls).toContain('/v1/invoices/in_A/lines?limit=100&starting_after=il_A2');
    expect(await count(websiteId, 'stripe_subscription', source.id)).toBe(2);
    expect(await count(websiteId, 'stripe_invoice', source.id)).toBe(3);
    expect(await count(websiteId, 'stripe_invoice_line', source.id)).toBe(4);
    expect(await count(websiteId, 'stripe_charge', source.id)).toBe(3);
    expect(await count(websiteId, 'stripe_refund', source.id)).toBe(1);

    const db = testSiteDb(websiteId);
    const charge = await db
      .prepare(`SELECT amount_major, currency, payload_json FROM stripe_charge WHERE charge_id = 'ch_A'`)
      .first<{ amount_major: number; currency: string; payload_json: string }>();
    expect(charge).toMatchObject({ amount_major: 28, currency: 'USD' });
    expect(charge!.payload_json).not.toContain('4242');
    const invoice = await db.prepare(`SELECT payload_json FROM stripe_invoice WHERE invoice_id = 'in_A'`).first<{ payload_json: string }>();
    expect(invoice!.payload_json).not.toContain('invoice.stripe.com');
    const lines = await db
      .prepare(`SELECT line_id, proration, mrr_major FROM stripe_invoice_line WHERE invoice_id = 'in_A' ORDER BY line_id`)
      .all<{ line_id: string; proration: number; mrr_major: number }>();
    expect(lines.results).toEqual([
      { line_id: 'il_A1', proration: 0, mrr_major: 20 },
      { line_id: 'il_A2', proration: 1, mrr_major: 0 },
      { line_id: 'il_A3', proration: 0, mrr_major: 0 },
    ]);
    const yearly = await db.prepare(`SELECT mrr_major FROM stripe_invoice_line WHERE line_id = 'il_B1'`).first<{ mrr_major: number }>();
    expect(yearly!.mrr_major).toBe(20); // 240.00 per year
    const sub = await db.prepare(`SELECT mrr_major FROM stripe_subscription WHERE subscription_id = 'sub_B'`).first<{ mrr_major: number }>();
    expect(sub!.mrr_major).toBe(20); // 2 × 120.00 per year

    // A third run with nothing new: one events request, no duplicate rows. The account had no
    // events when the backfill began, so the events phase asks for everything created since.
    const callsBefore = stripe.calls.length;
    const third = await syncStripeDataSource(appEnv, websiteId, source.id, { ...opts, maxRequests: 50 });
    expect(third.complete).toBe(true);
    expect(stripe.calls.length - callsBefore).toBe(1);
    expect(stripe.calls[stripe.calls.length - 1]).toMatch(/^\/v1\/events\?limit=2&created%5Bgt%5D=\d+&types%5B%5D=customer.created/);
    expect(await count(websiteId, 'stripe_charge', source.id)).toBe(3);
    expect(await count(websiteId, 'stripe_invoice_line', source.id)).toBe(4);
  });

  it('applies events after the backfill in order and restarts when the cursor expired', async () => {
    const websiteId = await createWebsite();
    const source = await createStripeSource(websiteId);
    const stripe = createFakeStripe(API_KEY);
    seedAccount(stripe);
    stripe.emit('customer.created', stripe.customers[0]!, unix(2026, 1, 5)); // before the backfill
    const opts = { fetch: stripe.fetch, sleep: async () => {}, pageSize: 2, maxRequests: 50 };
    await syncStripeDataSource(appEnv, websiteId, source.id, { ...opts, now: Date.UTC(2026, 1, 1) });
    expect((await loadStripeSyncState(appEnv, websiteId, source.id)).eventCursor).toBe('evt_0001');

    const later = unix(2026, 2, 10);
    const canceled = { ...stripe.subscriptions[0]!, status: 'active', cancel_at_period_end: true };
    stripe.emit('customer.subscription.updated', canceled, later);
    stripe.emit('customer.subscription.deleted', { ...canceled, status: 'canceled', ended_at: later + 10, canceled_at: later + 10 }, later + 10);
    stripe.emit('refund.created', { id: 're_A', object: 'refund', created: later + 20, charge: 'ch_A', amount: 800, currency: 'usd', status: 'succeeded' }, later + 20);
    stripe.emit('customer.deleted', { id: 'cus_C', object: 'customer', deleted: true, created: 0 }, later + 30);

    const result = await syncStripeDataSource(appEnv, websiteId, source.id, { ...opts, now: Date.UTC(2026, 2, 11) });
    expect(result.complete).toBe(true);
    // Two pages of two events after the cursor.
    expect(stripe.calls.filter((call) => call.includes('ending_before')).length).toBeGreaterThanOrEqual(2);
    const db = testSiteDb(websiteId);
    const sub = await db
      .prepare(`SELECT status, ended_at FROM stripe_subscription WHERE subscription_id = 'sub_A'`)
      .first<{ status: string; ended_at: number }>();
    expect(sub).toEqual({ status: 'canceled', ended_at: (later + 10) * 1000 });
    expect(await count(websiteId, 'stripe_refund', source.id)).toBe(2);
    const deleted = await db.prepare(`SELECT deleted, name FROM stripe_customer WHERE customer_id = 'cus_C'`).first();
    expect(deleted).toEqual({ deleted: 1, name: 'Cy' });
    expect((await loadStripeSyncState(appEnv, websiteId, source.id)).eventCursor).toBe('evt_0005');

    // Stripe dropped the cursor event (30-day retention): the next run starts a new backfill.
    stripe.events.splice(0, stripe.events.length);
    const expired = await syncStripeDataSource(appEnv, websiteId, source.id, { ...opts, now: Date.UTC(2026, 5, 1) });
    expect(expired.complete).toBe(false);
    expect((await loadStripeSyncState(appEnv, websiteId, source.id)).phase).toBe('backfill');
  });

  it('backs off on 429 using Retry-After, then fails the run with a resumable error', async () => {
    const websiteId = await createWebsite();
    const source = await createStripeSource(websiteId);
    const stripe = createFakeStripe(API_KEY);
    seedAccount(stripe);
    const sleeps: number[] = [];
    stripe.rateLimitNext = 2;
    const result = await syncStripeDataSource(appEnv, websiteId, source.id, {
      fetch: stripe.fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: Date.UTC(2026, 1, 1),
      maxRequests: 50,
    });
    expect(sleeps).toEqual([1000, 1000]);
    expect(result.complete).toBe(true);
    expect(await count(websiteId, 'stripe_charge', source.id)).toBe(3);

    stripe.rateLimitNext = 10;
    await expect(
      syncStripeDataSource(appEnv, websiteId, source.id, { fetch: stripe.fetch, sleep: async () => {}, maxRequests: 50 }),
    ).rejects.toBeInstanceOf(StripeApiError);

    stripe.rateLimitNext = 10;
    const viaSource = await syncWarehouseDataSource(appEnv, websiteId, source.id, Date.UTC(2026, 1, 2), {
      stripe: { fetch: stripe.fetch, sleep: async () => {}, maxRequests: 50 },
    });
    expect(viaSource).toMatchObject({ ok: false, error: 'Stripe rate limit reached; the sync resumes on the next run' });
    expect((await getWarehouseDataSource(appEnv, websiteId, source.id))!.lastStatus).toBe('failed');
  });

  it('links customers to people by metadata distinct_id or email and feeds revenue, attribution and MRR', async () => {
    const websiteId = await createWebsite();
    const db = testSiteDb(websiteId);
    const t0 = Date.UTC(2026, 0, 1);
    await db
      .prepare(
        `INSERT INTO person (person_id, website_id, distinct_id, properties_json, first_seen_at, last_seen_at, created_at, updated_at)
         VALUES ('p-ada', ?1, 'user-ada', '{"email":"ada@example.com"}', ?2, ?2, ?2, ?2)`,
      )
      .bind(websiteId, t0)
      .run();
    for (const [sessionId, distinctId, utm, at] of [
      ['s-ada-1', 'user-ada', 'newsletter', t0],
      ['s-ada-2', 'user-ada', 'google', t0 + 86_400_000],
      ['s-bob', 'user-bob', null, t0],
      ['s-anon', null, 'twitter', t0],
    ] as const) {
      await db
        .prepare(`INSERT INTO session (session_id, website_id, distinct_id, created_at) VALUES (?1, ?2, ?3, ?4)`)
        .bind(sessionId, websiteId, distinctId, at)
        .run();
      await db
        .prepare(
          `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, utm_source, referrer_domain, event_type)
           VALUES (?1, ?2, ?3, 'v', ?4, '/', ?5, 'ref.example', 1)`,
        )
        .bind(`e-${sessionId}`, websiteId, sessionId, at, utm)
        .run();
    }
    // A tracker revenue event in an anonymous session keeps working next to Stripe.
    await db
      .prepare(
        `INSERT INTO revenue (revenue_id, website_id, session_id, event_id, event_name, currency, revenue, created_at)
         VALUES ('rev-1', ?1, 's-anon', 'e-s-anon', 'purchase', 'usd', 15, ?2)`,
      )
      .bind(websiteId, Date.UTC(2026, 0, 6))
      .run();

    const source = await createStripeSource(websiteId);
    const stripe = createFakeStripe(API_KEY);
    seedAccount(stripe);
    await syncStripeDataSource(appEnv, websiteId, source.id, {
      fetch: stripe.fetch,
      sleep: async () => {},
      now: Date.UTC(2026, 1, 1),
      maxRequests: 50,
    });

    const linked = await db
      .prepare(`SELECT customer_id, distinct_id FROM stripe_customer WHERE website_id = ?1 ORDER BY customer_id`)
      .bind(websiteId)
      .all();
    expect(linked.results).toEqual([
      { customer_id: 'cus_A', distinct_id: 'user-ada' }, // email match (case-insensitive)
      { customer_id: 'cus_B', distinct_id: 'user-bob' }, // metadata
      { customer_id: 'cus_C', distinct_id: null },
    ]);

    const range = [Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 31)] as const;
    const report = await getRevenueReport(appEnv, websiteId, ...range);
    // 28 (ch_A) + 240 (ch_B) − 40 (re_B) + 15 (event); the failed charge is excluded.
    expect(report.totals).toEqual([{ currency: 'USD', total: 243, transactions: 4 }]);
    expect(report.byEvent.map((row) => [row.eventName, row.source, row.total])).toEqual([
      ['stripe_charge', 'stripe', 268],
      ['purchase', 'event', 15],
      ['stripe_refund', 'stripe', -40],
    ]);

    const bySource = await getRevenueAttribution(appEnv, websiteId, ...range, 'utm_source');
    // Ada's first session came from the newsletter, Bob's had no UTM, the anonymous purchase from twitter.
    expect(bySource).toEqual([
      { value: null, currency: 'USD', total: 200, transactions: 2, customers: 1 },
      { value: 'newsletter', currency: 'USD', total: 28, transactions: 1, customers: 1 },
      { value: 'twitter', currency: 'USD', total: 15, transactions: 1, customers: 1 },
    ]);

    const metrics = await getSubscriptionMetrics(appEnv, websiteId, Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 20));
    expect(metrics.latest).toEqual([
      expect.objectContaining({ period: '2026-01', currency: 'USD', mrr: 40, arr: 480, subscribers: 2, newMrr: 40, arpu: 20 }),
    ]);
  });

  it('removes key, cursor and imported rows when the source is deleted or its key replaced', async () => {
    const websiteId = await createWebsite();
    const source = await createStripeSource(websiteId);
    const stripe = createFakeStripe(API_KEY);
    seedAccount(stripe);
    await syncStripeDataSource(appEnv, websiteId, source.id, { fetch: stripe.fetch, sleep: async () => {}, maxRequests: 50 });
    expect(await count(websiteId, 'stripe_charge', source.id)).toBe(3);

    const rotated = await updateWarehouseDataSource(appEnv, websiteId, source.id, {
      config: { apiKey: 'rk_live_51OtherAccountKey9999' },
    });
    expect(rotated!.config).toEqual({ apiKeyHint: 'rk_live_…9999' });
    expect(await count(websiteId, 'stripe_charge', source.id)).toBe(0);
    expect((await loadStripeSyncState(appEnv, websiteId, source.id)).backfillStartedAt).toBeNull();
    expect(await loadWarehouseCredential(appEnv, websiteId, source.id)).toBe('rk_live_51OtherAccountKey9999');

    // Renaming keeps the key hint.
    const renamed = await updateWarehouseDataSource(appEnv, websiteId, source.id, { name: 'Billing', config: {} });
    expect(renamed!.config).toEqual({ apiKeyHint: 'rk_live_…9999' });

    expect(await deleteWarehouseDataSource(appEnv, websiteId, source.id)).toBe(true);
    const leftovers = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM warehouse_credential WHERE data_source_id = ?1) +
              (SELECT COUNT(*) FROM warehouse_sync_state WHERE data_source_id = ?1) AS n`,
    )
      .bind(source.id)
      .first<{ n: number }>();
    expect(leftovers!.n).toBe(0);
  });

  it('reports removed connector types as failed instead of pretending to sync', async () => {
    const websiteId = await createWebsite();
    await env.DB.prepare(
      `INSERT INTO warehouse_data_source (data_source_id, website_id, name, type, enabled, config_json, created_at, updated_at)
       VALUES ('legacy-pg', ?1, 'Old Postgres', 'postgres', 1, '{}', 0, 0)`,
    )
      .bind(websiteId)
      .run();
    const result = await syncWarehouseDataSource(appEnv, websiteId, 'legacy-pg');
    expect(result).toMatchObject({ ok: false, error: 'Unsupported data source type: postgres. Delete this source.' });
    expect((await getWarehouseDataSource(appEnv, websiteId, 'legacy-pg'))!.lastStatus).toBe('failed');
  });
});
