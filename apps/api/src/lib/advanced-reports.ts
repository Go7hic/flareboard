import { EVENT_TYPE, type AttributionConversionResponse } from '@flareboard/shared';
import type { Env } from '../env';
import { paidAdsCaseSql } from './channel';
import {
  clampJourneyLimit,
  clampReportRange,
  MAX_JOURNEY_PATH_STEPS,
  MAX_JOURNEY_VISIT_SAMPLE,
} from './report-range';
import { buildSegmentSql, type SegmentParams } from './segment-filters';

function segmentEventFilter(
  websiteId: string,
  startAt: number,
  endAt: number,
  segment?: SegmentParams | null,
) {
  const seg = buildSegmentSql(segment ?? null);
  const joins = seg.joinSession ? ' INNER JOIN session s ON e.session_id = s.session_id' : '';
  const clauses = [
    'e.website_id = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [websiteId, startAt, endAt, ...seg.binds];
  return { joins, where: clauses.join(' AND '), binds, seg };
}

export async function getFunnelReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  steps: string[],
  segment?: SegmentParams | null,
) {
  if (!steps.length) return { steps: [], conversion: 0 };

  const { joins, where, binds } = segmentEventFilter(websiteId, startAt, endAt, segment);
  const results: Array<{ step: string; count: number; rate: number }> = [];
  let prevCount = 0;

  for (let i = 0; i < steps.length; i++) {
    const required = steps.slice(0, i + 1);
    const caseCols = required
      .map((_, idx) => `MIN(CASE WHEN e.event_name = ? THEN e.created_at END) as step_${idx}`)
      .join(', ');
    const orderChecks = required
      .slice(1)
      .map((_, idx) => `step_${idx} < step_${idx + 1}`)
      .join(' AND ');
    const presenceChecks = required.map((_, idx) => `step_${idx} IS NOT NULL`).join(' AND ');
    const havingClause = orderChecks ? `${presenceChecks} AND ${orderChecks}` : presenceChecks;

    const sql = `SELECT COUNT(*) as count FROM (
      SELECT e.session_id, ${caseCols}
      FROM website_event e${joins}
      WHERE ${where} AND e.event_type = ${EVENT_TYPE.customEvent}
      GROUP BY e.session_id
      HAVING ${havingClause}
    )`;

    const stepBinds = [...binds, ...required];
    const row = await env.DB.prepare(sql)
      .bind(...stepBinds)
      .first<{ count: number }>();
    const count = row?.count ?? 0;
    const rate =
      count === 0 ? 0 : i === 0 ? 100 : prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;
    results.push({ step: steps[i], count, rate });
    prevCount = count;
  }

  const first = results[0]?.count ?? 0;
  const last = results[results.length - 1]?.count ?? 0;
  return {
    steps: results,
    conversion: first > 0 ? Math.round((last / first) * 100) : 0,
  };
}

export async function getRetentionReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment?: SegmentParams | null,
) {
  const range = clampReportRange(startAt, endAt);
  const seg = buildSegmentSql(segment ?? null);
  const sessionJoin = seg.joinSession || seg.sessionClauses.length ? ' INNER JOIN session s ON e.session_id = s.session_id' : '';
  const eventFilter = seg.eventClauses.length ? ` AND ${seg.eventClauses.join(' AND ')}` : '';
  const sessionFilter = seg.sessionClauses.length ? ` AND ${seg.sessionClauses.join(' AND ')}` : '';
  const binds: (string | number)[] = [websiteId, range.startAt, range.endAt, ...seg.binds];

  const rows = await env.DB.prepare(
    `WITH first_touch AS (
      SELECT e.session_id,
        MIN(e.created_at) as first_at
      FROM website_event e${sessionJoin}
      WHERE e.website_id = ?1
        AND e.created_at >= ?2 AND e.created_at <= ?3
        AND e.event_type = ${EVENT_TYPE.pageView}
        ${eventFilter}${sessionFilter}
      GROUP BY e.session_id
    ),
    cohort AS (
      SELECT session_id,
        date(first_at / 1000, 'unixepoch', 'weekday 0') as cohort_week
      FROM first_touch
    ),
    activity AS (
      SELECT c.session_id, c.cohort_week,
        CAST((julianday(date(e.created_at / 1000, 'unixepoch')) -
              julianday(c.cohort_week)) / 7 AS INTEGER) as week_offset
      FROM cohort c
      INNER JOIN website_event e ON e.session_id = c.session_id
      WHERE e.website_id = ?1
        AND e.created_at <= ?3
        AND e.event_type = ${EVENT_TYPE.pageView}
      GROUP BY c.session_id, week_offset
    )
    SELECT cohort_week as cohortWeek, week_offset as weekOffset,
           COUNT(DISTINCT session_id) as users
    FROM activity
    WHERE week_offset >= 0 AND week_offset <= 8
    GROUP BY cohort_week, week_offset
    ORDER BY cohort_week, week_offset`,
  )
    .bind(...binds)
    .all<{ cohortWeek: string; weekOffset: number; users: number }>();

  return { cohorts: rows.results ?? [], startAt: range.startAt, endAt: range.endAt };
}

export async function getStickinessReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  eventName?: string | null,
  actor: 'person' | 'session' = 'person',
  segment?: SegmentParams | null,
) {
  const range = clampReportRange(startAt, endAt);
  const seg = buildSegmentSql(segment ?? null);
  const joins = ` INNER JOIN session s ON s.session_id = e.session_id AND s.website_id = e.website_id`;
  const eventFilter = seg.eventClauses.length ? ` AND ${seg.eventClauses.join(' AND ')}` : '';
  const sessionFilter = seg.sessionClauses.length ? ` AND ${seg.sessionClauses.join(' AND ')}` : '';
  const eventNameFilter = eventName ? ' AND e.event_name = ?' : '';
  const actorExpr =
    actor === 'session'
      ? 'e.session_id'
      : "COALESCE(NULLIF(s.distinct_id, ''), e.session_id)";
  const binds: (string | number)[] = [websiteId, range.startAt, range.endAt];
  if (eventName) binds.push(eventName);
  binds.push(...seg.binds);

  const rows = await env.DB.prepare(
    `WITH daily_activity AS (
       SELECT ${actorExpr} as actorId,
              date(e.created_at / 1000, 'unixepoch') as activeDay,
              COUNT(*) as events
       FROM website_event e${joins}
       WHERE e.website_id = ?
         AND e.created_at >= ?
         AND e.created_at <= ?
         ${eventNameFilter}
         ${eventFilter}${sessionFilter}
       GROUP BY actorId, activeDay
     ),
     actor_activity AS (
       SELECT actorId,
              COUNT(*) as activeDays,
              SUM(events) as events
       FROM daily_activity
       GROUP BY actorId
     )
     SELECT activeDays,
            COUNT(*) as actors,
            SUM(events) as events
     FROM actor_activity
     GROUP BY activeDays
     ORDER BY activeDays ASC`,
  )
    .bind(...binds)
    .all<{ activeDays: number; actors: number; events: number }>();

  const totalRow = await env.DB.prepare(
    `WITH daily_activity AS (
       SELECT ${actorExpr} as actorId,
              date(e.created_at / 1000, 'unixepoch') as activeDay
       FROM website_event e${joins}
       WHERE e.website_id = ?
         AND e.created_at >= ?
         AND e.created_at <= ?
         ${eventNameFilter}
         ${eventFilter}${sessionFilter}
       GROUP BY actorId, activeDay
     )
     SELECT COUNT(DISTINCT actorId) as actors,
            COUNT(*) as actorDays
     FROM daily_activity`,
  )
    .bind(...binds)
    .first<{ actors: number; actorDays: number }>();

  const distribution = rows.results ?? [];
  const totalActors = totalRow?.actors ?? 0;
  const actorDays = totalRow?.actorDays ?? 0;
  return {
    event: eventName || null,
    actor,
    startAt: range.startAt,
    endAt: range.endAt,
    totalActors,
    actorDays,
    averageActiveDays: totalActors > 0 ? Math.round((actorDays / totalActors) * 100) / 100 : 0,
    distribution: distribution.map((row) => ({
      activeDays: row.activeDays,
      actors: row.actors,
      events: row.events,
      percentage: totalActors > 0 ? Math.round((row.actors / totalActors) * 1000) / 10 : 0,
    })),
  };
}

function journeyPrefixHaving(prefixSteps: string[]) {
  if (!prefixSteps.length) return { having: '', binds: [] as string[] };
  const checks = prefixSteps.map(
    (_, idx) => `MAX(CASE WHEN step_rn = ${idx + 1} THEN url_path END) = ?`,
  );
  return { having: checks.join(' AND '), binds: [...prefixSteps] };
}

export type JourneyFlowStep = { path: string; count: number };

export async function getJourneyFlowReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  prefixSteps: string[],
  limit = 20,
  segment?: SegmentParams | null,
) {
  const range = clampReportRange(startAt, endAt);
  const cappedLimit = clampJourneyLimit(limit);
  const { joins, where, binds } = segmentEventFilter(websiteId, range.startAt, range.endAt, segment);
  const { having, binds: prefixBinds } = journeyPrefixHaving(prefixSteps);
  const nextStepRn = prefixSteps.length + 1;
  const havingClause = having ? `HAVING ${having}` : '';

  const baseCte = `WITH filtered AS (
      SELECT e.visit_id, e.url_path, e.created_at
      FROM website_event e${joins}
      WHERE ${where} AND e.event_type = ${EVENT_TYPE.pageView}
    ),
    sampled_visits AS (
      SELECT visit_id FROM (
        SELECT visit_id, MAX(created_at) as last_at
        FROM filtered
        GROUP BY visit_id
        ORDER BY last_at DESC
        LIMIT ${MAX_JOURNEY_VISIT_SAMPLE}
      )
    ),
    ranked AS (
      SELECT f.visit_id, f.url_path, f.created_at,
        ROW_NUMBER() OVER (PARTITION BY f.visit_id ORDER BY f.created_at) as step_rn
      FROM filtered f
      INNER JOIN sampled_visits sv ON sv.visit_id = f.visit_id
    ),
    matching_visits AS (
      SELECT visit_id
      FROM ranked
      GROUP BY visit_id
      ${havingClause}
    )`;

  const [nextRows, totalRow, pathRows] = await Promise.all([
    env.DB.prepare(
      `${baseCte}
      SELECT r.url_path as path, COUNT(DISTINCT r.visit_id) as count
      FROM ranked r
      INNER JOIN matching_visits mv ON mv.visit_id = r.visit_id
      WHERE r.step_rn = ${nextStepRn}
      GROUP BY r.url_path
      ORDER BY count DESC
      LIMIT ?`,
    )
      .bind(...binds, ...prefixBinds, cappedLimit)
      .all<JourneyFlowStep>(),
    env.DB.prepare(
      `${baseCte}
      SELECT COUNT(*) as total FROM matching_visits`,
    )
      .bind(...binds, ...prefixBinds)
      .first<{ total: number }>(),
    env.DB.prepare(
      `${baseCte},
      visit_paths AS (
        SELECT r.visit_id,
          GROUP_CONCAT(r.url_path, ' → ') as path
        FROM ranked r
        INNER JOIN matching_visits mv ON mv.visit_id = r.visit_id
        WHERE r.step_rn <= ${MAX_JOURNEY_PATH_STEPS}
        GROUP BY r.visit_id
      )
      SELECT path, COUNT(*) as count
      FROM visit_paths
      GROUP BY path
      ORDER BY count DESC
      LIMIT ?`,
    )
      .bind(...binds, ...prefixBinds, cappedLimit)
      .all<{ path: string; count: number }>(),
  ]);

  return {
    prefix: prefixSteps,
    depth: prefixSteps.length,
    total: totalRow?.total ?? 0,
    next: nextRows.results ?? [],
    paths: pathRows.results ?? [],
    startAt: range.startAt,
    endAt: range.endAt,
    limit: cappedLimit,
  };
}

export async function getJourneyReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  limit = 20,
  segment?: SegmentParams | null,
  offset = 0,
) {
  const range = clampReportRange(startAt, endAt);
  const cappedLimit = clampJourneyLimit(limit);
  const cappedOffset = Math.max(0, Math.min(Math.floor(offset) || 0, 500));
  const { joins, where, binds } = segmentEventFilter(websiteId, range.startAt, range.endAt, segment);
  const sql = `WITH filtered AS (
      SELECT e.visit_id, e.url_path, e.created_at
      FROM website_event e${joins}
      WHERE ${where} AND e.event_type = ${EVENT_TYPE.pageView}
    ),
    sampled_visits AS (
      SELECT visit_id FROM (
        SELECT visit_id, MAX(created_at) as last_at
        FROM filtered
        GROUP BY visit_id
        ORDER BY last_at DESC
        LIMIT ${MAX_JOURNEY_VISIT_SAMPLE}
      )
    ),
    ranked AS (
      SELECT f.visit_id, f.url_path, f.created_at,
        ROW_NUMBER() OVER (PARTITION BY f.visit_id ORDER BY f.created_at) as step_rn
      FROM filtered f
      INNER JOIN sampled_visits sv ON sv.visit_id = f.visit_id
    ),
    visit_paths AS (
      SELECT visit_id,
        GROUP_CONCAT(url_path, ' → ') as path
      FROM ranked
      WHERE step_rn <= ${MAX_JOURNEY_PATH_STEPS}
      GROUP BY visit_id
    )
    SELECT path, COUNT(*) as count
    FROM visit_paths
    GROUP BY path
    ORDER BY count DESC
    LIMIT ? OFFSET ?`;

  const rows = await env.DB.prepare(sql)
    .bind(...binds, cappedLimit, cappedOffset)
    .all<{ path: string; count: number }>();

  return {
    paths: rows.results ?? [],
    startAt: range.startAt,
    endAt: range.endAt,
    limit: cappedLimit,
    offset: cappedOffset,
  };
}

export async function getAttributionReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  model: 'first' | 'last' = 'last',
  segment?: SegmentParams | null,
) {
  const order = model === 'first' ? 'ASC' : 'DESC';
  const { joins, where, binds } = segmentEventFilter(websiteId, startAt, endAt, segment);
  const sql = `SELECT COALESCE(utm_source, '(direct)') as source,
            COUNT(DISTINCT session_id) as sessions,
            COUNT(*) as pageviews
     FROM (
       SELECT e.session_id, e.utm_source,
              ROW_NUMBER() OVER (PARTITION BY e.session_id ORDER BY e.created_at ${order}) as rn
       FROM website_event e${joins}
       WHERE ${where} AND e.event_type = ${EVENT_TYPE.pageView}
     )
     WHERE rn = 1
     GROUP BY utm_source
     ORDER BY sessions DESC
     LIMIT 50`;

  const rows = await env.DB.prepare(sql).bind(...binds).all<{ source: string; sessions: number; pageviews: number }>();

  return { model, sources: rows.results ?? [] };
}

function attributionConversionCondition(type: 'path' | 'event', step: string) {
  if (type === 'path') {
    return {
      clause: `e.event_type = ${EVENT_TYPE.pageView} AND e.url_path = ?`,
      binds: [step] as (string | number)[],
    };
  }
  return {
    clause: `e.event_type = ${EVENT_TYPE.customEvent} AND e.event_name = ?`,
    binds: [step] as (string | number)[],
  };
}

function buildAttributionAttributedCte(
  websiteId: string,
  startAt: number,
  endAt: number,
  model: 'first' | 'last',
  type: 'path' | 'event',
  step: string,
  segment?: SegmentParams | null,
) {
  const order = model === 'first' ? 'ASC' : 'DESC';
  const { joins, where, binds } = segmentEventFilter(websiteId, startAt, endAt, segment);
  const conversion = attributionConversionCondition(type, step);
  const convertingWhere = `${where} AND ${conversion.clause}`;
  const convertingBinds = [...binds, ...conversion.binds];
  const paidAds = paidAdsCaseSql('tc');

  const cte = `WITH converting_sessions AS (
      SELECT e.session_id, MIN(e.created_at) AS converted_at
      FROM website_event e${joins}
      WHERE ${convertingWhere}
      GROUP BY e.session_id
    ),
    touch_candidates AS (
      SELECT
        cs.session_id,
        cs.converted_at,
        e.referrer_domain,
        e.gclid,
        e.msclkid,
        e.fbclid,
        e.ttclid,
        e.twclid,
        e.utm_source,
        e.utm_medium,
        e.utm_campaign,
        e.utm_content,
        e.utm_term,
        ROW_NUMBER() OVER (
          PARTITION BY cs.session_id
          ORDER BY e.created_at ${order}
        ) AS rn
      FROM converting_sessions cs
      INNER JOIN website_event e ON e.session_id = cs.session_id
      WHERE e.website_id = ?
        AND e.event_type = ${EVENT_TYPE.pageView}
        AND e.created_at <= cs.converted_at
    ),
    attributed AS (
      SELECT
        tc.session_id,
        tc.converted_at,
        COALESCE(NULLIF(tc.referrer_domain, ''), '(direct)') AS referrer,
        ${paidAds} AS paid_ads,
        COALESCE(NULLIF(tc.utm_source, ''), '(direct)') AS utm_source,
        COALESCE(NULLIF(tc.utm_medium, ''), '(direct)') AS utm_medium,
        COALESCE(NULLIF(tc.utm_campaign, ''), '(none)') AS utm_campaign,
        COALESCE(NULLIF(tc.utm_content, ''), '(none)') AS utm_content,
        COALESCE(NULLIF(tc.utm_term, ''), '(none)') AS utm_term
      FROM touch_candidates tc
      WHERE tc.rn = 1
      UNION ALL
      SELECT
        cs.session_id,
        cs.converted_at,
        '(direct)' AS referrer,
        NULL AS paid_ads,
        '(direct)' AS utm_source,
        '(direct)' AS utm_medium,
        '(none)' AS utm_campaign,
        '(none)' AS utm_content,
        '(none)' AS utm_term
      FROM converting_sessions cs
      WHERE NOT EXISTS (
        SELECT 1
        FROM website_event e
        WHERE e.session_id = cs.session_id
          AND e.website_id = ?
          AND e.event_type = ${EVENT_TYPE.pageView}
          AND e.created_at <= cs.converted_at
      )
    )`;

  const cteBinds = [...convertingBinds, websiteId, websiteId];
  return { cte, cteBinds };
}

async function attributionBreakdown(
  env: Env,
  cte: string,
  cteBinds: (string | number)[],
  column: string,
  filter?: string,
) {
  const whereClause = filter ? `WHERE ${filter}` : '';
  const sql = `${cte}
    SELECT ${column} AS name, COUNT(*) AS value
    FROM attributed
    ${whereClause}
    GROUP BY ${column}
    ORDER BY value DESC
    LIMIT 50`;
  const rows = await env.DB.prepare(sql)
    .bind(...cteBinds)
    .all<{ name: string; value: number }>();
  return rows.results ?? [];
}

export async function getAttributionConversionReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  model: 'first' | 'last',
  type: 'path' | 'event',
  step: string,
  segment?: SegmentParams | null,
  segmentId?: string | null,
): Promise<AttributionConversionResponse> {
  const range = clampReportRange(startAt, endAt);
  const { cte, cteBinds } = buildAttributionAttributedCte(
    websiteId,
    range.startAt,
    range.endAt,
    model,
    type,
    step,
    segment,
  );

  const totalsSql = `${cte}
    SELECT
      (SELECT COUNT(DISTINCT cs.session_id) FROM converting_sessions cs) AS conversions,
      (SELECT COUNT(DISTINCT cs.session_id) FROM converting_sessions cs) AS visits,
      (
        SELECT COUNT(DISTINCT COALESCE(s.distinct_id, cs.session_id))
        FROM converting_sessions cs
        LEFT JOIN session s ON s.session_id = cs.session_id
      ) AS visitors,
      (
        SELECT COUNT(*)
        FROM website_event e
        INNER JOIN converting_sessions cs ON cs.session_id = e.session_id
        WHERE e.website_id = ?
          AND e.event_type = ${EVENT_TYPE.pageView}
          AND e.created_at >= ?
          AND e.created_at <= ?
      ) AS pageviews`;

  const totalsBinds = [...cteBinds, websiteId, range.startAt, range.endAt];
  const totalsRow = await env.DB.prepare(totalsSql)
    .bind(...totalsBinds)
    .first<{ conversions: number; visits: number; visitors: number; pageviews: number }>();

  const [referrer, paidAds, utm_source, utm_medium, utm_campaign, utm_content, utm_term] =
    await Promise.all([
      attributionBreakdown(env, cte, cteBinds, 'referrer'),
      attributionBreakdown(env, cte, cteBinds, 'paid_ads', 'paid_ads IS NOT NULL'),
      attributionBreakdown(env, cte, cteBinds, 'utm_source'),
      attributionBreakdown(env, cte, cteBinds, 'utm_medium'),
      attributionBreakdown(env, cte, cteBinds, 'utm_campaign'),
      attributionBreakdown(env, cte, cteBinds, 'utm_content'),
      attributionBreakdown(env, cte, cteBinds, 'utm_term'),
    ]);

  return {
    model,
    type,
    step,
    segmentId: segmentId ?? null,
    startAt: range.startAt,
    endAt: range.endAt,
    total: {
      visitors: totalsRow?.visitors ?? 0,
      visits: totalsRow?.visits ?? 0,
      pageviews: totalsRow?.pageviews ?? 0,
      conversions: totalsRow?.conversions ?? 0,
    },
    referrer,
    paidAds,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
  };
}

export async function getBreakdownReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  dimension: string,
  segment?: SegmentParams | null,
) {
  const seg = buildSegmentSql(segment ?? null);
  const dimCol =
    dimension === 'browser'
      ? 's.browser'
      : dimension === 'os'
        ? 's.os'
        : dimension === 'device'
          ? 's.device'
          : dimension === 'country'
            ? 's.country'
            : dimension === 'language'
              ? 's.language'
              : dimension === 'path'
                ? 'e.url_path'
                : dimension === 'referrer'
                  ? 'e.referrer_domain'
                  : 's.country';

  const joins = ' INNER JOIN session s ON e.session_id = s.session_id';
  const clauses = [
    'e.website_id = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    'e.event_type = ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [
    websiteId,
    startAt,
    endAt,
    EVENT_TYPE.pageView,
    ...seg.binds,
  ];

  const rows = await env.DB.prepare(
    `SELECT COALESCE(${dimCol}, 'Unknown') as dimension, COUNT(*) as value
     FROM website_event e${joins}
     WHERE ${clauses.join(' AND ')}
     GROUP BY dimension
     ORDER BY value DESC
     LIMIT 50`,
  )
    .bind(...binds)
    .all<{ dimension: string; value: number }>();

  return { dimension, rows: rows.results ?? [] };
}

export type VitalDistribution = {
  good: number;
  needsImprovement: number;
  poor: number;
  total: number;
};

export type PerformanceBreakdownRow = {
  dimension: string;
  samples: number;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  lcpDistribution: VitalDistribution;
  inpDistribution: VitalDistribution;
  clsDistribution: VitalDistribution;
};

export type PerformanceTrendPoint = {
  x: string;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  samples: number;
};

const PERF_EVENT_FILTER = `e.event_type = ${EVENT_TYPE.performance}
       AND (e.lcp IS NOT NULL OR e.inp IS NOT NULL OR e.cls IS NOT NULL
            OR e.fcp IS NOT NULL OR e.ttfb IS NOT NULL)`;

const DISTRIBUTION_SELECT = `
      SUM(CASE WHEN e.lcp IS NOT NULL AND e.lcp <= 2500 THEN 1 ELSE 0 END) as lcp_good,
      SUM(CASE WHEN e.lcp IS NOT NULL AND e.lcp > 2500 AND e.lcp <= 4000 THEN 1 ELSE 0 END) as lcp_ni,
      SUM(CASE WHEN e.lcp IS NOT NULL AND e.lcp > 4000 THEN 1 ELSE 0 END) as lcp_poor,
      COUNT(e.lcp) as lcp_total,
      SUM(CASE WHEN e.inp IS NOT NULL AND e.inp <= 200 THEN 1 ELSE 0 END) as inp_good,
      SUM(CASE WHEN e.inp IS NOT NULL AND e.inp > 200 AND e.inp <= 500 THEN 1 ELSE 0 END) as inp_ni,
      SUM(CASE WHEN e.inp IS NOT NULL AND e.inp > 500 THEN 1 ELSE 0 END) as inp_poor,
      COUNT(e.inp) as inp_total,
      SUM(CASE WHEN e.cls IS NOT NULL AND e.cls <= 0.1 THEN 1 ELSE 0 END) as cls_good,
      SUM(CASE WHEN e.cls IS NOT NULL AND e.cls > 0.1 AND e.cls <= 0.25 THEN 1 ELSE 0 END) as cls_ni,
      SUM(CASE WHEN e.cls IS NOT NULL AND e.cls > 0.25 THEN 1 ELSE 0 END) as cls_poor,
      COUNT(e.cls) as cls_total,
      SUM(CASE WHEN e.fcp IS NOT NULL AND e.fcp <= 1800 THEN 1 ELSE 0 END) as fcp_good,
      SUM(CASE WHEN e.fcp IS NOT NULL AND e.fcp > 1800 AND e.fcp <= 3000 THEN 1 ELSE 0 END) as fcp_ni,
      SUM(CASE WHEN e.fcp IS NOT NULL AND e.fcp > 3000 THEN 1 ELSE 0 END) as fcp_poor,
      COUNT(e.fcp) as fcp_total,
      SUM(CASE WHEN e.ttfb IS NOT NULL AND e.ttfb <= 800 THEN 1 ELSE 0 END) as ttfb_good,
      SUM(CASE WHEN e.ttfb IS NOT NULL AND e.ttfb > 800 AND e.ttfb <= 1800 THEN 1 ELSE 0 END) as ttfb_ni,
      SUM(CASE WHEN e.ttfb IS NOT NULL AND e.ttfb > 1800 THEN 1 ELSE 0 END) as ttfb_poor,
      COUNT(e.ttfb) as ttfb_total`;

type DistributionRow = {
  lcp_good: number;
  lcp_ni: number;
  lcp_poor: number;
  lcp_total: number;
  inp_good: number;
  inp_ni: number;
  inp_poor: number;
  inp_total: number;
  cls_good: number;
  cls_ni: number;
  cls_poor: number;
  cls_total: number;
  fcp_good: number;
  fcp_ni: number;
  fcp_poor: number;
  fcp_total: number;
  ttfb_good: number;
  ttfb_ni: number;
  ttfb_poor: number;
  ttfb_total: number;
};

function mapDistribution(
  row: DistributionRow,
  prefix: 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb',
): VitalDistribution {
  return {
    good: row[`${prefix}_good`] ?? 0,
    needsImprovement: row[`${prefix}_ni`] ?? 0,
    poor: row[`${prefix}_poor`] ?? 0,
    total: row[`${prefix}_total`] ?? 0,
  };
}

function performanceTrendUnit(startAt: number, endAt: number) {
  const rangeMs = endAt - startAt;
  return rangeMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
}

async function getPerformanceBreakdown(
  env: Env,
  joins: string,
  where: string,
  binds: (string | number)[],
  groupExpr: string,
  limit = 10,
): Promise<PerformanceBreakdownRow[]> {
  const rows = await env.DB.prepare(
    `SELECT ${groupExpr} as dimension,
      COUNT(*) as samples,
      ROUND(AVG(e.lcp), 2) as lcp,
      ROUND(AVG(e.inp), 2) as inp,
      ROUND(AVG(e.cls), 4) as cls,
      SUM(CASE WHEN e.lcp IS NOT NULL AND e.lcp <= 2500 THEN 1 ELSE 0 END) as lcp_good,
      SUM(CASE WHEN e.lcp IS NOT NULL AND e.lcp > 2500 AND e.lcp <= 4000 THEN 1 ELSE 0 END) as lcp_ni,
      SUM(CASE WHEN e.lcp IS NOT NULL AND e.lcp > 4000 THEN 1 ELSE 0 END) as lcp_poor,
      COUNT(e.lcp) as lcp_total,
      SUM(CASE WHEN e.inp IS NOT NULL AND e.inp <= 200 THEN 1 ELSE 0 END) as inp_good,
      SUM(CASE WHEN e.inp IS NOT NULL AND e.inp > 200 AND e.inp <= 500 THEN 1 ELSE 0 END) as inp_ni,
      SUM(CASE WHEN e.inp IS NOT NULL AND e.inp > 500 THEN 1 ELSE 0 END) as inp_poor,
      COUNT(e.inp) as inp_total,
      SUM(CASE WHEN e.cls IS NOT NULL AND e.cls <= 0.1 THEN 1 ELSE 0 END) as cls_good,
      SUM(CASE WHEN e.cls IS NOT NULL AND e.cls > 0.1 AND e.cls <= 0.25 THEN 1 ELSE 0 END) as cls_ni,
      SUM(CASE WHEN e.cls IS NOT NULL AND e.cls > 0.25 THEN 1 ELSE 0 END) as cls_poor,
      COUNT(e.cls) as cls_total
     FROM website_event e${joins}
     WHERE ${where} AND ${PERF_EVENT_FILTER}
     GROUP BY dimension
     ORDER BY samples DESC
     LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<
      DistributionRow & {
        dimension: string;
        samples: number;
        lcp: number | null;
        inp: number | null;
        cls: number | null;
      }
    >();

  return (rows.results ?? []).map((row) => ({
    dimension: row.dimension || 'Unknown',
    samples: row.samples,
    lcp: row.lcp,
    inp: row.inp,
    cls: row.cls,
    lcpDistribution: mapDistribution(row, 'lcp'),
    inpDistribution: mapDistribution(row, 'inp'),
    clsDistribution: mapDistribution(row, 'cls'),
  }));
}

export async function getPerformanceReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment?: SegmentParams | null,
) {
  const { joins, where, binds } = segmentEventFilter(websiteId, startAt, endAt, segment);
  const perfWhere = `${where} AND ${PERF_EVENT_FILTER}`;

  const summarySql = `SELECT
      ROUND(AVG(e.lcp), 2) as lcp,
      ROUND(AVG(e.inp), 2) as inp,
      ROUND(AVG(e.cls), 4) as cls,
      ROUND(AVG(e.fcp), 2) as fcp,
      ROUND(AVG(e.ttfb), 2) as ttfb,
      COUNT(*) as samples,
      COUNT(e.lcp) as lcp_samples,
      COUNT(e.inp) as inp_samples,
      COUNT(e.cls) as cls_samples,
      COUNT(e.fcp) as fcp_samples,
      COUNT(e.ttfb) as ttfb_samples,
      ${DISTRIBUTION_SELECT}
     FROM website_event e${joins}
     WHERE ${perfWhere}`;

  const row = await env.DB.prepare(summarySql)
    .bind(...binds)
    .first<
      DistributionRow & {
        lcp: number | null;
        inp: number | null;
        cls: number | null;
        fcp: number | null;
        ttfb: number | null;
        samples: number;
        lcp_samples: number;
        inp_samples: number;
        cls_samples: number;
        fcp_samples: number;
        ttfb_samples: number;
      }
    >();

  const unit = performanceTrendUnit(startAt, endAt);
  const trendFormat = unit === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
  const trendRows = await env.DB.prepare(
    `SELECT strftime('${trendFormat}', datetime(e.created_at / 1000, 'unixepoch')) as x,
      ROUND(AVG(e.lcp), 2) as lcp,
      ROUND(AVG(e.inp), 2) as inp,
      ROUND(AVG(e.cls), 4) as cls,
      ROUND(AVG(e.fcp), 2) as fcp,
      ROUND(AVG(e.ttfb), 2) as ttfb,
      COUNT(*) as samples
     FROM website_event e${joins}
     WHERE ${perfWhere}
     GROUP BY x
     ORDER BY x ASC`,
  )
    .bind(...binds)
    .all<PerformanceTrendPoint>();

  const sessionJoins = joins.includes('session s')
    ? joins
    : `${joins} INNER JOIN session s ON e.session_id = s.session_id`;

  const [byUrl, byBrowser, byCountry] = await Promise.all([
    getPerformanceBreakdown(env, joins, where, binds, 'e.url_path'),
    getPerformanceBreakdown(env, sessionJoins, where, binds, "COALESCE(s.browser, 'Unknown')"),
    getPerformanceBreakdown(env, sessionJoins, where, binds, "COALESCE(s.country, 'Unknown')"),
  ]);

  const distRow = row ?? ({} as DistributionRow);

  return {
    lcp: row?.lcp ?? null,
    inp: row?.inp ?? null,
    cls: row?.cls ?? null,
    fcp: row?.fcp ?? null,
    ttfb: row?.ttfb ?? null,
    samples: row?.samples ?? 0,
    lcpSamples: row?.lcp_samples ?? 0,
    inpSamples: row?.inp_samples ?? 0,
    clsSamples: row?.cls_samples ?? 0,
    fcpSamples: row?.fcp_samples ?? 0,
    ttfbSamples: row?.ttfb_samples ?? 0,
    distributions: {
      lcp: mapDistribution(distRow, 'lcp'),
      inp: mapDistribution(distRow, 'inp'),
      cls: mapDistribution(distRow, 'cls'),
      fcp: mapDistribution(distRow, 'fcp'),
      ttfb: mapDistribution(distRow, 'ttfb'),
    },
    trends: {
      unit,
      points: trendRows.results ?? [],
    },
    breakdown: {
      url: byUrl,
      browser: byBrowser,
      country: byCountry,
    },
  };
}
