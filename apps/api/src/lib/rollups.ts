import { EVENT_TYPE } from '@flareboard/shared';
import { rollupDailyRangeEligible, rollupHourlySeriesEligible } from '@flareboard/shared';
import type { Env } from '../env';

export type StatsBlock = {
  pageviews: { value: number; change: number };
  visitors: { value: number; change: number };
  visits: { value: number; change: number };
  bounces: { value: number; change: number };
  totaltime: { value: number; change: number };
};

function statChange(current: number, previous: number) {
  const change =
    previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
  return { value: current, change };
}

function dayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInRange(startAt: number, endAt: number): string[] {
  const days: string[] = [];
  const cursor = new Date(startAt);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(endAt);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function hourBucket(ms: number) {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13).replace('T', ' ') + ':00';
}

function monthBucket(ms: number) {
  return new Date(ms).toISOString().slice(0, 7);
}

function yearBucket(ms: number) {
  return new Date(ms).toISOString().slice(0, 4);
}

export function rollupRangeEligible(startAt: number, endAt: number) {
  return rollupDailyRangeEligible(startAt, endAt);
}

function rollupSeriesRangeEligible(startAt: number, endAt: number, unit: string) {
  const unitKey = unit === 'hour' ? 'hour' : unit === 'month' ? 'month' : unit === 'year' ? 'year' : 'day';
  return unitKey === 'hour'
    ? rollupHourlySeriesEligible(startAt, endAt)
    : rollupDailyRangeEligible(startAt, endAt);
}

function seriesUnitKey(unit: string) {
  return unit === 'hour' ? 'hour' : unit === 'month' ? 'month' : unit === 'year' ? 'year' : 'day';
}

function seriesStartBucket(unitKey: string, startAt: number) {
  return unitKey === 'hour'
    ? hourBucket(startAt)
    : unitKey === 'month'
      ? monthBucket(startAt)
      : unitKey === 'year'
        ? yearBucket(startAt)
        : dayKey(startAt);
}

function seriesEndBucket(unitKey: string, endAt: number) {
  return unitKey === 'hour'
    ? hourBucket(endAt)
    : unitKey === 'month'
      ? monthBucket(endAt)
      : unitKey === 'year'
        ? yearBucket(endAt)
        : dayKey(endAt);
}

function sqlInPlaceholders(count: number, startIndex = 1) {
  return Array.from({ length: count }, (_, i) => `?${startIndex + i}`).join(', ');
}

async function rollupDaysComplete(env: Env, websiteId: string, days: string[]) {
  if (!days.length) return false;
  const dayPlaceholders = sqlInPlaceholders(days.length, 2);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM rollup_stats_daily
     WHERE website_id = ?1 AND day IN (${dayPlaceholders})`,
  )
    .bind(websiteId, ...days)
    .first<{ count: number }>();
  return (row?.count ?? 0) === days.length;
}

export async function getWebsiteStatsFromRollups(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
): Promise<StatsBlock | null> {
  if (!rollupRangeEligible(startAt, endAt)) return null;

  const days = daysInRange(startAt, endAt);
  if (!(await rollupDaysComplete(env, websiteId, days))) return null;

  const period = endAt - startAt;
  const prevStart = startAt - period;
  const prevEnd = startAt;
  const prevDays = daysInRange(prevStart, prevEnd);

  const sumDays = async (targetDays: string[]) => {
    if (!targetDays.length) {
      return { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime_sec: 0 };
    }
    const dayPlaceholders = sqlInPlaceholders(targetDays.length, 2);
    return (
      (await env.DB.prepare(
        `SELECT
           COALESCE(SUM(pageviews), 0) as pageviews,
           COALESCE(SUM(visitors), 0) as visitors,
           COALESCE(SUM(visits), 0) as visits,
           COALESCE(SUM(bounces), 0) as bounces,
           COALESCE(SUM(totaltime_sec), 0) as totaltime_sec
         FROM rollup_stats_daily
         WHERE website_id = ?1 AND day IN (${dayPlaceholders})`,
      )
        .bind(websiteId, ...targetDays)
        .first<{
          pageviews: number;
          visitors: number;
          visits: number;
          bounces: number;
          totaltime_sec: number;
        }>()) ?? {
        pageviews: 0,
        visitors: 0,
        visits: 0,
        bounces: 0,
        totaltime_sec: 0,
      }
    );
  };

  const [current, previous] = await Promise.all([sumDays(days), sumDays(prevDays)]);

  return {
    pageviews: statChange(current.pageviews, previous.pageviews),
    visitors: statChange(current.visitors, previous.visitors),
    visits: statChange(current.visits, previous.visits),
    bounces: statChange(current.bounces, previous.bounces),
    totaltime: statChange(current.totaltime_sec, previous.totaltime_sec),
  };
}

export async function getPageviewsFromRollups(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  unit: string,
): Promise<{ pageviews: { x: string; y: number }[] } | null> {
  if (!rollupSeriesRangeEligible(startAt, endAt, unit)) return null;

  const unitKey = seriesUnitKey(unit);
  const startBucket = seriesStartBucket(unitKey, startAt);
  const endBucket = seriesEndBucket(unitKey, endAt);

  if (unitKey !== 'hour') {
    const days = daysInRange(startAt, endAt);
    if (!(await rollupDaysComplete(env, websiteId, days))) return null;
  }

  const rows = await env.DB.prepare(
    `SELECT bucket, pageviews
     FROM rollup_pageview_series
     WHERE website_id = ?1 AND unit = ?2 AND bucket >= ?3 AND bucket <= ?4
     ORDER BY bucket ASC`,
  )
    .bind(websiteId, unitKey, startBucket, endBucket)
    .all<{ bucket: string; pageviews: number }>();

  if (!rows.results?.length) return null;

  return {
    pageviews: rows.results.map((r) => ({ x: r.bucket, y: r.pageviews })),
  };
}

const METRIC_DIMENSION: Record<string, string> = {
  path: 'path',
  url: 'path',
  referrer: 'referrer',
  country: 'country',
  browser: 'browser',
  os: 'os',
  device: 'device',
  language: 'language',
};

export async function getMetricsFromRollups(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  type: string,
  limit = 10,
): Promise<{ x: string; y: number }[] | null> {
  if (!rollupRangeEligible(startAt, endAt)) return null;

  const dimension = METRIC_DIMENSION[type];
  if (!dimension) return null;

  const days = daysInRange(startAt, endAt);
  if (!(await rollupDaysComplete(env, websiteId, days))) return null;

  const dayPlaceholders = sqlInPlaceholders(days.length, 3);
  const limitIndex = days.length + 3;
  const rows = await env.DB.prepare(
    `SELECT value, SUM(count) as count
     FROM rollup_dimension_daily
     WHERE website_id = ?1 AND dimension = ?2 AND day IN (${dayPlaceholders})
     GROUP BY value
     ORDER BY count DESC
     LIMIT ?${limitIndex}`,
  )
    .bind(websiteId, dimension, ...days, limit)
    .all<{ value: string; count: number }>();

  if (!rows.results?.length) return null;

  return rows.results.map((r) => ({
    x: dimension === 'referrer' ? r.value || 'Direct' : r.value || 'Unknown',
    y: r.count,
  }));
}

export async function getCustomEventsFromRollups(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
): Promise<{ x: string; y: number }[] | null> {
  if (!rollupRangeEligible(startAt, endAt)) return null;

  const days = daysInRange(startAt, endAt);
  if (!(await rollupDaysComplete(env, websiteId, days))) return null;

  const dayPlaceholders = sqlInPlaceholders(days.length, 2);
  const rows = await env.DB.prepare(
    `SELECT event_name as eventName, SUM(count) as count
     FROM rollup_event_daily
     WHERE website_id = ?1 AND day IN (${dayPlaceholders})
     GROUP BY event_name
     ORDER BY count DESC`,
  )
    .bind(websiteId, ...days)
    .all<{ eventName: string; count: number }>();

  if (!rows.results?.length) return null;

  return rows.results.map((r) => ({ x: r.eventName ?? 'Unknown', y: r.count }));
}

export type WebsiteMetricsSeries = {
  pageviews: { x: string; y: number }[];
  visitors: { x: string; y: number }[];
};

async function loadSeriesIdentities(
  env: Env,
  websiteId: string,
  unitKey: string,
  startBucket: string,
  endBucket: string,
): Promise<{ bucket: string; visitors: number; visits: number }[]> {
  const rows = await env.DB.prepare(
    `SELECT bucket,
            COUNT(DISTINCT session_id) as visitors,
            COUNT(DISTINCT visit_id) as visits
     FROM rollup_series_bucket
     WHERE website_id = ?1 AND unit = ?2 AND bucket >= ?3 AND bucket <= ?4
     GROUP BY bucket
     ORDER BY bucket ASC`,
  )
    .bind(websiteId, unitKey, startBucket, endBucket)
    .all<{ bucket: string; visitors: number; visits: number }>();
  return rows.results ?? [];
}

async function loadDailyVisitorsFromSessionDay(
  env: Env,
  websiteId: string,
  days: string[],
): Promise<{ x: string; y: number }[]> {
  if (!days.length) return [];
  const dayPlaceholders = sqlInPlaceholders(days.length, 2);
  const rows = await env.DB.prepare(
    `SELECT day as x, COUNT(DISTINCT session_id) as y
     FROM rollup_session_day
     WHERE website_id = ?1 AND day IN (${dayPlaceholders})
     GROUP BY day
     ORDER BY day ASC`,
  )
    .bind(websiteId, ...days)
    .all<{ x: string; y: number }>();
  return rows.results ?? [];
}

export async function getWebsiteMetricsSeriesFromRollups(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  unit: string,
): Promise<WebsiteMetricsSeries | null> {
  if (!rollupSeriesRangeEligible(startAt, endAt, unit)) return null;

  const unitKey = seriesUnitKey(unit);
  const startBucket = seriesStartBucket(unitKey, startAt);
  const endBucket = seriesEndBucket(unitKey, endAt);
  const days = unitKey === 'day' ? daysInRange(startAt, endAt) : [];

  if (unitKey !== 'hour' && !(await rollupDaysComplete(env, websiteId, days))) return null;

  const pageviewRows = await env.DB.prepare(
    `SELECT bucket, pageviews
     FROM rollup_pageview_series
     WHERE website_id = ?1 AND unit = ?2 AND bucket >= ?3 AND bucket <= ?4
     ORDER BY bucket ASC`,
  )
    .bind(websiteId, unitKey, startBucket, endBucket)
    .all<{ bucket: string; pageviews: number }>();

  if (!pageviewRows.results?.length) return null;

  let visitors: { x: string; y: number }[];
  if (unitKey === 'day') {
    visitors = await loadDailyVisitorsFromSessionDay(env, websiteId, days);
  } else {
    const identityRows = await loadSeriesIdentities(env, websiteId, unitKey, startBucket, endBucket);
    if (!identityRows.length) return null;
    visitors = identityRows.map((r) => ({ x: r.bucket, y: r.visitors }));
  }

  return {
    pageviews: pageviewRows.results.map((r) => ({ x: r.bucket, y: r.pageviews })),
    visitors,
  };
}

export type DashboardSiteMetric = {
  websiteId: string;
  pageviews: number;
  visitors: number;
  visits: number;
};

export async function getDashboardMetricsFromRollups(
  env: Env,
  websiteIds: string[],
  startAt: number,
  endAt: number,
): Promise<DashboardSiteMetric[] | null> {
  if (!websiteIds.length || !rollupDailyRangeEligible(startAt, endAt)) return null;

  const days = daysInRange(startAt, endAt);
  if (!days.length) return null;

  const sitePlaceholders = sqlInPlaceholders(websiteIds.length, 1);
  const dayPlaceholders = sqlInPlaceholders(days.length, websiteIds.length + 1);
  const completeChecks = await Promise.all(
    websiteIds.map((id) => rollupDaysComplete(env, id, days)),
  );
  if (!completeChecks.every(Boolean)) return null;

  const statsRows = await env.DB.prepare(
    `SELECT website_id as websiteId,
            COALESCE(SUM(pageviews), 0) as pageviews,
            COALESCE(SUM(visits), 0) as visits
     FROM rollup_stats_daily
     WHERE website_id IN (${sitePlaceholders}) AND day IN (${dayPlaceholders})
     GROUP BY website_id`,
  )
    .bind(...websiteIds, ...days)
    .all<{ websiteId: string; pageviews: number; visits: number }>();

  const visitorRows = await env.DB.prepare(
    `SELECT website_id as websiteId, COUNT(DISTINCT session_id) as visitors
     FROM rollup_session_day
     WHERE website_id IN (${sitePlaceholders}) AND day IN (${dayPlaceholders})
     GROUP BY website_id`,
  )
    .bind(...websiteIds, ...days)
    .all<{ websiteId: string; visitors: number }>();

  if (!statsRows.results?.length) return null;

  const visitorsBySite = new Map((visitorRows.results ?? []).map((r) => [r.websiteId, r.visitors]));
  return statsRows.results.map((row) => ({
    websiteId: row.websiteId,
    pageviews: row.pageviews,
    visitors: visitorsBySite.get(row.websiteId) ?? 0,
    visits: row.visits,
  }));
}

export type AggregateMetricsSeries = {
  pageviews: { x: string; y: number }[];
  visitors: { x: string; y: number }[];
  visits: { x: string; y: number }[];
};

export async function getAggregateMetricsFromRollups(
  env: Env,
  websiteIds: string[],
  startAt: number,
  endAt: number,
  unit: string,
): Promise<AggregateMetricsSeries | null> {
  if (!websiteIds.length || !rollupSeriesRangeEligible(startAt, endAt, unit)) return null;

  const unitKey = seriesUnitKey(unit);
  const startBucket = seriesStartBucket(unitKey, startAt);
  const endBucket = seriesEndBucket(unitKey, endAt);
  const days = unitKey === 'day' ? daysInRange(startAt, endAt) : [];

  if (unitKey !== 'hour') {
    const completeChecks = await Promise.all(
      websiteIds.map((id) => rollupDaysComplete(env, id, days)),
    );
    if (!completeChecks.every(Boolean)) return null;
  }

  const siteCount = websiteIds.length;
  const sitePlaceholders = sqlInPlaceholders(siteCount, 1);
  const unitIndex = siteCount + 1;
  const startIndex = siteCount + 2;
  const endIndex = siteCount + 3;
  const pageviewRows = await env.DB.prepare(
    `SELECT bucket as x, SUM(pageviews) as pageviews
     FROM rollup_pageview_series
     WHERE website_id IN (${sitePlaceholders}) AND unit = ?${unitIndex} AND bucket >= ?${startIndex} AND bucket <= ?${endIndex}
     GROUP BY bucket
     ORDER BY bucket ASC`,
  )
    .bind(...websiteIds, unitKey, startBucket, endBucket)
    .all<{ x: string; pageviews: number }>();

  const identityRows = await env.DB.prepare(
    `SELECT bucket as x,
            COUNT(DISTINCT session_id) as visitors,
            COUNT(DISTINCT visit_id) as visits
     FROM rollup_series_bucket
     WHERE website_id IN (${sitePlaceholders}) AND unit = ?${unitIndex} AND bucket >= ?${startIndex} AND bucket <= ?${endIndex}
     GROUP BY bucket
     ORDER BY bucket ASC`,
  )
    .bind(...websiteIds, unitKey, startBucket, endBucket)
    .all<{ x: string; visitors: number; visits: number }>();

  if (!pageviewRows.results?.length || !identityRows.results?.length) return null;

  return {
    pageviews: pageviewRows.results.map((r) => ({ x: r.x, y: r.pageviews })),
    visitors: identityRows.results.map((r) => ({ x: r.x, y: r.visitors })),
    visits: identityRows.results.map((r) => ({ x: r.x, y: r.visits })),
  };
}

/** Recompute rollup_stats_daily for one website/day from rollup_session_day. */
export async function refreshRollupStatsDaily(env: Env, websiteId: string, day: string) {
  await env.DB.prepare(
    `INSERT INTO rollup_stats_daily (website_id, day, pageviews, visitors, visits, bounces, totaltime_sec)
     SELECT
       ?1,
       ?2,
       COALESCE(SUM(pageviews), 0),
       COUNT(DISTINCT session_id),
       COUNT(*),
       SUM(CASE WHEN pageviews = 1 THEN 1 ELSE 0 END),
       COALESCE(SUM((last_at - first_at) / 1000), 0)
     FROM rollup_session_day
     WHERE website_id = ?1 AND day = ?2
     ON CONFLICT(website_id, day) DO UPDATE SET
       pageviews = excluded.pageviews,
       visitors = excluded.visitors,
       visits = excluded.visits,
       bounces = excluded.bounces,
       totaltime_sec = excluded.totaltime_sec`,
  )
    .bind(websiteId, day)
    .run();
}

export { dayKey, hourBucket, monthBucket, yearBucket };
