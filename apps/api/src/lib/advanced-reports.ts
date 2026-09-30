import {
  EVENT_TYPE,
  MAX_FUNNEL_WINDOW_MS,
  segmentParamsToFilters,
  type AttributionConversionResponse,
  type PropertyFilter,
} from '@flareboard/shared';
import type { Env } from '../env';
import { paidAdsCaseSql } from './channel';
import { runRetention, runStickiness } from './insight-activity';
import { runFunnel } from './insight-funnels';
import type { InsightContext } from './insight-sql';
import {
  clampJourneyLimit,
  clampReportRange,
  MAX_JOURNEY_PATH_STEPS,
  MAX_JOURNEY_VISIT_SAMPLE,
} from './report-range';
import { buildSegmentSql, type SegmentParams } from './segment-filters';
import { siteDb } from './site-db';

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

function reportFilters(segment?: SegmentParams | null, filters?: PropertyFilter[] | null): PropertyFilter[] {
  return [...segmentParamsToFilters(segment ?? null), ...(filters ?? [])];
}

function reportContext(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  timezone: string,
): InsightContext {
  return { db: siteDb(env, websiteId), websiteId, startAt, endAt, timezone };
}

export type FunnelReportOptions = {
  countBy?: 'person' | 'session';
  order?: 'strict' | 'any';
  windowMs?: number;
  filters?: PropertyFilter[] | null;
  timezone?: string;
};

/**
 * Legacy `/api/reports/funnel` shape over the insight funnel engine. Defaults keep the v1
 * behaviour: custom-event steps counted per session, strict order, no practical window.
 */
export async function getFunnelReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  steps: string[],
  segment?: SegmentParams | null,
  options: FunnelReportOptions = {},
) {
  if (!steps.length) return { steps: [], conversion: 0 };
  const windowMs = Math.min(Math.max(options.windowMs ?? MAX_FUNNEL_WINDOW_MS, 60_000), MAX_FUNNEL_WINDOW_MS);
  const result = await runFunnel(reportContext(env, websiteId, startAt, endAt, options.timezone ?? 'UTC'), {
    version: 2,
    countBy: options.countBy ?? 'session',
    filters: reportFilters(segment, options.filters),
    funnel: {
      steps: steps.map((event) => ({ kind: 'event' as const, event })),
      window: { value: Math.max(1, Math.round(windowMs / 60_000)), unit: 'minute' },
      order: options.order ?? 'strict',
    },
  });
  return {
    steps: result.steps.map((step) => ({
      step: step.label,
      count: step.count,
      rate: Math.round(step.rate),
      avgTimeToConvertMs: step.avgTimeToConvertMs,
      medianTimeToConvertMs: step.medianTimeToConvertMs,
    })),
    conversion: Math.round(result.conversion),
  };
}

/** Legacy weekly pageview retention (`/api/reports/retention`): offsets 0..8 per cohort week. */
export async function getRetentionReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment?: SegmentParams | null,
  options: { filters?: PropertyFilter[] | null; timezone?: string } = {},
) {
  const range = clampReportRange(startAt, endAt);
  const timezone = options.timezone ?? 'UTC';
  const result = await runRetention(reportContext(env, websiteId, range.startAt, range.endAt, timezone), {
    startEvent: { kind: 'pageview' },
    returnEvent: { kind: 'pageview' },
    period: 'week',
    periods: 9,
    countBy: 'session',
    filters: reportFilters(segment, options.filters),
    cohortFrom: range.startAt,
    endAt: range.endAt,
  });
  const cohorts = result.cohorts.flatMap((cohort) =>
    cohort.size
      ? cohort.values
          .map((users, weekOffset) => ({ cohortWeek: cohort.cohort, weekOffset, users }))
          .filter((row) => row.users > 0)
      : [],
  );
  return { cohorts, startAt: range.startAt, endAt: range.endAt };
}

export async function getStickinessReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  eventName?: string | null,
  actor: 'person' | 'session' = 'person',
  segment?: SegmentParams | null,
  options: { filters?: PropertyFilter[] | null; timezone?: string } = {},
) {
  const range = clampReportRange(startAt, endAt);
  const report = await runStickiness(
    reportContext(env, websiteId, range.startAt, range.endAt, options.timezone ?? 'UTC'),
    eventName ? { kind: 'event', event: eventName } : { kind: 'all' },
    actor,
    reportFilters(segment, options.filters),
  );
  const { kind: _kind, ...rest } = report;
  return { ...rest, event: eventName || null };
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

  const db = siteDb(env, websiteId);
  const [nextRows, totalRow, pathRows] = await Promise.all([
    db.prepare(
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
    db.prepare(
      `${baseCte}
      SELECT COUNT(*) as total FROM matching_visits`,
    )
      .bind(...binds, ...prefixBinds)
      .first<{ total: number }>(),
    db.prepare(
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

  const rows = await siteDb(env, websiteId)
    .prepare(sql)
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

  const rows = await siteDb(env, websiteId).prepare(sql).bind(...binds).all<{ source: string; sessions: number; pageviews: number }>();

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
  websiteId: string,
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
  const rows = await siteDb(env, websiteId).prepare(sql)
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
  const totalsRow = await siteDb(env, websiteId).prepare(totalsSql)
    .bind(...totalsBinds)
    .first<{ conversions: number; visits: number; visitors: number; pageviews: number }>();

  const [referrer, paidAds, utm_source, utm_medium, utm_campaign, utm_content, utm_term] =
    await Promise.all([
      attributionBreakdown(env, websiteId, cte, cteBinds, 'referrer'),
      attributionBreakdown(env, websiteId, cte, cteBinds, 'paid_ads', 'paid_ads IS NOT NULL'),
      attributionBreakdown(env, websiteId, cte, cteBinds, 'utm_source'),
      attributionBreakdown(env, websiteId, cte, cteBinds, 'utm_medium'),
      attributionBreakdown(env, websiteId, cte, cteBinds, 'utm_campaign'),
      attributionBreakdown(env, websiteId, cte, cteBinds, 'utm_content'),
      attributionBreakdown(env, websiteId, cte, cteBinds, 'utm_term'),
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

  const rows = await siteDb(env, websiteId).prepare(
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
  websiteId: string,
  joins: string,
  where: string,
  binds: (string | number)[],
  groupExpr: string,
  limit = 10,
): Promise<PerformanceBreakdownRow[]> {
  const rows = await siteDb(env, websiteId).prepare(
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

  const row = await siteDb(env, websiteId).prepare(summarySql)
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
  const trendRows = await siteDb(env, websiteId).prepare(
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
    getPerformanceBreakdown(env, websiteId, joins, where, binds, 'e.url_path'),
    getPerformanceBreakdown(env, websiteId, sessionJoins, where, binds, "COALESCE(s.browser, 'Unknown')"),
    getPerformanceBreakdown(env, websiteId, sessionJoins, where, binds, "COALESCE(s.country, 'Unknown')"),
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
