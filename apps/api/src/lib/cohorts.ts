import { EVENT_TYPE } from '@flareboard/shared';
import type { CohortDefinition } from '@flareboard/shared';
import { createDb, schema } from '@flareboard/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env';
import { compilePropertyFilters, InsightQueryError, likeContainsPattern, SqlParams } from './property-filters';
import { clampReportRange } from './report-range';
import { siteDb } from './site-db';

/** Placeholder for the cohort's website id in condition binds. */
const WEBSITE_ID_SLOT = '\u0000website_id';

export type CohortRecord = {
  cohortId: string;
  websiteId: string;
  name: string;
  definition: CohortDefinition;
};

export function legacyToDefinition(type: string, value: string): CohortDefinition {
  if (type === 'event') {
    return { conditions: [{ field: 'event_name', operator: 'equals', value }] };
  }
  return { conditions: [{ field: 'url_path', operator: 'equals', value }] };
}

export function parseCohortDefinition(
  definition: CohortDefinition | null | undefined,
  type: string,
  value: string,
): CohortDefinition {
  if (definition?.conditions?.length) return definition;
  return legacyToDefinition(type, value);
}

/**
 * Sessions matching one cohort condition. Binds follow text order (WEBSITE_ID_SLOT is replaced
 * by the cohort's website). Property filters use the shared compiler (event, person, dimension).
 */
function conditionSql(
  cond: CohortDefinition['conditions'][number],
  windowStart?: number,
  windowEnd?: number,
) {
  const params = new SqlParams('positional');
  const clauses: string[] = [`e.website_id = ${params.add(WEBSITE_ID_SLOT)}`];
  const contains = (column: string, value: string) =>
    `${column} LIKE ${params.add(likeContainsPattern(value))} ESCAPE '\\'`;

  if (cond.field === 'event_name') {
    clauses.push(`e.event_type = ${EVENT_TYPE.customEvent}`);
    clauses.push(cond.operator === 'equals' ? `e.event_name = ${params.add(cond.value)}` : contains('e.event_name', cond.value));
  } else if (cond.field === 'url_path') {
    clauses.push(`e.event_type = ${EVENT_TYPE.pageView}`);
    clauses.push(cond.operator === 'equals' ? `e.url_path = ${params.add(cond.value)}` : contains('e.url_path', cond.value));
  } else {
    clauses.push(`e.event_type IN (${EVENT_TYPE.pageView}, ${EVENT_TYPE.customEvent})`);
  }
  if (windowStart != null && windowEnd != null) {
    clauses.push(`e.created_at >= ${params.add(windowStart)} AND e.created_at <= ${params.add(windowEnd)}`);
  }
  const filters = compilePropertyFilters(cond.filters, params);
  if (filters.sql) clauses.push(filters.sql);
  const join = filters.needsSession ? ' LEFT JOIN session s ON s.session_id = e.session_id' : '';
  return {
    sql: `SELECT e.session_id AS session_id FROM website_event e${join} WHERE ${clauses.join(' AND ')} GROUP BY e.session_id`,
    binds: params.values,
  };
}

export type CohortMemberJoin = {
  intersectSql: string;
  binds: (string | number)[];
  totalMembers: number;
};

/**
 * Cohort members join is embedded in report queries that add their own parameters, so the
 * cohort itself may use at most this many (D1 allows 100 per statement).
 */
export const MAX_COHORT_BOUND_PARAMETERS = 60;

export function cohortMemberSql(definition: CohortDefinition, websiteId: string) {
  const { conditions, windowStart, windowEnd } = definition;
  const parts = conditions.map((c) => conditionSql(c, windowStart, windowEnd));
  // SQLite rejects parenthesized compound members, so wrap each condition as a subquery.
  const intersectSql = parts.map((p) => `SELECT session_id FROM (${p.sql})`).join(' INTERSECT ');
  const binds: (string | number)[] = [];
  for (const p of parts) {
    for (const b of p.binds) binds.push(b === WEBSITE_ID_SLOT ? websiteId : b);
  }
  if (binds.length > MAX_COHORT_BOUND_PARAMETERS) {
    throw new InsightQueryError('This cohort has too many conditions or filter values. Remove some and try again.');
  }
  return { intersectSql, binds };
}

export async function cohortMemberSubquery(
  env: Env,
  cohort: CohortRecord,
): Promise<CohortMemberJoin | null> {
  const { conditions, windowStart, windowEnd } = cohort.definition;
  if (!conditions.length) return null;

  const { intersectSql, binds: flatBinds } = cohortMemberSql(cohort.definition, cohort.websiteId);

  const countRow = await siteDb(env, cohort.websiteId)
    .prepare(`SELECT COUNT(*) as c FROM (${intersectSql})`)
    .bind(...flatBinds)
    .first<{ c: number }>();

  return { intersectSql, binds: flatBinds, totalMembers: countRow?.c ?? 0 };
}

export async function resolveCohortMemberJoin(
  env: Env,
  websiteId: string,
  cohortId: string,
): Promise<CohortMemberJoin | null> {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.cohort)
    .where(eq(schema.cohort.cohortId, cohortId))
    .limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  const definition = parseCohortDefinition(
    row.definition as CohortDefinition | null,
    row.type,
    row.value,
  );
  return cohortMemberSubquery(env, {
    cohortId: row.cohortId,
    websiteId: row.websiteId,
    name: row.name,
    definition,
  });
}

export async function getCohortSizeOverTime(
  env: Env,
  cohort: CohortRecord,
  startAt: number,
  endAt: number,
) {
  const range = clampReportRange(startAt, endAt);
  const unit = range.endAt - range.startAt > 90 * 24 * 60 * 60 * 1000 ? 'week' : 'day';

  const memberQuery = await cohortMemberSubquery(env, cohort);
  if (!memberQuery || memberQuery.totalMembers === 0) {
    return {
      cohortId: cohort.cohortId,
      name: cohort.name,
      definition: cohort.definition,
      unit,
      totalUsers: 0,
      series: [],
      startAt: range.startAt,
      endAt: range.endAt,
    };
  }

  const dateExpr =
    unit === 'week'
      ? `date(e.created_at / 1000, 'unixepoch', 'weekday 0')`
      : `date(e.created_at / 1000, 'unixepoch')`;

  const rows = await siteDb(env, cohort.websiteId).prepare(
    `SELECT ${dateExpr} as bucket, COUNT(DISTINCT e.session_id) as users
     FROM website_event e
     INNER JOIN (${memberQuery.intersectSql}) m ON m.session_id = e.session_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2 AND e.created_at <= ?3
     GROUP BY bucket
     ORDER BY bucket`,
  )
    .bind(...memberQuery.binds, cohort.websiteId, range.startAt, range.endAt)
    .all<{ bucket: string; users: number }>();

  return {
    cohortId: cohort.cohortId,
    name: cohort.name,
    definition: cohort.definition,
    unit,
    totalUsers: memberQuery.totalMembers,
    series: rows.results ?? [],
    startAt: range.startAt,
    endAt: range.endAt,
  };
}

export async function compareCohorts(
  env: Env,
  cohortA: CohortRecord,
  cohortB: CohortRecord,
  startAt: number,
  endAt: number,
) {
  const [reportA, reportB] = await Promise.all([
    getCohortSizeOverTime(env, cohortA, startAt, endAt),
    getCohortSizeOverTime(env, cohortB, startAt, endAt),
  ]);
  return { cohortA: reportA, cohortB: reportB };
}
