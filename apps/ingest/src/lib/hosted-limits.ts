import {
  currentMonthKey,
  getPlan,
  normalizePlanId,
  usageCeiling,
  type PlanId,
  type UsageCounts,
  type UsageMetric,
} from '@flareboard/shared';
import type { Env } from '../env';
import { isolateMemo } from './isolate-memo';

/**
 * Monthly usage lives in D1 `usage_monthly`: the aggregator counts product events as it writes
 * them, and ingest counts replays and OpenTelemetry rows below. The hot path only reads it,
 * through a short KV cache, so collection can overshoot a ceiling by about a minute of traffic.
 * (Counting every event in one KV key hit KV's one-write-per-second-per-key limit.)
 */
const QUOTA_CACHE_TTL_SEC = 60;

const USAGE_COLUMNS: Record<UsageMetric, string> = {
  events: 'events_count',
  replays: 'replays_count',
  otel: 'otel_rows',
};

const LIMIT_MESSAGES: Record<UsageMetric, string> = {
  events: 'Monthly event limit exceeded.',
  replays: 'Monthly session replay limit exceeded.',
  otel: 'Monthly log and span limit exceeded.',
};

type QuotaState = { planId: PlanId; used: UsageCounts };

function isHostedMode(env: Env): boolean {
  return env.HOSTED_MODE === 'true';
}

const OWNER_MEMO_MS = 5 * 60_000;
const QUOTA_MEMO_MS = 30_000;

function getWebsiteOwnerId(env: Env, websiteId: string): Promise<string | null> {
  return isolateMemo(`owner:${websiteId}`, OWNER_MEMO_MS, () => loadWebsiteOwnerId(env, websiteId));
}

async function loadWebsiteOwnerId(env: Env, websiteId: string): Promise<string | null> {
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

async function loadQuotaState(env: Env, userId: string, monthKey: string): Promise<QuotaState> {
  const [plan, usage] = await Promise.all([
    env.DB.prepare(`SELECT plan_id FROM user_subscription WHERE user_id = ? LIMIT 1`)
      .bind(userId)
      .first<{ plan_id: string }>(),
    env.DB.prepare(
      `SELECT events_count, replays_count, otel_rows FROM usage_monthly WHERE user_id = ? AND month_key = ?`,
    )
      .bind(userId, monthKey)
      .first<{ events_count: number; replays_count: number; otel_rows: number }>(),
  ]);
  return {
    planId: normalizePlanId(plan?.plan_id),
    used: { events: usage?.events_count ?? 0, replays: usage?.replays_count ?? 0, otel: usage?.otel_rows ?? 0 },
  };
}

function getQuotaState(env: Env, userId: string): Promise<QuotaState> {
  return isolateMemo(`quota:${userId}:${currentMonthKey()}`, QUOTA_MEMO_MS, () => loadCachedQuotaState(env, userId));
}

async function loadCachedQuotaState(env: Env, userId: string): Promise<QuotaState> {
  const monthKey = currentMonthKey();
  const cacheKey = `quota:${userId}:${monthKey}`;
  const cached = await env.CACHE.get<QuotaState>(cacheKey, 'json');
  if (cached) return cached;
  const state = await loadQuotaState(env, userId, monthKey);
  await env.CACHE.put(cacheKey, JSON.stringify(state), { expirationTtl: QUOTA_CACHE_TTL_SEC });
  return state;
}

/**
 * Whether the website owner's plan still collects `metric` this month. Past the allowance a
 * plan with grace keeps collecting up to its ceiling (usageCeiling); then this refuses.
 */
export async function assertEventAllowed(
  env: Env,
  websiteId: string,
  metric: UsageMetric = 'events',
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  if (!isHostedMode(env)) return { ok: true, userId: '' };

  const userId = await getWebsiteOwnerId(env, websiteId);
  if (!userId) return { ok: false, message: 'Website not found.' };

  const state = await getQuotaState(env, userId);
  if (state.used[metric] >= usageCeiling(getPlan(state.planId), metric)) {
    return { ok: false, message: LIMIT_MESSAGES[metric] };
  }
  return { ok: true, userId };
}

/** Session replay is a paid feature on Cloud; self-hosted instances always allow it. */
export async function replayAllowedByPlan(env: Env, websiteId: string): Promise<boolean> {
  if (!isHostedMode(env)) return true;
  const userId = await getWebsiteOwnerId(env, websiteId);
  if (!userId) return false;
  return getPlan((await getQuotaState(env, userId)).planId).replayEnabled;
}

/** Counts replays and OpenTelemetry rows (product events are counted by the aggregator). */
export async function recordUsage(env: Env, userId: string, metric: Exclude<UsageMetric, 'events'>, delta: number) {
  if (!isHostedMode(env) || !userId || delta <= 0) return;
  const column = USAGE_COLUMNS[metric];
  await env.DB.prepare(
    `INSERT INTO usage_monthly (user_id, month_key, ${column}) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, month_key) DO UPDATE SET ${column} = ${column} + excluded.${column}`,
  )
    .bind(userId, currentMonthKey(), delta)
    .run();
}
