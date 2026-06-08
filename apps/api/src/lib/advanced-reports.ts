import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
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

export async function getPerformanceReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment?: SegmentParams | null,
) {
  const { joins, where, binds } = segmentEventFilter(websiteId, startAt, endAt, segment);
  const sql = `SELECT
      ROUND(AVG(e.lcp), 2) as lcp,
      ROUND(AVG(e.inp), 2) as inp,
      ROUND(AVG(e.cls), 4) as cls,
      ROUND(AVG(e.fcp), 2) as fcp,
      ROUND(AVG(e.ttfb), 2) as ttfb,
      COUNT(*) as samples
     FROM website_event e${joins}
     WHERE ${where} AND e.event_type = ${EVENT_TYPE.performance}
       AND (e.lcp IS NOT NULL OR e.inp IS NOT NULL OR e.cls IS NOT NULL)`;

  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{
      lcp: number | null;
      inp: number | null;
      cls: number | null;
      fcp: number | null;
      ttfb: number | null;
      samples: number;
    }>();

  return {
    lcp: row?.lcp ?? null,
    inp: row?.inp ?? null,
    cls: row?.cls ?? null,
    fcp: row?.fcp ?? null,
    ttfb: row?.ttfb ?? null,
    samples: row?.samples ?? 0,
  };
}
