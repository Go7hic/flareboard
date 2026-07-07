import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type PeriodStats = {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
};

/** Raw website_event aggregates for one time range (no segment/cohort filters). */
export async function queryPeriodStats(
  env: Env,
  websiteId: string,
  rangeStart: number,
  rangeEnd: number,
): Promise<PeriodStats> {
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN event_type = ?4 THEN 1 ELSE 0 END) as pageviews,
       COUNT(DISTINCT session_id) as visitors,
       COUNT(DISTINCT visit_id) as visits
     FROM website_event
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3`,
  )
    .bind(websiteId, rangeStart, rangeEnd, EVENT_TYPE.pageView)
    .first<{ pageviews: number; visitors: number; visits: number }>();

  const bounceRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM (
      SELECT visit_id FROM website_event
      WHERE website_id = ?1 AND event_type = ?2
        AND created_at >= ?3 AND created_at <= ?4
      GROUP BY visit_id HAVING COUNT(*) = 1
    )`,
  )
    .bind(websiteId, EVENT_TYPE.pageView, rangeStart, rangeEnd)
    .first<{ count: number }>();

  const timeRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(duration_ms), 0) as total FROM (
      SELECT (MAX(created_at) - MIN(created_at)) as duration_ms
      FROM website_event
      WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
      GROUP BY visit_id
    )`,
  )
    .bind(websiteId, rangeStart, rangeEnd)
    .first<{ total: number }>();

  return {
    pageviews: row?.pageviews ?? 0,
    visitors: row?.visitors ?? 0,
    visits: row?.visits ?? 0,
    bounces: bounceRow?.count ?? 0,
    totaltime: Math.round((timeRow?.total ?? 0) / 1000),
  };
}
