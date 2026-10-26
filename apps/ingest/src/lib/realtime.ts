import type { Env } from '../env';
import { siteDb } from './site-db';

/** Matches the API realtime window (5 min). */
const WINDOW_MS = 5 * 60 * 1000;
/** Per-isolate memo, so polling clients cost one store query per website every few seconds. */
const MEMO_MS = 5_000;
const memo = new Map<string, { at: number; users: number }>();

/**
 * Sessions with any event in the last five minutes, read from the website's events. Rows dated
 * ahead of `now` (generators that write in advance) are left out.
 */
export async function countActiveVisitors(env: Env, websiteId: string, now = Date.now()) {
  const cached = memo.get(websiteId);
  if (cached && now >= cached.at && now - cached.at < MEMO_MS) return cached.users;
  const row = await siteDb(env, websiteId)
    .prepare(
      `SELECT COUNT(DISTINCT session_id) AS users FROM website_event
       WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3`,
    )
    .bind(websiteId, now - WINDOW_MS, now)
    .first<{ users: number }>();
  const users = Number(row?.users ?? 0);
  memo.set(websiteId, { at: now, users });
  return users;
}
