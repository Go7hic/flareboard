import {
  PLAN_IDS,
  PLANS,
  ROLES,
  currentMonthKey,
  getPlan,
  isUnlimitedWebsites,
  normalizePlanId,
  planForPublic,
  websiteLimitForEnforcement,
  type PlanId,
  type UsageCounts,
} from '@flareboard/shared';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import type { Env } from '../env';
import { isDemoUserId } from './demo-access';

export function isHostedMode(env: Env): boolean {
  return env.HOSTED_MODE === 'true';
}

export function getStripePriceId(env: Env, planId: PlanId): string | null {
  if (planId === 'business') return env.STRIPE_PRICE_BUSINESS ?? null;
  if (planId === 'cloud') return env.STRIPE_PRICE_CLOUD ?? env.STRIPE_PRICE_HOBBY ?? env.STRIPE_PRICE_PRO ?? null;
  return null;
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

/**
 * The team member who takes over a team website's plan and usage when its owner leaves: an
 * owner or manager (the roles that create team websites) other than ?1, with a paid plan first
 * (allowances are flat, so this never adds to their bill), then owners, then the longest member.
 */
const NEXT_TEAM_WEBSITE_OWNER = `SELECT tu.user_id FROM team_user tu
  JOIN user u ON u.user_id = tu.user_id AND u.deleted_at IS NULL
  LEFT JOIN user_subscription s ON s.user_id = tu.user_id
  WHERE tu.team_id = website.team_id AND tu.user_id <> ?1 AND tu.role IN ('${ROLES.teamOwner}', '${ROLES.teamManager}')
  ORDER BY CASE WHEN s.plan_id = 'business' THEN 0 WHEN s.plan_id IN ('cloud', 'hobby', 'pro') THEN 1 ELSE 2 END,
    tu.role <> '${ROLES.teamOwner}', tu.created_at, tu.user_id
  LIMIT 1`;

/**
 * Hands the team websites billed to `userId` (website.user_id, which ingest and the aggregator
 * bill) to another team member, so they keep collecting when that account is deleted.
 * Personal websites stay: they leave with the account. Returns the websites handed over.
 */
export async function handOverTeamWebsites(env: Env, userId: string, now = Date.now()): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `UPDATE website SET user_id = (${NEXT_TEAM_WEBSITE_OWNER}), updated_at = ?2
     WHERE user_id = ?1 AND team_id IS NOT NULL AND (${NEXT_TEAM_WEBSITE_OWNER}) IS NOT NULL
     RETURNING website_id AS websiteId`,
  )
    .bind(userId, now)
    .all<{ websiteId: string }>();
  const websiteIds = (results ?? []).map((row) => row.websiteId);
  // Ingest caches the owner for an hour (hosted-limits.ts).
  await Promise.all(websiteIds.map((id) => env.CACHE.delete(`website:owner:${id}`)));
  return websiteIds;
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
    stripeSubscriptionId: row.stripeSubscriptionId,
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

/** This month's usage per allowance (usage_monthly: events from the aggregator, the rest from ingest). */
export async function getMonthlyUsage(env: Env, userId: string, monthKey = currentMonthKey()): Promise<UsageCounts> {
  const row = await env.DB.prepare(
    `SELECT events_count, replays_count, otel_rows FROM usage_monthly WHERE user_id = ? AND month_key = ?`,
  )
    .bind(userId, monthKey)
    .first<{ events_count: number; replays_count: number; otel_rows: number }>();
  return { events: row?.events_count ?? 0, replays: row?.replays_count ?? 0, otel: row?.otel_rows ?? 0 };
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
  if (env.STRIPE_PRICE_BUSINESS && priceId === env.STRIPE_PRICE_BUSINESS) return 'business';
  if (env.STRIPE_PRICE_CLOUD && priceId === env.STRIPE_PRICE_CLOUD) return 'cloud';
  if (env.STRIPE_PRICE_HOBBY && priceId === env.STRIPE_PRICE_HOBBY) return 'cloud';
  if (env.STRIPE_PRICE_PRO && priceId === env.STRIPE_PRICE_PRO) return 'cloud';
  return 'free';
}
