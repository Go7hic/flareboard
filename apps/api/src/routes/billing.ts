import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { getPlan, type PlanId } from '@flareboard/shared';
import type { Env } from '../env';
import {
  getMonthlyEventUsage,
  getStripePriceId,
  getUserSubscription,
  isHostedMode,
  listPublicPlans,
  planIdFromStripePrice,
  stripeRequest,
  upsertSubscriptionFromStripe,
} from '../lib/billing';
import { badRequest, json, unauthorized } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function dashboardBase(c: Ctx) {
  return (c.env.DASHBOARD_URL ?? c.env.SHARE_URL ?? new URL(c.req.url).origin).replace(/\/$/, '');
}

export async function handleListPlans(c: Ctx) {
  if (!isHostedMode(c.env)) {
    return json({ plans: [], hosted: false });
  }
  return json({ plans: listPublicPlans(), hosted: true });
}

export async function handleGetSubscription(c: Ctx) {
  if (!isHostedMode(c.env)) {
    return json({ hosted: false });
  }
  const userId = c.get('user').userId;
  const sub = await getUserSubscription(c.env, userId);
  const plan = getPlan(sub.planId);
  const usage = await getMonthlyEventUsage(c.env, userId);
  return json({
    hosted: true,
    plan: {
      id: plan.id,
      name: plan.name,
      maxWebsites: plan.maxWebsites,
      maxEventsPerMonth: plan.maxEventsPerMonth,
      replayEnabled: plan.replayEnabled,
      emailReportsEnabled: plan.emailReportsEnabled,
      heatmapsEnabled: plan.heatmapsEnabled,
      teamsEnabled: plan.teamsEnabled,
      dataPortabilityEnabled: plan.dataPortabilityEnabled,
      warehouseEnabled: plan.warehouseEnabled,
      experimentationEnabled: plan.experimentationEnabled,
      surveysEnabled: plan.surveysEnabled,
    },
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    usage: { eventsThisMonth: usage },
  });
}

export async function handleCheckout(c: Ctx) {
  if (!isHostedMode(c.env)) return json({ message: 'Billing is not enabled' }, 404);
  if (!c.env.STRIPE_SECRET_KEY) return json({ message: 'Stripe is not configured' }, 503);

  const body = await c.req.json().catch(() => null);
  const planId = (body as { planId?: string } | null)?.planId;
  if (planId !== 'cloud') return badRequest('Invalid plan');

  const priceId = getStripePriceId(c.env, planId);
  if (!priceId) return json({ message: 'Plan price is not configured' }, 503);

  const userId = c.get('user').userId;
  const db = createDb(c.env.DB);
  const [user] = await db.select().from(schema.user).where(eq(schema.user.userId, userId)).limit(1);
  if (!user) return unauthorized();

  const sub = await getUserSubscription(c.env, userId);
  const base = dashboardBase(c);

  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: userId,
    success_url: `${base}/billing?success=1`,
    cancel_url: `${base}/billing?canceled=1`,
    'metadata[userId]': userId,
    'metadata[planId]': planId,
  };

  if (sub.stripeCustomerId) {
    params.customer = sub.stripeCustomerId;
  } else if (user.email) {
    params.customer_email = user.email;
  }

  const session = await stripeRequest<{ url: string }>(c.env, '/checkout/sessions', params);
  return json({ url: session.url });
}

export async function handlePortal(c: Ctx) {
  if (!isHostedMode(c.env)) return json({ message: 'Billing is not enabled' }, 404);
  if (!c.env.STRIPE_SECRET_KEY) return json({ message: 'Stripe is not configured' }, 503);

  const userId = c.get('user').userId;
  const sub = await getUserSubscription(c.env, userId);
  if (!sub.stripeCustomerId) return badRequest('No billing account yet');

  const session = await stripeRequest<{ url: string }>(c.env, '/billing_portal/sessions', {
    customer: sub.stripeCustomerId,
    return_url: `${dashboardBase(c)}/billing`,
  });
  return json({ url: session.url });
}

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = sigHeader.split(',').reduce(
    (acc, part) => {
      const [k, v] = part.split('=');
      if (k === 't') acc.t = v;
      if (k === 'v1') acc.v1.push(v);
      return acc;
    },
    { t: '', v1: [] as string[] },
  );
  if (!parts.t || !parts.v1.length) return false;

  const signed = `${parts.t}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signed));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return parts.v1.some((v) => v === expected);
}

export async function handleStripeWebhook(c: Ctx) {
  if (!c.env.STRIPE_WEBHOOK_SECRET) return json({ message: 'Webhook not configured' }, 503);

  const payload = await c.req.text();
  const sig = c.req.header('stripe-signature') ?? '';
  const valid = await verifyStripeSignature(payload, sig, c.env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ message: 'Invalid signature' }, 400);

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      client_reference_id?: string;
      customer?: string;
      subscription?: string;
      metadata?: { userId?: string; planId?: string };
    };
    const userId = session.metadata?.userId ?? session.client_reference_id;
    if (userId) {
      let priceId: string | null = null;
      if (session.subscription && c.env.STRIPE_SECRET_KEY) {
        const sub = await stripeRequest<{ items?: { data?: Array<{ price?: { id?: string } }> } }>(
          c.env,
          `/subscriptions/${session.subscription}`,
          {},
          'GET',
        ).catch(() => null);
        priceId = sub?.items?.data?.[0]?.price?.id ?? null;
      }
      const planId = (session.metadata?.planId as PlanId | undefined) ?? planIdFromStripePrice(c.env, priceId);
      await upsertSubscriptionFromStripe(c.env, userId, {
        planId,
        stripeCustomerId: session.customer ?? null,
        stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
        stripePriceId: priceId,
        status: 'active',
      });
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as {
      id?: string;
      customer?: string;
      status?: string;
      current_period_end?: number;
      items?: { data?: Array<{ price?: { id?: string } }> };
      metadata?: { userId?: string };
    };
    const priceId = sub.items?.data?.[0]?.price?.id ?? null;
    let userId = sub.metadata?.userId;
    if (!userId && sub.customer) {
      const row = await c.env.DB.prepare(
        `SELECT user_id FROM user_subscription WHERE stripe_customer_id = ? LIMIT 1`,
      )
        .bind(sub.customer)
        .first<{ user_id: string }>();
      userId = row?.user_id;
    }
    if (userId) {
      const active = sub.status === 'active' || sub.status === 'trialing';
      const planId = active ? planIdFromStripePrice(c.env, priceId) : 'free';
      await upsertSubscriptionFromStripe(c.env, userId, {
        planId,
        stripeCustomerId: sub.customer ?? null,
        stripeSubscriptionId: sub.id ?? null,
        stripePriceId: priceId,
        status: sub.status ?? 'canceled',
        currentPeriodEnd: sub.current_period_end ?? null,
      });
    }
  }

  return json({ received: true });
}
