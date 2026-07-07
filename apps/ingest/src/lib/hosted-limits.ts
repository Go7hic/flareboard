import { currentMonthKey, getPlan, normalizePlanId, type PlanId } from '@flareboard/shared';
import type { Env } from '../env';

const USAGE_KV_TTL_SEC = 60 * 60 * 24 * 40;

function isHostedMode(env: Env): boolean {
  return env.HOSTED_MODE === 'true';
}

function usageKey(userId: string, monthKey: string): string {
  return `usage:${userId}:${monthKey}`;
}

async function getWebsiteOwnerId(env: Env, websiteId: string): Promise<string | null> {
  const cacheKey = `website:owner:${websiteId}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return cached;

  const row = await env.DB.prepare(
    `SELECT user_id FROM website WHERE website_id = ? AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(websiteId)
    .first<{ user_id: string | null }>();
  const userId = row?.user_id ?? null;
  if (userId) await env.CACHE.put(cacheKey, userId, { expirationTtl: 3600 });
  return userId;
}

async function getPlanIdForUser(env: Env, userId: string): Promise<PlanId> {
  const cacheKey = `sub:plan:${userId}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached === 'free' || cached === 'cloud') return cached;
  if (cached === 'hobby' || cached === 'pro') return 'cloud';

  const row = await env.DB.prepare(
    `SELECT plan_id FROM user_subscription WHERE user_id = ? LIMIT 1`,
  )
    .bind(userId)
    .first<{ plan_id: string }>();
  const planId = normalizePlanId(row?.plan_id);
  await env.CACHE.put(cacheKey, planId, { expirationTtl: 300 });
  return planId;
}

async function getMonthlyUsage(env: Env, userId: string): Promise<number> {
  const monthKey = currentMonthKey();
  const [kv, row] = await Promise.all([
    env.CACHE.get(usageKey(userId, monthKey)),
    env.DB.prepare(
      `SELECT events_count as c FROM usage_monthly WHERE user_id = ? AND month_key = ?`,
    )
      .bind(userId, monthKey)
      .first<{ c: number }>(),
  ]);
  const kvCount = kv !== null ? parseInt(kv, 10) || 0 : 0;
  const d1Count = row?.c ?? 0;
  return Math.max(kvCount, d1Count);
}

export async function assertEventAllowed(
  env: Env,
  websiteId: string,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  if (!isHostedMode(env)) return { ok: true, userId: '' };

  const userId = await getWebsiteOwnerId(env, websiteId);
  if (!userId) return { ok: false, message: 'Website not found.' };

  const plan = getPlan(await getPlanIdForUser(env, userId));
  const used = await getMonthlyUsage(env, userId);
  if (used >= plan.maxEventsPerMonth) {
    return { ok: false, message: 'Monthly event limit exceeded.' };
  }

  await recordEventUsageKv(env, userId, 1);
  return { ok: true, userId };
}

/** KV counter on the ingest hot path; D1 persistence runs in the aggregator. */
export async function recordEventUsageKv(env: Env, userId: string, delta = 1): Promise<void> {
  if (!isHostedMode(env) || !userId) return;
  const monthKey = currentMonthKey();
  const key = usageKey(userId, monthKey);
  const current = await env.CACHE.get(key);
  const count = current !== null ? parseInt(current, 10) || 0 : await getMonthlyUsage(env, userId);
  await env.CACHE.put(key, String(count + delta), { expirationTtl: USAGE_KV_TTL_SEC });
}

/** @deprecated Use recordEventUsageKv on ingest; D1 writes belong in the aggregator. */
export async function recordEventUsage(env: Env, userId: string, delta = 1): Promise<void> {
  return recordEventUsageKv(env, userId, delta);
}
