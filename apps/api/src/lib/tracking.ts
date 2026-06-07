import type { Env } from '../env';

const RECENT_MS = 15 * 60 * 1000;
const PAGEVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getTrackingStatus(env: Env, websiteId: string) {
  const now = Date.now();
  const sinceRecent = now - RECENT_MS;
  const since24h = now - PAGEVIEW_WINDOW_MS;

  const row = await env.DB.prepare(
    `SELECT
       MAX(created_at) as lastEventAt,
       SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) as recentCount,
       SUM(CASE WHEN created_at >= ?3 AND event_type = 1 THEN 1 ELSE 0 END) as pageviews24h
     FROM website_event
     WHERE website_id = ?1`,
  )
    .bind(websiteId, sinceRecent, since24h)
    .first<{
      lastEventAt: number | null;
      recentCount: number | null;
      pageviews24h: number | null;
    }>();

  const recentCount = Number(row?.recentCount ?? 0);
  const pageviews24h = Number(row?.pageviews24h ?? 0);
  const lastEventAt = row?.lastEventAt ?? null;

  return {
    hasRecentData: recentCount > 0,
    lastEventAt,
    pageviews24h,
  };
}
