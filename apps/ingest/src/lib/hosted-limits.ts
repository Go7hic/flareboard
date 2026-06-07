import { currentMonthKey, getPlan, normalizePlanId, type PlanId } from '@flareboard/shared';
import type { Env } from '../env';

function isHostedMode(env: Env): boolean {
  return env.HOSTED_MODE === 'true';
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
  const kv = await env.CACHE.get(`usage:${userId}:${monthKey}`);
  if (kv !== null) return parseInt(kv, 10) || 0;
  const row = await env.DB.prepare(
    `SELECT events_count as c FROM usage_monthly WHERE user_id = ? AND month_key = ?`,
  )
    .bind(userId, monthKey)
    .first<{ c: number }>();
  return row?.c ?? 0;
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
  return { ok: true, userId };
}

export async function recordEventUsage(env: Env, userId: string, delta = 1): Promise<void> {
  if (!isHostedMode(env) || !userId) return;
  const monthKey = currentMonthKey();
  const kvKey = `usage:${userId}:${monthKey}`;
  const used = await getMonthlyUsage(env, userId);
  await env.CACHE.put(kvKey, String(used + delta), { expirationTtl: 60 * 60 * 24 * 40 });
  await env.DB.prepare(
    `INSERT INTO usage_monthly (user_id, month_key, events_count) VALUES (?, ?, ?)
     ON CONFLICT(user_id, month_key) DO UPDATE SET events_count = events_count + excluded.events_count`,
  )
    .bind(userId, monthKey, delta)
    .run();
}
