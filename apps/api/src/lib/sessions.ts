import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export async function listSessions(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  page = 1,
  pageSize = 20,
) {
  const offset = (page - 1) * pageSize;
  const rows = await env.DB.prepare(
    `SELECT s.session_id as id, s.browser, s.os, s.device, s.country, s.city,
            s.created_at as createdAt,
            COUNT(DISTINCT e.visit_id) as visits,
            SUM(CASE WHEN e.event_type = 1 THEN 1 ELSE 0 END) as pageviews,
            SUM(CASE WHEN e.event_type NOT IN (1, 5, 6, 7) THEN 1 ELSE 0 END) as events,
            MAX(e.created_at) as lastAt
     FROM session s
     INNER JOIN website_event e ON e.session_id = s.session_id
     WHERE s.website_id = ?1 AND e.created_at >= ?2 AND e.created_at <= ?3
     GROUP BY s.session_id
     ORDER BY lastAt DESC
     LIMIT ?4 OFFSET ?5`,
  )
    .bind(websiteId, startAt, endAt, pageSize, offset)
    .all<{
      id: string;
      browser: string | null;
      os: string | null;
      device: string | null;
      country: string | null;
      city: string | null;
      createdAt: number;
      visits: number;
      pageviews: number;
      events: number;
      lastAt: number;
    }>();

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT s.session_id) as count
     FROM session s
     INNER JOIN website_event e ON e.session_id = s.session_id
     WHERE s.website_id = ?1 AND e.created_at >= ?2 AND e.created_at <= ?3`,
  )
    .bind(websiteId, startAt, endAt)
    .first<{ count: number }>();

  return {
    data: rows.results ?? [],
    count: totalRow?.count ?? 0,
    page,
    pageSize,
  };
}

export async function getSession(env: Env, websiteId: string, sessionId: string) {
  const row = await env.DB.prepare(
    `SELECT s.session_id as id, s.browser, s.os, s.device, s.screen, s.language,
            s.country, s.region, s.city, s.distinct_id as distinctId, s.created_at as createdAt
     FROM session s
     WHERE s.session_id = ?1 AND s.website_id = ?2`,
  )
    .bind(sessionId, websiteId)
    .first();

  return row ?? null;
}

export async function getSessionStats(env: Env, websiteId: string, startAt: number, endAt: number) {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT s.session_id) as sessions,
            COUNT(DISTINCT e.visit_id) as visits,
            COUNT(*) as views
     FROM session s
     INNER JOIN website_event e ON e.session_id = s.session_id
     WHERE s.website_id = ?1 AND e.created_at >= ?2 AND e.created_at <= ?3`,
  )
    .bind(websiteId, startAt, endAt)
    .first<{ sessions: number; visits: number; views: number }>();

  return row ?? { sessions: 0, visits: 0, views: 0 };
}

export async function getSessionWeekly(env: Env, websiteId: string, weeks = 12) {
  const rows = await env.DB.prepare(
    `SELECT strftime('%Y-%W', datetime(s.created_at / 1000, 'unixepoch')) as week,
            COUNT(DISTINCT s.session_id) as sessions
     FROM session s
     WHERE s.website_id = ?1
     GROUP BY week
     ORDER BY week DESC
     LIMIT ?2`,
  )
    .bind(websiteId, weeks)
    .all<{ week: string; sessions: number }>();

  return rows.results ?? [];
}

export async function getSessionActivity(env: Env, websiteId: string, sessionId: string) {
  const rows = await env.DB.prepare(
    `SELECT event_id as id, visit_id as visitId, url_path as urlPath,
            event_type as eventType, event_name as eventName, created_at as createdAt
     FROM website_event
     WHERE website_id = ?1 AND session_id = ?2
     ORDER BY created_at ASC`,
  )
    .bind(websiteId, sessionId)
    .all();

  return rows.results ?? [];
}

export async function getSessionProperties(env: Env, websiteId: string, sessionId: string) {
  const rows = await env.DB.prepare(
    `SELECT data_key as key,
            COALESCE(string_value, CAST(number_value AS TEXT)) as value
     FROM session_data
     WHERE website_id = ?1 AND session_id = ?2`,
  )
    .bind(websiteId, sessionId)
    .all<{ key: string; value: string }>();

  return rows.results ?? [];
}

export async function getSessionReplays(env: Env, websiteId: string, sessionId: string) {
  const summary = await env.DB.prepare(
    `SELECT visit_id as visitId, started_at as startedAt, ended_at as endedAt,
            event_count as eventCount, chunks
     FROM session_replay_summary
     WHERE website_id = ?1 AND session_id = ?2
     ORDER BY started_at DESC`,
  )
    .bind(websiteId, sessionId)
    .all();

  if (summary.results?.length) return summary.results;

  const rows = await env.DB.prepare(
    `SELECT visit_id as visitId, MIN(started_at) as startedAt, MAX(ended_at) as endedAt,
            SUM(event_count) as eventCount, COUNT(*) as chunks
     FROM session_replay
     WHERE website_id = ?1 AND session_id = ?2
     GROUP BY visit_id
     ORDER BY startedAt DESC`,
  )
    .bind(websiteId, sessionId)
    .all();

  return rows.results ?? [];
}

export async function exportEventsCsv(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  type: 'events' | 'pageviews',
) {
  const eventType = type === 'pageviews' ? EVENT_TYPE.pageView : undefined;
  const typeClause = eventType !== undefined ? ' AND event_type = ?4' : '';
  const binds: (string | number)[] = [websiteId, startAt, endAt];
  if (eventType !== undefined) binds.push(eventType);

  const rows = await env.DB.prepare(
    `SELECT e.created_at, e.session_id, e.visit_id, e.url_path, e.event_name,
            e.referrer_domain, s.country
     FROM website_event e
     LEFT JOIN session s ON s.session_id = e.session_id AND s.website_id = e.website_id
     WHERE e.website_id = ?1 AND e.created_at >= ?2 AND e.created_at <= ?3${typeClause}
     ORDER BY e.created_at DESC
     LIMIT 10000`,
  )
    .bind(...binds)
    .all<{
      created_at: number;
      session_id: string;
      visit_id: string;
      url_path: string;
      event_name: string | null;
      referrer_domain: string | null;
      country: string | null;
    }>();

  const header = 'createdAt,sessionId,visitId,urlPath,eventName,referrer,country\n';
  const lines = (rows.results ?? []).map(
    (r) =>
      `${r.created_at},${r.session_id},${r.visit_id},"${(r.url_path ?? '').replace(/"/g, '""')}",${r.event_name ?? ''},${r.referrer_domain ?? ''},${r.country ?? ''}`,
  );
  return header + lines.join('\n');
}
