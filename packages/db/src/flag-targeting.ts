import {
  EVENT_TYPE,
  featureFlagTargetingNeeds,
  parseCohortDefinition,
  type CohortCondition,
  type CohortDefinition,
  type FeatureFlagConfigForEvaluation,
  type FeatureFlagEvaluationContext,
} from '@flareboard/shared';
import { parsePersonProperties } from './person-store';
import { compilePropertyFilters, likeContainsPattern, SqlParams, type CompiledFilter } from './property-filters';

/**
 * Lookups that turn a caller's identity into the targeting data feature flags evaluate against:
 * stored person properties, group keys and group properties, and cohort membership.
 * Shared by the API (server-side evaluation) and ingest (the tracker's evaluate endpoint).
 */

/**
 * Cohort membership answers are cached per (cohort version, person) for this long. Cohorts are
 * behavioural (events and page views), so membership needs a scan of the person's sessions;
 * the cache bounds that to once per person and cohort per TTL. A person who just did the
 * qualifying action can therefore wait up to this long (plus ingest queue lag) to match.
 */
export const COHORT_MEMBERSHIP_CACHE_TTL_SECONDS = 300;

/** Sessions tagged with a distinct id can start a little before its person row was created. */
const PERSON_SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type FlagTargetingStores = {
  /** D1 handle for D1-only tables (cohort). */
  db: D1Database;
  /** Handle for the website's analytics tables (person, session, …): `siteDb(env, websiteId)` in the API. */
  site: D1Database;
  /** KV used to cache cohort membership. Optional: without it every evaluation queries. */
  cache?: KVNamespace;
};

export type FlagPerson = {
  personId: string;
  properties: Record<string, unknown>;
  firstSeenAt: number | null;
};

export type FlagCohort = {
  id: string;
  name: string;
  definition: CohortDefinition;
  updatedAt: number | null;
};

/**
 * WHERE fragment for one cohort condition over `website_event e` (and `session s` when
 * `needsSession`, joined on `s.session_id = e.session_id`). This is the single definition of what
 * a cohort condition matches: apps/api/src/lib/cohorts.ts builds cohort reports from it too.
 */
export function cohortConditionWhere(
  condition: CohortCondition,
  params: SqlParams,
  websiteId: string,
  windowStart?: number | null,
  windowEnd?: number | null,
): CompiledFilter {
  const clauses: string[] = [`e.website_id = ${params.add(websiteId)}`];
  const contains = (column: string, value: string) =>
    `${column} LIKE ${params.add(likeContainsPattern(value))} ESCAPE '\\'`;
  if (condition.field === 'event_name') {
    clauses.push(`e.event_type = ${EVENT_TYPE.customEvent}`);
    clauses.push(
      condition.operator === 'equals' ? `e.event_name = ${params.add(condition.value)}` : contains('e.event_name', condition.value),
    );
  } else if (condition.field === 'url_path') {
    clauses.push(`e.event_type = ${EVENT_TYPE.pageView}`);
    clauses.push(
      condition.operator === 'equals' ? `e.url_path = ${params.add(condition.value)}` : contains('e.url_path', condition.value),
    );
  } else {
    clauses.push(`e.event_type IN (${EVENT_TYPE.pageView}, ${EVENT_TYPE.customEvent})`);
  }
  if (windowStart != null && windowEnd != null) {
    clauses.push(`e.created_at >= ${params.add(windowStart)} AND e.created_at <= ${params.add(windowEnd)}`);
  }
  const filters = compilePropertyFilters(condition.filters, params);
  if (filters.sql) clauses.push(filters.sql);
  return { sql: clauses.join(' AND '), needsSession: filters.needsSession };
}

export async function loadFlagPerson(site: D1Database, websiteId: string, distinctId: string): Promise<FlagPerson | null> {
  const row = await site
    .prepare(
      `SELECT person_id AS personId, properties_json AS propertiesJson, first_seen_at AS firstSeenAt
       FROM person
       WHERE website_id = ?1 AND distinct_id = ?2
       LIMIT 1`,
    )
    .bind(websiteId, distinctId)
    .first<{ personId: string; propertiesJson: string | null; firstSeenAt: number | null }>();
  if (!row) return null;
  return {
    personId: row.personId,
    properties: parsePersonProperties(row.propertiesJson),
    firstSeenAt: row.firstSeenAt ?? null,
  };
}

/** Group type → group key from stored memberships (the most recent key wins per type). */
export async function loadPersonGroupKeys(site: D1Database, websiteId: string, personId: string) {
  const rows = await site
    .prepare(
      `SELECT group_type AS groupType, group_key AS groupKey
       FROM person_group_membership
       WHERE website_id = ?1 AND person_id = ?2
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .bind(websiteId, personId)
    .all<{ groupType: string; groupKey: string }>();
  const groups: Record<string, string> = {};
  for (const row of rows.results ?? []) {
    if (!(row.groupType in groups)) groups[row.groupType] = row.groupKey;
  }
  return groups;
}

/**
 * Latest properties sent with `group(type, key, props)`, stored as `$group/<type>/<prop>`
 * session data. Reads the 200 most recent sessions that reported this group.
 */
export async function loadGroupProperties(
  site: D1Database,
  websiteId: string,
  groupType: string,
  groupKey: string,
): Promise<Record<string, unknown>> {
  const prefix = `$group/${groupType}/`;
  const rows = await site
    .prepare(
      `WITH group_sessions AS (
         SELECT session_id
         FROM session_data
         WHERE website_id = ?1 AND data_key = ?2 AND string_value = ?3
         GROUP BY session_id
         ORDER BY MAX(created_at) DESC
         LIMIT 200
       )
       SELECT substr(sd.data_key, ?4) AS key,
              sd.string_value AS stringValue,
              sd.number_value AS numberValue,
              sd.date_value AS dateValue,
              MAX(sd.created_at) AS updatedAt
       FROM group_sessions gs
       INNER JOIN session_data sd ON sd.website_id = ?1 AND sd.session_id = gs.session_id
       WHERE substr(sd.data_key, 1, ?5) = ?6
       GROUP BY sd.data_key
       LIMIT 200`,
    )
    .bind(websiteId, `$group/${groupType}`, groupKey, prefix.length + 1, prefix.length, prefix)
    .all<{ key: string; stringValue: string | null; numberValue: number | null; dateValue: number | null }>();
  const properties: Record<string, unknown> = {};
  for (const row of rows.results ?? []) {
    if (!row.key) continue;
    properties[row.key] = row.numberValue ?? row.stringValue ?? row.dateValue ?? null;
  }
  return properties;
}

/** The website's cohorts among `cohortIds` (filtered in code: D1 caps bound parameters at 100). */
export async function loadFlagCohorts(db: D1Database, websiteId: string, cohortIds: string[]) {
  const cohorts = new Map<string, FlagCohort>();
  const wanted = new Set(cohortIds.filter(Boolean));
  if (!wanted.size) return cohorts;
  const rows = await db
    .prepare(
      `SELECT cohort_id AS id, name, type, value, definition, updated_at AS updatedAt
       FROM cohort
       WHERE website_id = ?1`,
    )
    .bind(websiteId)
    .all<{ id: string; name: string; type: string; value: string; definition: string | null; updatedAt: number | null }>();
  for (const row of rows.results ?? []) {
    if (!wanted.has(row.id)) continue;
    let stored: CohortDefinition | null = null;
    if (row.definition) {
      try {
        stored = JSON.parse(row.definition) as CohortDefinition;
      } catch {
        stored = null;
      }
    }
    cohorts.set(row.id, {
      id: row.id,
      name: row.name,
      definition: parseCohortDefinition(stored, row.type, row.value),
      updatedAt: row.updatedAt ?? null,
    });
  }
  return cohorts;
}

/**
 * EXISTS clauses (one per condition) over the outer `session s`; condition filters on session
 * columns read that same row.
 */
function cohortExistsSql(definition: CohortDefinition, websiteId: string, params: SqlParams) {
  return definition.conditions
    .map((condition) => {
      const where = cohortConditionWhere(condition, params, websiteId, definition.windowStart, definition.windowEnd);
      return `EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id AND ${where.sql})`;
    })
    .join(' AND ');
}

/**
 * Whether one session belongs to the cohort. Cohorts are session based (all conditions in the
 * same session, as in cohort reports).
 */
export async function isSessionInCohort(
  site: D1Database,
  websiteId: string,
  definition: CohortDefinition,
  sessionId: string,
): Promise<boolean> {
  if (!definition.conditions.length) return false;
  const params = new SqlParams('positional');
  const head = `s.session_id = ${params.add(sessionId)} AND s.website_id = ${params.add(websiteId)}`;
  const exists = cohortExistsSql(definition, websiteId, params);
  const row = await site
    .prepare(`SELECT 1 AS found FROM session s WHERE ${head} AND ${exists} LIMIT 1`)
    .bind(...params.values)
    .first<{ found: number }>();
  return Boolean(row);
}

/** Whether any session of an identified person belongs to the cohort. */
export async function isPersonInCohort(
  site: D1Database,
  websiteId: string,
  definition: CohortDefinition,
  distinctId: string,
  person: FlagPerson,
): Promise<boolean> {
  if (!definition.conditions.length) return false;
  // No index covers session.distinct_id: bound the range scan to sessions since the person appeared.
  const since = person.firstSeenAt != null ? person.firstSeenAt - PERSON_SESSION_LOOKBACK_MS : 0;
  const params = new SqlParams('positional');
  const head = `s.website_id = ${params.add(websiteId)} AND s.created_at >= ${params.add(since)} AND s.distinct_id = ${params.add(distinctId)}`;
  const exists = cohortExistsSql(definition, websiteId, params);
  const row = await site
    .prepare(
      `SELECT 1 AS found FROM session s
       WHERE ${head} AND ${exists}
       LIMIT 1`,
    )
    .bind(...params.values)
    .first<{ found: number }>();
  return Boolean(row);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Cohort membership for one caller.
 *
 * - Identified people (a person row exists for the distinct id): any of their sessions,
 *   cached in KV for COHORT_MEMBERSHIP_CACHE_TTL_SECONDS per cohort version.
 * - Everyone else: only the current session (a primary-key lookup, not cached). Requiring a
 *   person row keeps unknown distinct ids sent to the public endpoint from triggering scans.
 */
export async function resolveCohortMembership(
  stores: FlagTargetingStores,
  websiteId: string,
  cohort: FlagCohort,
  identity: { distinctId?: string; sessionId?: string; person: FlagPerson | null },
): Promise<boolean> {
  const { distinctId, sessionId, person } = identity;
  if (person && distinctId) {
    const cacheKey = `ff-cohort:v1:${websiteId}:${cohort.id}:${cohort.updatedAt ?? 0}:${await sha256Hex(distinctId)}`;
    if (stores.cache) {
      try {
        const cached = await stores.cache.get(cacheKey);
        if (cached === '1' || cached === '0') return cached === '1';
      } catch {
        // A cache outage must not break evaluation.
      }
    }
    const member = await isPersonInCohort(stores.site, websiteId, cohort.definition, distinctId, person);
    if (stores.cache) {
      try {
        await stores.cache.put(cacheKey, member ? '1' : '0', { expirationTtl: COHORT_MEMBERSHIP_CACHE_TTL_SECONDS });
      } catch {
        // Best effort.
      }
    }
    return member;
  }
  if (sessionId) return isSessionInCohort(stores.site, websiteId, cohort.definition, sessionId);
  return false;
}

function groupKeyText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Completes an evaluation context with what the flags need and nothing more:
 * stored person properties (caller-supplied ones win), stored group keys for group types the
 * caller did not send, stored group properties (caller-supplied ones win) and cohort
 * membership. `context.cohorts` from the caller is always replaced.
 */
export async function resolveFlagTargetingContext(
  stores: FlagTargetingStores,
  websiteId: string,
  flags: FeatureFlagConfigForEvaluation[],
  context: FeatureFlagEvaluationContext,
): Promise<FeatureFlagEvaluationContext> {
  const needs = featureFlagTargetingNeeds(flags);
  const identity = context.distinctId || context.userId || context.anonymousId;
  const needsPerson = needs.personProperties || needs.groups || needs.cohortIds.length > 0;
  const person = needsPerson && identity ? await loadFlagPerson(stores.site, websiteId, identity) : null;

  const personProperties = { ...(person?.properties ?? {}), ...plainRecord(context.personProperties) };

  const groups: Record<string, unknown> = { ...plainRecord(context.groups) };
  if (needs.groups && person) {
    const stored = await loadPersonGroupKeys(stores.site, websiteId, person.personId);
    for (const [type, key] of Object.entries(stored)) {
      if (groupKeyText(groups[type]) === null) groups[type] = key;
    }
  }

  const callerGroupProperties = plainRecord(context.groupProperties) as Record<string, unknown>;
  const groupProperties: Record<string, Record<string, unknown>> = {};
  for (const [type, value] of Object.entries(callerGroupProperties)) groupProperties[type] = plainRecord(value);
  await Promise.all(
    needs.groupTypes.map(async (type) => {
      const key = groupKeyText(groups[type]);
      if (!key) return;
      const stored = await loadGroupProperties(stores.site, websiteId, type, key);
      groupProperties[type] = { ...stored, ...(groupProperties[type] ?? {}) };
    }),
  );

  const cohorts: Record<string, boolean> = {};
  if (needs.cohortIds.length) {
    const definitions = await loadFlagCohorts(stores.db, websiteId, needs.cohortIds);
    await Promise.all(
      [...definitions.values()].map(async (cohort) => {
        cohorts[cohort.id] = await resolveCohortMembership(stores, websiteId, cohort, {
          distinctId: identity,
          sessionId: context.sessionId,
          person,
        });
      }),
    );
  }

  return { ...context, personProperties, groups, groupProperties, cohorts };
}
