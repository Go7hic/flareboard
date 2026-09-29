import { EVENT_TYPE } from '@flareboard/shared';
import { rollupDailyRangeEligible, rollupHourlySeriesEligible } from '@flareboard/shared';
import type { Env } from '../env';
import { siteDb } from './site-db';

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

/**
 * D1 caps a statement at 100 bound parameters, so long ranges cannot bind one
 * parameter per day. Day lists from daysInRange are contiguous: bind the ends.
 */
function dayBounds(days: string[]): [string, string] {
  return [days[0]!, days[days.length - 1]!];
}

const D1_SAFE_IN_LIST = 90;

function chunks<T>(items: T[], size = D1_SAFE_IN_LIST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sqlInPlaceholders(count: number, startIndex = 1) {
  return Array.from({ length: count }, (_, i) => `?${startIndex + i}`).join(', ');
}

async function rollupDaysComplete(env: Env, websiteId: string, days: string[]) {
  if (!days.length) return false;
  const row = await siteDb(env, websiteId).prepare(
    `SELECT COUNT(*) as count FROM rollup_stats_daily
     WHERE website_id = ?1 AND day >= ?2 AND day <= ?3`,
  )
    .bind(websiteId, ...dayBounds(days))
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
  const prevEnd = startAt - 1;
  const prevDays = daysInRange(prevStart, prevEnd);
  if (!(await rollupDaysComplete(env, websiteId, prevDays))) return null;

  const sumDailyStats = async (targetDays: string[]) => {
    if (!targetDays.length) {
      return { pageviews: 0, visits: 0, bounces: 0, totaltime_sec: 0 };
    }
    return (
      (await siteDb(env, websiteId).prepare(
        `SELECT
           COALESCE(SUM(pageviews), 0) as pageviews,
           COALESCE(SUM(visits), 0) as visits,
           COALESCE(SUM(bounces), 0) as bounces,
           COALESCE(SUM(totaltime_sec), 0) as totaltime_sec
         FROM rollup_stats_daily
         WHERE website_id = ?1 AND day >= ?2 AND day <= ?3`,
      )
        .bind(websiteId, ...dayBounds(targetDays))
        .first<{
          pageviews: number;
          visits: number;
          bounces: number;
          totaltime_sec: number;
        }>()) ?? {
        pageviews: 0,
        visits: 0,
        bounces: 0,
        totaltime_sec: 0,
      }
    );
  };

  const countDistinctVisitors = async (targetDays: string[]) => {
    if (!targetDays.length) return 0;
    const row = await siteDb(env, websiteId).prepare(
      `SELECT COUNT(DISTINCT session_id) as visitors
       FROM rollup_session_day
       WHERE website_id = ?1 AND day >= ?2 AND day <= ?3`,
    )
      .bind(websiteId, ...dayBounds(targetDays))
      .first<{ visitors: number }>();
    return row?.visitors ?? 0;
  };

  const [currentStats, previousStats, currentVisitors, previousVisitors] = await Promise.all([
    sumDailyStats(days),
    sumDailyStats(prevDays),
    countDistinctVisitors(days),
    countDistinctVisitors(prevDays),
  ]);

  return {
    pageviews: statChange(currentStats.pageviews, previousStats.pageviews),
    visitors: statChange(currentVisitors, previousVisitors),
    visits: statChange(currentStats.visits, previousStats.visits),
    bounces: statChange(currentStats.bounces, previousStats.bounces),
    totaltime: statChange(currentStats.totaltime_sec, previousStats.totaltime_sec),
  };
}

function hourSeriesBucketsAligned(
  pageviewRows: { bucket: string }[],
  identityRows: { bucket: string }[],
) {
  if (!pageviewRows.length || !identityRows.length) return false;
  if (pageviewRows.length !== identityRows.length) return false;
  const identityBuckets = new Set(identityRows.map((r) => r.bucket));
  return pageviewRows.every((r) => identityBuckets.has(r.bucket));
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

  const rows = await siteDb(env, websiteId).prepare(
    `SELECT bucket, pageviews
     FROM rollup_pageview_series
     WHERE website_id = ?1 AND unit = ?2 AND bucket >= ?3 AND bucket <= ?4
     ORDER BY bucket ASC`,
  )
    .bind(websiteId, unitKey, startBucket, endBucket)
    .all<{ bucket: string; pageviews: number }>();

  if (!rows.results?.length) return null;

  if (unitKey === 'hour') {
    const identityRows = await loadSeriesIdentities(env, websiteId, unitKey, startBucket, endBucket);
    if (!hourSeriesBucketsAligned(rows.results, identityRows)) return null;
  }

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

  const rows = await siteDb(env, websiteId).prepare(
    `SELECT value, SUM(count) as count
     FROM rollup_dimension_daily
     WHERE website_id = ?1 AND dimension = ?2 AND day >= ?3 AND day <= ?4
     GROUP BY value
     ORDER BY count DESC
     LIMIT ?5`,
  )
    .bind(websiteId, dimension, ...dayBounds(days), limit)
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

  const rows = await siteDb(env, websiteId).prepare(
    `SELECT event_name as eventName, SUM(count) as count
     FROM rollup_event_daily
     WHERE website_id = ?1 AND day >= ?2 AND day <= ?3
     GROUP BY event_name
     ORDER BY count DESC`,
  )
    .bind(websiteId, ...dayBounds(days))
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
  const rows = await siteDb(env, websiteId).prepare(
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
  const rows = await siteDb(env, websiteId).prepare(
    `SELECT day as x, COUNT(DISTINCT session_id) as y
     FROM rollup_session_day
     WHERE website_id = ?1 AND day >= ?2 AND day <= ?3
     GROUP BY day
     ORDER BY day ASC`,
  )
    .bind(websiteId, ...dayBounds(days))
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

  const pageviewRows = await siteDb(env, websiteId).prepare(
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
    if (unitKey === 'hour' && !hourSeriesBucketsAligned(pageviewRows.results, identityRows)) return null;
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

  const completeChecks = await Promise.all(
    websiteIds.map((id) => rollupDaysComplete(env, id, days)),
  );
  if (!completeChecks.every(Boolean)) return null;

  // Every site has its own store, so query them in parallel and concatenate.
  const perSite = await Promise.all(
    websiteIds.map(async (websiteId) => {
      const db = siteDb(env, websiteId);
      const stats = await db
        .prepare(
          `SELECT COALESCE(SUM(pageviews), 0) as pageviews, COALESCE(SUM(visits), 0) as visits, COUNT(*) as dayRows
           FROM rollup_stats_daily
           WHERE website_id = ?1 AND day >= ?2 AND day <= ?3`,
        )
        .bind(websiteId, ...dayBounds(days))
        .first<{ pageviews: number; visits: number; dayRows: number }>();
      const visitors = await db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) as visitors
           FROM rollup_session_day
           WHERE website_id = ?1 AND day >= ?2 AND day <= ?3`,
        )
        .bind(websiteId, ...dayBounds(days))
        .first<{ visitors: number }>();
      return { websiteId, stats, visitors: visitors?.visitors ?? 0 };
    }),
  );
  const statsResults = perSite
    .filter((site) => (site.stats?.dayRows ?? 0) > 0)
    .map((site) => ({ websiteId: site.websiteId, pageviews: site.stats!.pageviews, visits: site.stats!.visits }));
  const visitorResults = perSite.map((site) => ({ websiteId: site.websiteId, visitors: site.visitors }));

  if (!statsResults.length) return null;

  const visitorsBySite = new Map(visitorResults.map((r) => [r.websiteId, r.visitors]));
  return statsResults.map((row) => ({
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

  // Sessions and visits belong to one site, so per-site bucket counts add up exactly.
  const pageviewByBucket = new Map<string, number>();
  const identityByBucket = new Map<string, { visitors: number; visits: number }>();
  const perSite = await Promise.all(
    websiteIds.map(async (websiteId) => {
      const db = siteDb(env, websiteId);
      const pageviews = await db
        .prepare(
          `SELECT bucket as x, SUM(pageviews) as pageviews
           FROM rollup_pageview_series
           WHERE website_id = ?1 AND unit = ?2 AND bucket >= ?3 AND bucket <= ?4
           GROUP BY bucket`,
        )
        .bind(websiteId, unitKey, startBucket, endBucket)
        .all<{ x: string; pageviews: number }>();
      const identities = await db
        .prepare(
          `SELECT bucket as x,
                  COUNT(DISTINCT session_id) as visitors,
                  COUNT(DISTINCT visit_id) as visits
           FROM rollup_series_bucket
           WHERE website_id = ?1 AND unit = ?2 AND bucket >= ?3 AND bucket <= ?4
           GROUP BY bucket`,
        )
        .bind(websiteId, unitKey, startBucket, endBucket)
        .all<{ x: string; visitors: number; visits: number }>();
      return { pageviews: pageviews.results ?? [], identities: identities.results ?? [] };
    }),
  );
  for (const site of perSite) {
    for (const row of site.pageviews) {
      pageviewByBucket.set(row.x, (pageviewByBucket.get(row.x) ?? 0) + row.pageviews);
    }
    for (const row of site.identities) {
      const cur = identityByBucket.get(row.x) ?? { visitors: 0, visits: 0 };
      identityByBucket.set(row.x, { visitors: cur.visitors + row.visitors, visits: cur.visits + row.visits });
    }
  }
  const byBucket = <T,>(map: Map<string, T>) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  const pageviewRows = { results: byBucket(pageviewByBucket).map(([x, pageviews]) => ({ x, pageviews })) };
  const identityRows = { results: byBucket(identityByBucket).map(([x, v]) => ({ x, ...v })) };

  if (!pageviewRows.results?.length || !identityRows.results?.length) return null;

  if (
    unitKey === 'hour' &&
    !hourSeriesBucketsAligned(
      pageviewRows.results.map((r) => ({ bucket: r.x })),
      identityRows.results.map((r) => ({ bucket: r.x })),
    )
  ) {
    return null;
  }

  return {
    pageviews: pageviewRows.results.map((r) => ({ x: r.x, y: r.pageviews })),
    visitors: identityRows.results.map((r) => ({ x: r.x, y: r.visitors })),
    visits: identityRows.results.map((r) => ({ x: r.x, y: r.visits })),
  };
}

/** Recompute rollup_stats_daily for one website/day from rollup_session_day. */
export async function invalidateDailyRollups(env: Env, websiteId: string, days: string[]) {
  if (!days.length) return;
  // Imported days need not be contiguous; chunk them under D1's parameter cap.
  for (const dayChunk of chunks(days)) {
    await invalidateDailyRollupChunk(env, websiteId, dayChunk);
  }
}

async function invalidateDailyRollupChunk(env: Env, websiteId: string, days: string[]) {
  const dayPlaceholders = sqlInPlaceholders(days.length, 2);
  const binds = [websiteId, ...days];
  const dayTables = [
    'rollup_stats_daily',
    'rollup_session_day',
    'rollup_event_daily',
    'rollup_dimension_daily',
  ];
  for (const table of dayTables) {
    await siteDb(env, websiteId).prepare(`DELETE FROM ${table} WHERE website_id = ?1 AND day IN (${dayPlaceholders})`)
      .bind(...binds)
      .run();
  }
  await siteDb(env, websiteId).prepare(
    `DELETE FROM rollup_pageview_series WHERE website_id = ?1 AND unit = 'day' AND bucket IN (${dayPlaceholders})`,
  )
    .bind(...binds)
    .run();
  await siteDb(env, websiteId).prepare(
    `DELETE FROM rollup_series_bucket WHERE website_id = ?1 AND unit = 'day' AND bucket IN (${dayPlaceholders})`,
  )
    .bind(...binds)
    .run();
}

export async function refreshRollupStatsDaily(env: Env, websiteId: string, day: string) {
  await siteDb(env, websiteId).prepare(
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
