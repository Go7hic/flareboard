import type { Env } from '../env';

/** Per-website tracker behavior (website.autocapture / persist_visitors / respect_dnt). */
export type TrackerSettings = {
  autocapture: boolean;
  persistVisitors: boolean;
  respectDnt: boolean;
};

/** The API deletes this key when a website's tracker settings change. */
export function trackerSettingsKey(websiteId: string) {
  return `tracker-settings:${websiteId}`;
}

const KV_TTL_SECONDS = 300;
const MEMO_TTL_MS = 30_000;
const MEMO_MAX = 1000;
const memo = new Map<string, { expires: number; value: TrackerSettings | null }>();

/** Test hook: forget the in-isolate copy so a changed setting is read again. */
export function forgetTrackerSettings(websiteId?: string) {
  if (websiteId) memo.delete(websiteId);
  else memo.clear();
}

function fromRow(row: { autocapture: number | null; persistVisitors: number | null; respectDnt: number | null }) {
  return {
    autocapture: row.autocapture !== 0,
    persistVisitors: row.persistVisitors === 1,
    respectDnt: row.respectDnt === 1,
  };
}

/**
 * Settings for a live website, or null when it does not exist. Anonymous events from sites that
 * remember visitors read this on every request, so it is cached in the isolate (30 s) and in KV
 * (5 min) in front of D1.
 */
export async function getTrackerSettings(env: Env, websiteId: string): Promise<TrackerSettings | null> {
  const now = Date.now();
  const hit = memo.get(websiteId);
  if (hit && hit.expires > now) return hit.value;

  let value: TrackerSettings | null = null;
  const cached = await env.CACHE.get(trackerSettingsKey(websiteId));
  if (cached) {
    try {
      value = JSON.parse(cached) as TrackerSettings | null;
    } catch {
      value = null;
    }
  } else {
    const row = await env.DB.prepare(
      `SELECT autocapture, persist_visitors as persistVisitors, respect_dnt as respectDnt
       FROM website
       WHERE website_id = ?1 AND deleted_at IS NULL`,
    )
      .bind(websiteId)
      .first<{ autocapture: number | null; persistVisitors: number | null; respectDnt: number | null }>();
    value = row ? fromRow(row) : null;
    await env.CACHE.put(trackerSettingsKey(websiteId), JSON.stringify(value), { expirationTtl: KV_TTL_SECONDS });
  }

  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(websiteId, { expires: now + MEMO_TTL_MS, value });
  return value;
}

/**
 * The distinct id ingest should use for an event. Identified ids pass through unchanged. An
 * anonymous id (the tracker's `anonymousId`, sent as the distinct id until identify()) is kept
 * only when the website remembers visitors; otherwise it is dropped and the visitor is counted
 * with the cookieless IP + user agent hash exactly as before.
 */
export async function resolveDistinctId(
  env: Env,
  websiteId: string | undefined,
  id: string | undefined,
  anonymousId: string | undefined,
): Promise<string | undefined> {
  if (!anonymousId?.trim() || (id && id !== anonymousId)) return id;
  if (!websiteId) return undefined;
  const settings = await getTrackerSettings(env, websiteId);
  return settings?.persistVisitors ? anonymousId : undefined;
}
