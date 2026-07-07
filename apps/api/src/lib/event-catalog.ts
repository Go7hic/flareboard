import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type EventCatalogFilters = {
  search?: string;
};

function eventSearch(filters: EventCatalogFilters = {}) {
  const search = filters.search?.trim();
  if (!search) return { clause: '', bindings: [] as string[] };
  return {
    clause: 'AND e.event_name LIKE ?5',
    bindings: [`%${search}%`],
  };
}

export async function getEventCatalog(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: EventCatalogFilters = {},
) {
  const search = eventSearch(filters);
  const rows = await env.DB.prepare(
    `SELECT e.event_name as eventName,
            COUNT(DISTINCT e.event_id) as events,
            COUNT(DISTINCT e.session_id) as sessions,
            COUNT(DISTINCT e.visit_id) as visits,
            MIN(e.created_at) as firstSeenAt,
            MAX(e.created_at) as lastSeenAt,
            COUNT(DISTINCT ed.data_key) as propertyCount,
            GROUP_CONCAT(DISTINCT ed.data_key) as propertyKeys,
            COUNT(DISTINCT e.url_path) as paths
     FROM website_event e
     LEFT JOIN event_data ed ON ed.website_event_id = e.event_id AND ed.website_id = e.website_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND e.event_name IS NOT NULL
       ${search.clause}
     GROUP BY e.event_name
     ORDER BY lastSeenAt DESC
     LIMIT 200`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.customEvent, ...search.bindings)
    .all<{
      eventName: string;
      events: number;
      sessions: number;
      visits: number;
      firstSeenAt: number | null;
      lastSeenAt: number | null;
      propertyCount: number;
      propertyKeys: string | null;
      paths: number;
    }>();

  return (rows.results ?? []).map((row) => ({
    ...row,
    propertyKeys: row.propertyKeys
      ? row.propertyKeys
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
          .sort()
      : [],
  }));
}

export async function getEventCatalogDetail(
  env: Env,
  websiteId: string,
  eventName: string,
  startAt: number,
  endAt: number,
) {
  const [summary, properties, paths, recent] = await Promise.all([
    env.DB.prepare(
      `SELECT e.event_name as eventName,
              COUNT(*) as events,
              COUNT(DISTINCT e.session_id) as sessions,
              COUNT(DISTINCT e.visit_id) as visits,
              MIN(e.created_at) as firstSeenAt,
              MAX(e.created_at) as lastSeenAt
       FROM website_event e
       WHERE e.website_id = ?1
         AND e.created_at >= ?2
         AND e.created_at <= ?3
         AND e.event_type = ?4
         AND e.event_name = ?5
       GROUP BY e.event_name`,
    )
      .bind(websiteId, startAt, endAt, EVENT_TYPE.customEvent, eventName)
      .first<{
        eventName: string;
        events: number;
        sessions: number;
        visits: number;
        firstSeenAt: number | null;
        lastSeenAt: number | null;
      }>(),
    env.DB.prepare(
      `SELECT ed.data_key as key,
              COUNT(*) as count,
              COUNT(DISTINCT COALESCE(ed.string_value, CAST(ed.number_value AS TEXT), CAST(ed.date_value AS TEXT))) as valuesCount
       FROM event_data ed
       INNER JOIN website_event e ON e.event_id = ed.website_event_id AND e.website_id = ed.website_id
       WHERE e.website_id = ?1
         AND e.created_at >= ?2
         AND e.created_at <= ?3
         AND e.event_type = ?4
         AND e.event_name = ?5
       GROUP BY ed.data_key
       ORDER BY count DESC, ed.data_key ASC
       LIMIT 100`,
    )
      .bind(websiteId, startAt, endAt, EVENT_TYPE.customEvent, eventName)
      .all<{ key: string; count: number; valuesCount: number }>(),
    env.DB.prepare(
      `SELECT e.url_path as path,
              COUNT(*) as events,
              COUNT(DISTINCT e.session_id) as sessions,
              MAX(e.created_at) as lastSeenAt
       FROM website_event e
       WHERE e.website_id = ?1
         AND e.created_at >= ?2
         AND e.created_at <= ?3
         AND e.event_type = ?4
         AND e.event_name = ?5
       GROUP BY e.url_path
       ORDER BY events DESC, path ASC
       LIMIT 20`,
    )
      .bind(websiteId, startAt, endAt, EVENT_TYPE.customEvent, eventName)
      .all<{ path: string; events: number; sessions: number; lastSeenAt: number | null }>(),
    env.DB.prepare(
      `SELECT e.event_id as id,
              e.session_id as sessionId,
              e.visit_id as visitId,
              e.url_path as urlPath,
              e.created_at as createdAt
       FROM website_event e
       WHERE e.website_id = ?1
         AND e.created_at >= ?2
         AND e.created_at <= ?3
         AND e.event_type = ?4
         AND e.event_name = ?5
       ORDER BY e.created_at DESC
       LIMIT 25`,
    )
      .bind(websiteId, startAt, endAt, EVENT_TYPE.customEvent, eventName)
      .all<{
        id: string;
        sessionId: string;
        visitId: string;
        urlPath: string | null;
        createdAt: number;
      }>(),
  ]);

  if (!summary) return null;
  return {
    summary,
    properties: properties.results ?? [],
    paths: paths.results ?? [],
    recent: recent.results ?? [],
  };
}
