import { EVENT_TYPE } from '@flareboard/shared';
import type { CohortDefinition } from '@flareboard/shared';
import { createDb, schema } from '@flareboard/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env';
import { clampReportRange } from './report-range';

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

function conditionSql(
  cond: CohortDefinition['conditions'][number],
  windowStart?: number,
  windowEnd?: number,
) {
  const binds: (string | number)[] = ['WEBSITE_ID'];
  let windowClause = '';
  if (windowStart != null && windowEnd != null) {
    windowClause = ' AND created_at >= ? AND created_at <= ?';
    binds.push(windowStart, windowEnd);
  }

  if (cond.field === 'event_name') {
    const nameClause =
      cond.operator === 'equals'
        ? `event_type = ${EVENT_TYPE.customEvent} AND event_name = ?`
        : `event_type = ${EVENT_TYPE.customEvent} AND event_name LIKE '%' || ? || '%'`;
    binds.push(cond.value);
    return {
      sql: `SELECT session_id FROM website_event WHERE website_id = ? AND ${nameClause}${windowClause} GROUP BY session_id`,
      binds,
    };
  }

  const pathClause =
    cond.operator === 'equals'
      ? `event_type = ${EVENT_TYPE.pageView} AND url_path = ?`
      : `event_type = ${EVENT_TYPE.pageView} AND url_path LIKE '%' || ? || '%'`;
  binds.push(cond.value);
  return {
    sql: `SELECT session_id FROM website_event WHERE website_id = ? AND ${pathClause}${windowClause} GROUP BY session_id`,
    binds,
  };
}

export type CohortMemberJoin = {
  intersectSql: string;
  binds: (string | number)[];
  totalMembers: number;
};

export async function cohortMemberSubquery(
  env: Env,
  cohort: CohortRecord,
): Promise<CohortMemberJoin | null> {
  const { conditions, windowStart, windowEnd } = cohort.definition;
  if (!conditions.length) return null;

  const parts = conditions.map((c) => conditionSql(c, windowStart, windowEnd));
  const intersectSql = parts.map((p) => `(${p.sql})`).join(' INTERSECT ');
  const flatBinds: (string | number)[] = [];
  for (const p of parts) {
    for (const b of p.binds) {
      flatBinds.push(b === 'WEBSITE_ID' ? cohort.websiteId : b);
    }
  }

  const countRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM (${intersectSql})`)
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

  const rows = await env.DB.prepare(
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
