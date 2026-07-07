import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type GroupFilters = {
  search?: string;
};

function groupKey(groupType: string) {
  return `$group/${groupType}`;
}

function groupPropertyPrefix(groupType: string) {
  return `$group/${groupType}/`;
}

function searchClause(filters: GroupFilters = {}) {
  if (!filters.search?.trim()) return { sql: '', bindings: [] as string[] };
  return {
    sql: `HAVING groupKey LIKE ?6 OR latestName LIKE ?6`,
    bindings: [`%${filters.search.trim()}%`],
  };
}

export async function listGroupTypes(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT substr(data_key, 8) as type
     FROM session_data
     WHERE website_id = ?1
       AND data_key LIKE '$group/%'
       AND instr(substr(data_key, 8), '/') = 0
     ORDER BY type ASC
     LIMIT 50`,
  )
    .bind(websiteId)
    .all<{ type: string }>();

  return (rows.results ?? []).map((row) => row.type).filter(Boolean);
}

export async function listGroups(
  env: Env,
  websiteId: string,
  groupType: string,
  startAt: number,
  endAt: number,
  limit = 100,
  filters: GroupFilters = {},
) {
  const filter = searchClause(filters);
  const rows = await env.DB.prepare(
    `WITH group_sessions AS (
       SELECT sd.session_id as sessionId,
              sd.string_value as groupKey,
              MIN(sd.created_at) as joinedAt
       FROM session_data sd
       WHERE sd.website_id = ?1
         AND sd.data_key = ?2
         AND sd.string_value IS NOT NULL
       GROUP BY sd.session_id, sd.string_value
     ),
     group_props AS (
       SELECT gs.groupKey,
              MAX(CASE WHEN sd.data_key IN (?3, ?4) THEN sd.string_value ELSE NULL END) as latestName
       FROM group_sessions gs
       LEFT JOIN session_data sd ON sd.website_id = ?1
        AND sd.session_id = gs.sessionId
        AND sd.data_key LIKE ?5
       GROUP BY gs.groupKey
     )
     SELECT gs.groupKey,
            group_props.latestName,
            MIN(gs.joinedAt) as firstSeenAt,
            MAX(e.created_at) as lastSeenAt,
            COUNT(DISTINCT gs.sessionId) as sessions,
            COUNT(DISTINCT s.distinct_id) as people,
            COUNT(DISTINCT e.visit_id) as visits,
            SUM(CASE WHEN e.event_type = ?7 THEN 1 ELSE 0 END) as pageviews,
            SUM(CASE WHEN e.event_type NOT IN (1, 5, 6, 7) THEN 1 ELSE 0 END) as events,
            MAX(s.country) as country,
            MAX(s.city) as city
     FROM group_sessions gs
     INNER JOIN session s ON s.session_id = gs.sessionId AND s.website_id = ?1
     INNER JOIN website_event e ON e.session_id = gs.sessionId AND e.website_id = ?1
     LEFT JOIN group_props ON group_props.groupKey = gs.groupKey
     WHERE e.created_at >= ?8 AND e.created_at <= ?9
     GROUP BY gs.groupKey
     ${filter.sql}
     ORDER BY lastSeenAt DESC
     LIMIT ?${filter.bindings.length ? 10 : 6}`,
  )
    .bind(
      websiteId,
      groupKey(groupType),
      `${groupPropertyPrefix(groupType)}name`,
      `${groupPropertyPrefix(groupType)}$name`,
      `${groupPropertyPrefix(groupType)}%`,
      ...(filter.bindings.length ? filter.bindings : [Math.min(Math.max(limit, 1), 500)]),
      EVENT_TYPE.pageView,
      startAt,
      endAt,
      ...(filter.bindings.length ? [Math.min(Math.max(limit, 1), 500)] : []),
    )
    .all<{
      groupKey: string;
      latestName: string | null;
      firstSeenAt: number | null;
      lastSeenAt: number | null;
      sessions: number;
      people: number;
      visits: number;
      pageviews: number;
      events: number;
      country: string | null;
      city: string | null;
    }>();

  return rows.results ?? [];
}

export async function getGroupDetail(env: Env, websiteId: string, groupType: string, groupId: string) {
  const sessions = await env.DB.prepare(
    `WITH group_sessions AS (
       SELECT sd.session_id as sessionId,
              MIN(sd.created_at) as joinedAt
       FROM session_data sd
       WHERE sd.website_id = ?1
         AND sd.data_key = ?2
         AND sd.string_value = ?3
       GROUP BY sd.session_id
     )
     SELECT s.session_id as id, s.distinct_id as distinctId, s.browser, s.os, s.device, s.country, s.city,
            s.created_at as createdAt,
            COUNT(e.event_id) as events,
            MAX(e.created_at) as lastSeenAt
     FROM group_sessions gs
     INNER JOIN session s ON s.session_id = gs.sessionId AND s.website_id = ?1
     LEFT JOIN website_event e ON e.session_id = gs.sessionId AND e.website_id = ?1
     GROUP BY s.session_id
     ORDER BY lastSeenAt DESC
     LIMIT 50`,
  )
    .bind(websiteId, groupKey(groupType), groupId)
    .all<{
      id: string;
      distinctId: string | null;
      browser: string | null;
      os: string | null;
      device: string | null;
      country: string | null;
      city: string | null;
      createdAt: number | null;
      events: number;
      lastSeenAt: number | null;
    }>();

  if (!(sessions.results ?? []).length) return null;

  const properties = await env.DB.prepare(
    `WITH group_sessions AS (
       SELECT sd.session_id as sessionId
       FROM session_data sd
       WHERE sd.website_id = ?1
         AND sd.data_key = ?2
         AND sd.string_value = ?3
       GROUP BY sd.session_id
     )
     SELECT replace(sd.data_key, ?4, '') as key,
            COALESCE(sd.string_value, CAST(sd.number_value AS TEXT), CAST(sd.date_value AS TEXT)) as value,
            MAX(sd.created_at) as updatedAt
     FROM group_sessions gs
     INNER JOIN session_data sd ON sd.website_id = ?1 AND sd.session_id = gs.sessionId
     WHERE sd.data_key LIKE ?5
     GROUP BY sd.data_key
     ORDER BY updatedAt DESC
     LIMIT 100`,
  )
    .bind(websiteId, groupKey(groupType), groupId, groupPropertyPrefix(groupType), `${groupPropertyPrefix(groupType)}%`)
    .all<{ key: string; value: string | null; updatedAt: number | null }>();

  const events = await env.DB.prepare(
    `WITH group_sessions AS (
       SELECT sd.session_id as sessionId
       FROM session_data sd
       WHERE sd.website_id = ?1
         AND sd.data_key = ?2
         AND sd.string_value = ?3
       GROUP BY sd.session_id
     )
     SELECT e.event_id as id, e.session_id as sessionId, e.visit_id as visitId,
            e.url_path as urlPath, e.event_name as eventName, e.event_type as eventType,
            e.created_at as createdAt
     FROM group_sessions gs
     INNER JOIN website_event e ON e.website_id = ?1 AND e.session_id = gs.sessionId
     ORDER BY e.created_at DESC
     LIMIT 100`,
  )
    .bind(websiteId, groupKey(groupType), groupId)
    .all<{
      id: string;
      sessionId: string;
      visitId: string;
      urlPath: string | null;
      eventName: string | null;
      eventType: number;
      createdAt: number;
    }>();

  return {
    groupType,
    groupKey: groupId,
    sessions: sessions.results ?? [],
    properties: properties.results ?? [],
    events: events.results ?? [],
  };
}
