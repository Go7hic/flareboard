import { EVENT_TYPE } from '@flareboard/shared';
import {
  parsePersonProperties,
  patchPersonProperties,
  personPropertyString,
  type PersonProperties,
} from '@flareboard/db';
import type { Env } from '../env';

export type PeopleFilters = {
  search?: string;
};

function personKeySql() {
  return `COALESCE(NULLIF(s.distinct_id, ''), latest_identity.distinctId, s.session_id)`;
}

function searchClause(filters: PeopleFilters = {}) {
  if (!filters.search?.trim()) return { sql: '', bindings: [] as string[] };
  const value = `%${filters.search.trim()}%`;
  return {
    sql: `HAVING personId LIKE ?4 OR latestEmail LIKE ?4 OR latestName LIKE ?4 OR latestAlias LIKE ?4`,
    bindings: [value],
  };
}

export async function getStoredPerson(env: Env, websiteId: string, distinctId: string) {
  const row = await env.DB.prepare(
    `SELECT person_id as personId,
            distinct_id as distinctId,
            properties_json as propertiesJson,
            first_seen_at as firstSeenAt,
            last_seen_at as lastSeenAt,
            created_at as createdAt,
            updated_at as updatedAt
     FROM person
     WHERE website_id = ?1 AND distinct_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, distinctId)
    .first<{
      personId: string;
      distinctId: string;
      propertiesJson: string;
      firstSeenAt: number | null;
      lastSeenAt: number | null;
      createdAt: number | null;
      updatedAt: number | null;
    }>();

  if (!row) return null;
  return {
    ...row,
    properties: parsePersonProperties(row.propertiesJson),
  };
}

export async function patchPerson(
  env: Env,
  websiteId: string,
  distinctId: string,
  properties: PersonProperties,
) {
  return patchPersonProperties(env.DB, websiteId, distinctId, properties);
}

export async function listPeople(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  limit = 100,
  filters: PeopleFilters = {},
) {
  const filter = searchClause(filters);
  const rows = await env.DB.prepare(
    `WITH latest_identity AS (
       SELECT sd.session_id as sessionId,
              MAX(sd.distinct_id) as distinctId
       FROM session_data sd
       WHERE sd.website_id = ?1 AND sd.distinct_id IS NOT NULL
       GROUP BY sd.session_id
     ),
     latest_props AS (
       SELECT ${personKeySql()} as personId,
              MAX(CASE WHEN sd.data_key IN ('email', '$email') THEN sd.string_value ELSE NULL END) as latestEmail,
              MAX(CASE WHEN sd.data_key IN ('name', 'displayName', '$name') THEN sd.string_value ELSE NULL END) as latestName
       FROM session s
       LEFT JOIN latest_identity ON latest_identity.sessionId = s.session_id
       LEFT JOIN session_data sd ON sd.session_id = s.session_id AND sd.website_id = s.website_id
       WHERE s.website_id = ?1
       GROUP BY ${personKeySql()}
     )
     SELECT ${personKeySql()} as personId,
            COALESCE(
              latest_props.latestEmail,
              json_extract(p.properties_json, '$.email'),
              json_extract(p.properties_json, '$.$email')
            ) as latestEmail,
            COALESCE(
              latest_props.latestName,
              json_extract(p.properties_json, '$.name'),
              json_extract(p.properties_json, '$.displayName'),
              json_extract(p.properties_json, '$.$name')
            ) as latestName,
            json_extract(p.properties_json, '$.$alias') as latestAlias,
            MIN(COALESCE(p.first_seen_at, s.created_at)) as firstSeenAt,
            MAX(COALESCE(p.last_seen_at, e.created_at)) as lastSeenAt,
            COUNT(DISTINCT s.session_id) as sessions,
            COUNT(DISTINCT e.visit_id) as visits,
            SUM(CASE WHEN e.event_type = ?3 THEN 1 ELSE 0 END) as pageviews,
            SUM(CASE WHEN e.event_type NOT IN (1, 5, 6, 7) THEN 1 ELSE 0 END) as events,
            MAX(s.country) as country,
            MAX(s.city) as city,
            MAX(p.person_id) as storedPersonId
     FROM session s
     LEFT JOIN latest_identity ON latest_identity.sessionId = s.session_id
     INNER JOIN website_event e ON e.session_id = s.session_id AND e.website_id = s.website_id
     LEFT JOIN latest_props ON latest_props.personId = ${personKeySql()}
     LEFT JOIN person p ON p.website_id = ?1 AND p.distinct_id = ${personKeySql()}
     WHERE s.website_id = ?1 AND e.created_at >= ?2 AND e.created_at <= ?5
     GROUP BY ${personKeySql()}
     ${filter.sql}
     ORDER BY lastSeenAt DESC
     LIMIT ?${filter.bindings.length ? 6 : 4}`,
  )
    .bind(
      websiteId,
      startAt,
      EVENT_TYPE.pageView,
      ...(filter.bindings.length ? filter.bindings : [Math.min(Math.max(limit, 1), 500)]),
      ...(filter.bindings.length ? [endAt, Math.min(Math.max(limit, 1), 500)] : [endAt]),
    )
    .all<{
      personId: string;
      latestEmail: string | null;
      latestName: string | null;
      latestAlias: string | null;
      firstSeenAt: number | null;
      lastSeenAt: number | null;
      sessions: number;
      visits: number;
      pageviews: number;
      events: number;
      country: string | null;
      city: string | null;
      storedPersonId: string | null;
    }>();

  return rows.results ?? [];
}

export async function getPersonDetail(env: Env, websiteId: string, personId: string) {
  const stored = await getStoredPerson(env, websiteId, personId);

  const sessions = await env.DB.prepare(
    `WITH latest_identity AS (
       SELECT sd.session_id as sessionId,
              MAX(sd.distinct_id) as distinctId
       FROM session_data sd
       WHERE sd.website_id = ?1 AND sd.distinct_id IS NOT NULL
       GROUP BY sd.session_id
     )
     SELECT s.session_id as id, s.browser, s.os, s.device, s.country, s.city,
            s.created_at as createdAt,
            COUNT(e.event_id) as events,
            MAX(e.created_at) as lastSeenAt
     FROM session s
     LEFT JOIN latest_identity ON latest_identity.sessionId = s.session_id
     LEFT JOIN website_event e ON e.session_id = s.session_id AND e.website_id = s.website_id
     WHERE s.website_id = ?1 AND ${personKeySql()} = ?2
     GROUP BY s.session_id
     ORDER BY lastSeenAt DESC
     LIMIT 50`,
  )
    .bind(websiteId, personId)
    .all<{
      id: string;
      browser: string | null;
      os: string | null;
      device: string | null;
      country: string | null;
      city: string | null;
      createdAt: number | null;
      events: number;
      lastSeenAt: number | null;
    }>();

  if (!(sessions.results ?? []).length && !stored) return null;

  const properties = await env.DB.prepare(
    `WITH latest_identity AS (
       SELECT sd.session_id as sessionId,
              MAX(sd.distinct_id) as distinctId
       FROM session_data sd
       WHERE sd.website_id = ?1 AND sd.distinct_id IS NOT NULL
       GROUP BY sd.session_id
     )
     SELECT sd.data_key as key,
            COALESCE(sd.string_value, CAST(sd.number_value AS TEXT), CAST(sd.date_value AS TEXT)) as value,
            MAX(sd.created_at) as updatedAt
     FROM session s
     LEFT JOIN latest_identity ON latest_identity.sessionId = s.session_id
     INNER JOIN session_data sd ON sd.session_id = s.session_id AND sd.website_id = s.website_id
     WHERE s.website_id = ?1 AND ${personKeySql()} = ?2
     GROUP BY sd.data_key
     ORDER BY updatedAt DESC
     LIMIT 100`,
  )
    .bind(websiteId, personId)
    .all<{ key: string; value: string | null; updatedAt: number | null }>();

  const mergedProperties = new Map<string, { key: string; value: string | null; updatedAt: number | null }>();
  for (const row of properties.results ?? []) {
    mergedProperties.set(row.key, row);
  }
  if (stored) {
    const seenAt = stored.updatedAt ?? stored.lastSeenAt ?? Date.now();
    for (const [key, value] of Object.entries(stored.properties)) {
      if (value == null) continue;
      mergedProperties.set(key, {
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        updatedAt: seenAt,
      });
    }
  }

  const events = await env.DB.prepare(
    `WITH latest_identity AS (
       SELECT sd.session_id as sessionId,
              MAX(sd.distinct_id) as distinctId
       FROM session_data sd
       WHERE sd.website_id = ?1 AND sd.distinct_id IS NOT NULL
       GROUP BY sd.session_id
     )
     SELECT e.event_id as id, e.session_id as sessionId, e.visit_id as visitId,
            e.url_path as urlPath, e.event_name as eventName, e.event_type as eventType,
            e.created_at as createdAt
     FROM website_event e
     INNER JOIN session s ON s.session_id = e.session_id AND s.website_id = e.website_id
     LEFT JOIN latest_identity ON latest_identity.sessionId = s.session_id
     WHERE e.website_id = ?1 AND ${personKeySql()} = ?2
     ORDER BY e.created_at DESC
     LIMIT 100`,
  )
    .bind(websiteId, personId)
    .all<{
      id: string;
      sessionId: string;
      visitId: string;
      urlPath: string | null;
      eventName: string | null;
      eventType: number;
      createdAt: number;
    }>();

  const memberships = stored
    ? await env.DB.prepare(
        `SELECT group_type as groupType, group_key as groupKey, created_at as createdAt
         FROM person_group_membership
         WHERE website_id = ?1 AND person_id = ?2
         ORDER BY created_at DESC
         LIMIT 50`,
      )
        .bind(websiteId, stored.personId)
        .all<{ groupType: string; groupKey: string; createdAt: number | null }>()
    : { results: [] as { groupType: string; groupKey: string; createdAt: number | null }[] };

  return {
    personId,
    profile: stored
      ? {
          personId: stored.personId,
          distinctId: stored.distinctId,
          firstSeenAt: stored.firstSeenAt,
          lastSeenAt: stored.lastSeenAt,
          email: personPropertyString(stored.properties, ['email', '$email']),
          name: personPropertyString(stored.properties, ['name', 'displayName', '$name']),
        }
      : null,
    groups: memberships.results ?? [],
    sessions: sessions.results ?? [],
    properties: Array.from(mergedProperties.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    events: events.results ?? [],
  };
}
