import {
  PLAN_IDS,
  PLANS,
  currentMonthKey,
  getPlan,
  isUnlimitedWebsites,
  normalizePlanId,
  planForPublic,
  websiteLimitForEnforcement,
  type PlanId,
} from '@flareboard/shared';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import type { Env } from '../env';
import { isDemoUserId } from './demo-access';

export function isHostedMode(env: Env): boolean {
  return env.HOSTED_MODE === 'true';
}

export function getStripePriceId(env: Env, planId: PlanId): string | null {
  const plan = PLANS[planId];
  if (!plan.stripePriceEnvKey) return null;
  const map: Record<string, string | undefined> = {
    STRIPE_PRICE_CLOUD: env.STRIPE_PRICE_CLOUD,
    STRIPE_PRICE_HOBBY: env.STRIPE_PRICE_HOBBY,
    STRIPE_PRICE_PRO: env.STRIPE_PRICE_PRO,
  };
  return map[plan.stripePriceEnvKey] ?? env.STRIPE_PRICE_HOBBY ?? env.STRIPE_PRICE_PRO ?? null;
}

/** Plan the read-only demo account browses under. It has no subscription row and never pays. */
const DEMO_PLAN_ID: PlanId = 'cloud';

/**
 * Plan that governs a website's features: its owner's (website.user_id), the same
 * account ingest bills events to. Team members use the site under the owner's plan.
 */
export async function getWebsitePlanId(env: Env, website: { userId: string | null }, fallbackUserId: string) {
  // The demo shows every feature on the demo websites, whatever their owner's plan.
  if (isDemoUserId(fallbackUserId)) return DEMO_PLAN_ID;
  const sub = await getUserSubscription(env, website.userId ?? fallbackUserId);
  return sub.planId;
}

export async function getUserSubscription(env: Env, userId: string) {
  if (isDemoUserId(userId)) {
    return { planId: DEMO_PLAN_ID, status: 'active' as const, stripeCustomerId: null as string | null };
  }
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.userSubscription)
    .where(eq(schema.userSubscription.userId, userId))
    .limit(1);
  if (!row) {
    return { planId: 'free' as PlanId, status: 'active' as const, stripeCustomerId: null as string | null };
  }
  const planId = (PLAN_IDS.includes(row.planId as PlanId) ? row.planId : normalizePlanId(row.planId)) as PlanId;
  return {
    planId,
    status: row.status,
    stripeCustomerId: row.stripeCustomerId,
    currentPeriodEnd: row.currentPeriodEnd,
  };
}

export async function ensureSubscriptionRow(env: Env, userId: string) {
  const db = createDb(env.DB);
  const [existing] = await db
    .select({ userId: schema.userSubscription.userId })
    .from(schema.userSubscription)
    .where(eq(schema.userSubscription.userId, userId))
    .limit(1);
  if (existing) return;
  const now = new Date();
  await db.insert(schema.userSubscription).values({
    userId,
    planId: 'free',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

export async function countUserWebsites(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM website WHERE user_id = ? AND deleted_at IS NULL`,
  )
    .bind(userId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function getMonthlyEventUsage(env: Env, userId: string, monthKey = currentMonthKey()): Promise<number> {
  const kvKey = `usage:${userId}:${monthKey}`;
  const kv = await env.CACHE.get(kvKey);
  if (kv !== null) return parseInt(kv, 10) || 0;

  const row = await env.DB.prepare(
    `SELECT events_count as c FROM usage_monthly WHERE user_id = ? AND month_key = ?`,
  )
    .bind(userId, monthKey)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function checkWebsiteLimit(env: Env, userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isHostedMode(env)) return { ok: true };
  const sub = await getUserSubscription(env, userId);
  const plan = getPlan(sub.planId);
  const count = await countUserWebsites(env, userId);
  const limit = websiteLimitForEnforcement(plan);
  if (count >= limit) {
    return {
      ok: false,
      message: isUnlimitedWebsites(plan)
        ? `Website limit reached (${limit}). Contact hello@flareboard.dev if you need more.`
        : `Website limit reached (${limit} on ${plan.name} plan). Upgrade to add more.`,
    };
  }
  return { ok: true };
}

export function listPublicPlans() {
  return PLAN_IDS.map((id) => planForPublic(PLANS[id]));
}

export async function stripeRequest<T>(
  env: Env,
  path: string,
  params: Record<string, string>,
  method = 'POST',
): Promise<T> {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe is not configured');

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : new URLSearchParams(params).toString(),
  });

  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Stripe error ${res.status}`);
  }
  return data;
}

export async function upsertSubscriptionFromStripe(
  env: Env,
  userId: string,
  data: {
    planId: PlanId;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripePriceId?: string | null;
    status: string;
    currentPeriodEnd?: number | null;
  },
) {
  const db = createDb(env.DB);
  const now = new Date();
  await db
    .insert(schema.userSubscription)
    .values({
      userId,
      planId: data.planId,
      stripeCustomerId: data.stripeCustomerId ?? null,
      stripeSubscriptionId: data.stripeSubscriptionId ?? null,
      stripePriceId: data.stripePriceId ?? null,
      status: data.status,
      currentPeriodEnd: data.currentPeriodEnd ? new Date(data.currentPeriodEnd * 1000) : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.userSubscription.userId,
      set: {
        planId: data.planId,
        stripeCustomerId: data.stripeCustomerId ?? null,
        stripeSubscriptionId: data.stripeSubscriptionId ?? null,
        stripePriceId: data.stripePriceId ?? null,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd ? new Date(data.currentPeriodEnd * 1000) : null,
        updatedAt: now,
      },
    });
}

export function planIdFromStripePrice(env: Env, priceId: string | null | undefined): PlanId {
  if (!priceId) return 'free';
  if (env.STRIPE_PRICE_CLOUD && priceId === env.STRIPE_PRICE_CLOUD) return 'cloud';
  if (env.STRIPE_PRICE_HOBBY && priceId === env.STRIPE_PRICE_HOBBY) return 'cloud';
  if (env.STRIPE_PRICE_PRO && priceId === env.STRIPE_PRICE_PRO) return 'cloud';
  return 'free';
}
