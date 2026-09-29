/**
 * Per-unit activity insights: retention, lifecycle and stickiness. Units are distinct ids
 * (else sessions) or sessions; periods follow the site's calendar.
 */
import {
  DEFAULT_RETENTION_PERIODS,
  type InsightEvent,
  type InsightInterval,
  type InsightQuery,
  type LifecycleResult,
  type PropertyFilter,
  type RetentionResult,
  type StickinessResult,
} from '@flareboard/shared';
import {
  allRows,
  bucketLabels,
  eventMatcherSql,
  floorLocal,
  fromLocalMs,
  globalFiltersSql,
  periodIndexSql,
  resolveInterval,
  sessionJoinSql,
  stepLocal,
  toLocalMs,
  unitSql,
  type CountBy,
  type InsightContext,
} from './insight-sql';
import { SqlParams } from './property-filters';
import { siteLocalMsSql } from './site-time';

const PAGEVIEW: InsightEvent = { kind: 'pageview' };

// ---------------------------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------------------------

export type RetentionPlan = {
  startEvent: InsightEvent;
  returnEvent: InsightEvent;
  period: 'day' | 'week' | 'month';
  /** Offsets 0..periods-1 are reported (0 = the cohort itself). */
  periods: number;
  countBy: CountBy;
  filters?: PropertyFilter[];
  /** Start events from this instant form cohorts; period 0 starts at its period boundary. */
  cohortFrom: number;
  endAt: number;
};

/** Cohort window of an insight: the last `periods` periods up to endAt. */
export function retentionPlanFromQuery(ctx: InsightContext, query: InsightQuery, minStartAt?: number): RetentionPlan {
  const period = query.retention?.period ?? 'week';
  const periods = query.retention?.periods ?? DEFAULT_RETENTION_PERIODS;
  const startEvent = query.retention?.startEvent ?? PAGEVIEW;
  const lastPeriod = floorLocal(toLocalMs(ctx.endAt, ctx.timezone), period);
  let cohortFrom = fromLocalMs(stepLocal(lastPeriod, period, -(periods - 1)), ctx.timezone);
  if (minStartAt && minStartAt > cohortFrom) cohortFrom = Math.min(minStartAt, ctx.endAt);
  return {
    startEvent,
    returnEvent: query.retention?.returnEvent ?? startEvent,
    period,
    periods,
    countBy: query.countBy ?? 'person',
    filters: query.filters,
    cohortFrom,
    endAt: ctx.endAt,
  };
}

export async function runRetention(ctx: InsightContext, p: RetentionPlan): Promise<RetentionResult> {
  const origin = floorLocal(toLocalMs(p.cohortFrom, ctx.timezone), p.period);
  const originUtc = fromLocalMs(origin, ctx.timezone);
  const labels = bucketLabels(p.cohortFrom, p.endAt, p.period, ctx.timezone);

  const params = new SqlParams();
  const unit = unitSql(p.countBy);
  const start = eventMatcherSql(p.startEvent, params);
  const ret = eventMatcherSql(p.returnEvent, params);
  const global = globalFiltersSql(p.filters, params);
  const needsSession = unit.needsSession || start.needsSession || ret.needsSession || global.needsSession;
  const join = sessionJoinSql(needsSession);
  const idx = periodIndexSql('e.created_at', p.period, origin, originUtc, p.endAt, ctx.timezone);
  const website = params.add(ctx.websiteId);
  const end = params.add(p.endAt);

  const sql = `WITH starts AS (
      SELECT ${unit.sql} AS u, MIN(${idx}) AS cp
      FROM website_event e${join}
      WHERE e.website_id = ${website} AND e.created_at >= ${params.add(p.cohortFrom)} AND e.created_at <= ${end}
        AND ${start.sql}${global.sql}
      GROUP BY u
    ),
    returns AS (
      SELECT DISTINCT ${unit.sql} AS u, ${idx} AS p
      FROM website_event e${join}
      WHERE e.website_id = ${website} AND e.created_at >= ${params.add(originUtc)} AND e.created_at <= ${end}
        AND ${ret.sql}${global.sql}
    )
    SELECT cp AS cohort, 0 AS offset, COUNT(*) AS n FROM starts GROUP BY cp
    UNION ALL
    SELECT st.cp AS cohort, r.p - st.cp AS offset, COUNT(*) AS n
    FROM starts st INNER JOIN returns r ON r.u = st.u AND r.p > st.cp AND r.p - st.cp < ${p.periods}
    GROUP BY st.cp, r.p - st.cp`;

  const rows = await allRows<{ cohort: number; offset: number; n: number }>(ctx.db, sql, params);
  const counts = new Map(rows.map((row) => [`${row.cohort}:${row.offset}`, row.n]));
  const cohorts = labels.map((cohort, i) => {
    const available = Math.min(p.periods, labels.length - i);
    const values = Array.from({ length: available }, (_, offset) => counts.get(`${i}:${offset}`) ?? 0);
    return { cohort, size: values[0] ?? 0, values };
  });
  return {
    kind: 'retention',
    period: p.period,
    periods: p.periods,
    countBy: p.countBy,
    cohorts,
    startAt: p.cohortFrom,
    endAt: p.endAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

/**
 * Per interval: new (first seen in this interval), returning (also active in the previous one),
 * resurrecting (inactive in the previous one, seen before) and dormant (active in the previous
 * interval but not this one, reported as a negative count). First seen is the earliest of the
 * person's first_seen_at, the session start and the unit's first event.
 */
export async function runLifecycle(ctx: InsightContext, query: InsightQuery): Promise<LifecycleResult> {
  const interval: InsightInterval = resolveInterval(query.interval ?? 'day', ctx.startAt, ctx.endAt, ctx.timezone);
  const labels = bucketLabels(ctx.startAt, ctx.endAt, interval, ctx.timezone);
  const origin = floorLocal(toLocalMs(ctx.startAt, ctx.timezone), interval);
  const prevOrigin = stepLocal(origin, interval, -1);
  const prevStartUtc = fromLocalMs(prevOrigin, ctx.timezone);
  const event = query.series?.[0] ?? PAGEVIEW;
  const countBy = query.countBy ?? 'person';

  const params = new SqlParams();
  const unit = unitSql(countBy);
  const matcher = eventMatcherSql(event, params);
  const global = globalFiltersSql(query.filters, params);
  // Indexes are relative to the previous interval, then shifted so the first label is 0.
  const idx = `(${periodIndexSql('e.created_at', interval, prevOrigin, prevStartUtc, ctx.endAt, ctx.timezone)} - 1)`;
  const firstSeen =
    countBy === 'person'
      ? `MIN(e.created_at, COALESCE(s.created_at, e.created_at), COALESCE((SELECT pe.first_seen_at FROM person pe
          WHERE pe.website_id = s.website_id AND pe.distinct_id = s.distinct_id), e.created_at))`
      : 'MIN(e.created_at, COALESCE(s.created_at, e.created_at))';
  const firstSeenIdx =
    interval === 'month'
      ? `(${periodIndexSql('fs', interval, prevOrigin, prevStartUtc, ctx.endAt, ctx.timezone)} - 1)`
      : `(CASE WHEN fs < ${prevStartUtc} THEN -2 ELSE ${periodIndexSql('fs', interval, prevOrigin, prevStartUtc, ctx.endAt, ctx.timezone)} - 1 END)`;
  const lastIdx = labels.length - 1;

  const sql = `WITH raw AS (
      SELECT ${unit.sql} AS u, ${idx} AS p, ${firstSeen} AS fs
      FROM website_event e LEFT JOIN session s ON s.session_id = e.session_id
      WHERE e.website_id = ${params.add(ctx.websiteId)}
        AND e.created_at >= ${params.add(prevStartUtc)} AND e.created_at <= ${params.add(ctx.endAt)}
        AND ${matcher.sql}${global.sql}
    ),
    act AS (SELECT u, p FROM raw GROUP BY u, p),
    firsts AS (SELECT u, ${firstSeenIdx} AS fp FROM (SELECT u, MIN(fs) AS fs FROM raw GROUP BY u)),
    statuses AS (
      SELECT a.p AS p,
        CASE WHEN f.fp >= a.p THEN 'new' WHEN prev.u IS NOT NULL THEN 'returning' ELSE 'resurrecting' END AS status
      FROM act a
      INNER JOIN firsts f ON f.u = a.u
      LEFT JOIN act prev ON prev.u = a.u AND prev.p = a.p - 1
      WHERE a.p >= 0
      UNION ALL
      SELECT a.p + 1 AS p, 'dormant' AS status
      FROM act a
      LEFT JOIN act nxt ON nxt.u = a.u AND nxt.p = a.p + 1
      WHERE nxt.u IS NULL AND a.p + 1 >= 0 AND a.p + 1 <= ${lastIdx}
    )
    SELECT p, status, COUNT(*) AS n FROM statuses GROUP BY p, status`;

  const rows = await allRows<{ p: number; status: 'new' | 'returning' | 'resurrecting' | 'dormant'; n: number }>(
    ctx.db,
    sql,
    params,
  );
  const result: LifecycleResult = {
    kind: 'lifecycle',
    interval,
    labels,
    new: labels.map(() => 0),
    returning: labels.map(() => 0),
    resurrecting: labels.map(() => 0),
    dormant: labels.map(() => 0),
    startAt: ctx.startAt,
    endAt: ctx.endAt,
  };
  for (const row of rows) {
    if (row.p < 0 || row.p > lastIdx) continue;
    if (row.status === 'dormant') result.dormant[row.p] = -row.n;
    else result[row.status][row.p] = row.n;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Stickiness
// ---------------------------------------------------------------------------------------------

/** How many distinct site-local days each unit performed the event on. */
export async function runStickiness(
  ctx: InsightContext,
  event: InsightEvent,
  countBy: CountBy,
  filters: PropertyFilter[] | undefined,
): Promise<StickinessResult> {
  const params = new SqlParams();
  const unit = unitSql(countBy);
  const matcher = eventMatcherSql(event, params);
  const global = globalFiltersSql(filters, params);
  const needsSession = unit.needsSession || matcher.needsSession || global.needsSession;
  const day = `strftime('%Y-%m-%d', (${siteLocalMsSql('e.created_at', ctx.startAt, ctx.endAt, ctx.timezone)}) / 1000, 'unixepoch')`;

  const rows = await allRows<{ activeDays: number; actors: number; events: number }>(
    ctx.db,
    `WITH daily AS (
       SELECT ${unit.sql} AS a, ${day} AS d, COUNT(*) AS events
       FROM website_event e${sessionJoinSql(needsSession)}
       WHERE e.website_id = ${params.add(ctx.websiteId)}
         AND e.created_at >= ${params.add(ctx.startAt)} AND e.created_at <= ${params.add(ctx.endAt)}
         AND ${matcher.sql}${global.sql}
       GROUP BY a, d
     ),
     actors AS (SELECT a, COUNT(*) AS days, SUM(events) AS events FROM daily GROUP BY a)
     SELECT days AS activeDays, COUNT(*) AS actors, SUM(events) AS events
     FROM actors GROUP BY days ORDER BY days`,
    params,
  );

  const totalActors = rows.reduce((sum, row) => sum + row.actors, 0);
  const actorDays = rows.reduce((sum, row) => sum + row.actors * row.activeDays, 0);
  return {
    kind: 'stickiness',
    event: event.kind === 'event' ? (event.event ?? null) : event.kind === 'pageview' ? '$pageview' : null,
    actor: countBy,
    totalActors,
    actorDays,
    averageActiveDays: totalActors > 0 ? Math.round((actorDays / totalActors) * 100) / 100 : 0,
    distribution: rows.map((row) => ({
      activeDays: row.activeDays,
      actors: row.actors,
      events: row.events,
      percentage: totalActors > 0 ? Math.round((row.actors / totalActors) * 1000) / 10 : 0,
    })),
    startAt: ctx.startAt,
    endAt: ctx.endAt,
  };
}
