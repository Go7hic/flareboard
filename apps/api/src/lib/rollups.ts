import { EVENT_TYPE } from '@flareboard/shared';
import { rollupDailyRangeEligible, rollupHourlySeriesEligible } from '@flareboard/shared';
import type { Env } from '../env';
import { eventStoreMode, siteDb } from './site-db';

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

/** The bucket right after `bucket` ('YYYY-MM-DD', 'YYYY-MM' or 'YYYY'), an exclusive end for ranges. */
function nextBucket(unitKey: string, bucket: string) {
  if (unitKey === 'year') return String(Number(bucket) + 1);
  if (unitKey === 'month') {
    const [year, month] = bucket.split('-').map(Number) as [number, number];
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  return new Date(Date.parse(`${bucket}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Length of a bucket key: a day, month or year is a prefix of the hour and day keys within it. */
const BUCKET_LENGTH: Record<string, number> = { day: 10, month: 7, year: 4 };

/**
 * Pageviews per bucket, oldest first. Stores keep day and hour rows; a month or year is the sum
 * of its hours, whose keys ('YYYY-MM-DD HH:00') start with it.
 */
async function loadPageviewSeries(
  env: Env,
  websiteId: string,
  unitKey: string,
  startBucket: string,
  endBucket: string,
): Promise<{ bucket: string; pageviews: number }[]> {
  const db = siteDb(env, websiteId);
  if (unitKey === 'month' || unitKey === 'year') {
    const rows = await db
      .prepare(
        `SELECT substr(bucket, 1, ${BUCKET_LENGTH[unitKey]}) AS period, SUM(pageviews) AS pageviews
         FROM rollup_pageview_series
         WHERE website_id = ?1 AND unit = 'hour' AND bucket >= ?2 AND bucket < ?3
         GROUP BY period
         ORDER BY period ASC`,
      )
      .bind(websiteId, startBucket, nextBucket(unitKey, endBucket))
      .all<{ period: string; pageviews: number }>();
    return (rows.results ?? []).map((row) => ({ bucket: row.period, pageviews: row.pageviews }));
  }
  const rows = await db
    .prepare(
      `SELECT bucket, pageviews
       FROM rollup_pageview_series
       WHERE website_id = ?1 AND unit = ?2 AND bucket >= ?3 AND bucket <= ?4
       ORDER BY bucket ASC`,
    )
    .bind(websiteId, unitKey, startBucket, endBucket)
    .all<{ bucket: string; pageviews: number }>();
  return rows.results ?? [];
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

  // The per-day counters are sums over rollup_session_day (one row per visit and day).
  const sumSessionDays = async (targetDays: string[]) => {
    const empty = { pageviews: 0, visits: 0, bounces: 0, totaltime_sec: 0, visitors: 0 };
    if (!targetDays.length) return empty;
    return (
      (await siteDb(env, websiteId).prepare(
        `SELECT
           COALESCE(SUM(pageviews), 0) as pageviews,
           COUNT(*) as visits,
           COALESCE(SUM(CASE WHEN pageviews = 1 THEN 1 ELSE 0 END), 0) as bounces,
           COALESCE(SUM((last_at - first_at) / 1000), 0) as totaltime_sec,
           COUNT(DISTINCT session_id) as visitors
         FROM rollup_session_day
         WHERE website_id = ?1 AND day >= ?2 AND day <= ?3`,
      )
        .bind(websiteId, ...dayBounds(targetDays))
        .first<typeof empty>()) ?? empty
    );
  };

  const [currentStats, previousStats] = await Promise.all([sumSessionDays(days), sumSessionDays(prevDays)]);

  return {
    pageviews: statChange(currentStats.pageviews, previousStats.pageviews),
    visitors: statChange(currentStats.visitors, previousStats.visitors),
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

  const rows = await loadPageviewSeries(env, websiteId, unitKey, startBucket, endBucket);
  if (!rows.length) return null;

  if (unitKey === 'hour') {
    const identityRows = await loadSeriesIdentities(env, websiteId, unitKey, startBucket, endBucket);
    if (!hourSeriesBucketsAligned(rows, identityRows)) return null;
  }

  return {
    pageviews: rows.map((r) => ({ x: r.bucket, y: r.pageviews })),
  };
}

/** Columns of rollup_session_dims_daily. */
const SESSION_DIMENSIONS = new Set(['browser', 'os', 'device', 'language', 'country']);

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

  // Website stores count the session dimensions per combination; days counted before that keep
  // their rollup_dimension_daily rows, so both are added.
  const combined = eventStoreMode(env) === 'do' && SESSION_DIMENSIONS.has(dimension);
  const rows = await siteDb(env, websiteId).prepare(
    combined
      ? `SELECT value, SUM(count) as count
         FROM (
           SELECT value, count FROM rollup_dimension_daily
           WHERE website_id = ?1 AND dimension = ?2 AND day >= ?3 AND day <= ?4
           UNION ALL
           SELECT ${dimension} AS value, count FROM rollup_session_dims_daily
           WHERE website_id = ?1 AND day >= ?3 AND day <= ?4
         )
         GROUP BY value
         ORDER BY count DESC
         LIMIT ?5`
      : `SELECT value, SUM(count) as count
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

/**
 * Distinct visitors and visits per bucket, oldest first. Hours come from rollup_series_bucket;
 * days, months and years from rollup_session_day, which holds the same visits per day.
 */
async function loadSeriesIdentities(
  env: Env,
  websiteId: string,
  unitKey: string,
  startBucket: string,
  endBucket: string,
): Promise<{ bucket: string; visitors: number; visits: number }[]> {
  const db = siteDb(env, websiteId);
  if (unitKey === 'hour') {
    const rows = await db.prepare(
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
  const rows = await db.prepare(
    `SELECT substr(day, 1, ${BUCKET_LENGTH[unitKey] ?? 10}) AS period,
            COUNT(DISTINCT session_id) as visitors,
            COUNT(DISTINCT visit_id) as visits
     FROM rollup_session_day
     WHERE website_id = ?1 AND day >= ?2 AND day < ?3
     GROUP BY period
     ORDER BY period ASC`,
  )
    .bind(websiteId, startBucket, nextBucket(unitKey, endBucket))
    .all<{ period: string; visitors: number; visits: number }>();
  return (rows.results ?? []).map(({ period, visitors, visits }) => ({ bucket: period, visitors, visits }));
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

  const pageviewRows = await loadPageviewSeries(env, websiteId, unitKey, startBucket, endBucket);
  if (!pageviewRows.length) return null;

  let visitors: { x: string; y: number }[];
  if (unitKey === 'day') {
    visitors = await loadDailyVisitorsFromSessionDay(env, websiteId, days);
  } else {
    const identityRows = await loadSeriesIdentities(env, websiteId, unitKey, startBucket, endBucket);
    if (unitKey === 'hour' && !hourSeriesBucketsAligned(pageviewRows, identityRows)) return null;
    if (!identityRows.length) return null;
    visitors = identityRows.map((r) => ({ x: r.bucket, y: r.visitors }));
  }

  return {
    pageviews: pageviewRows.map((r) => ({ x: r.bucket, y: r.pageviews })),
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
      const totals = await siteDb(env, websiteId)
        .prepare(
          `SELECT COALESCE(SUM(pageviews), 0) as pageviews, COUNT(*) as visits, COUNT(DISTINCT session_id) as visitors
           FROM rollup_session_day
           WHERE website_id = ?1 AND day >= ?2 AND day <= ?3`,
        )
        .bind(websiteId, ...dayBounds(days))
        .first<{ pageviews: number; visits: number; visitors: number }>();
      return {
        websiteId,
        pageviews: totals?.pageviews ?? 0,
        visitors: totals?.visitors ?? 0,
        visits: totals?.visits ?? 0,
      };
    }),
  );
  // Every site has a rollup row for every day here (checked above), so each one has a result.
  return perSite;
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
      const [pageviews, identities] = await Promise.all([
        loadPageviewSeries(env, websiteId, unitKey, startBucket, endBucket),
        loadSeriesIdentities(env, websiteId, unitKey, startBucket, endBucket),
      ]);
      return { pageviews, identities };
    }),
  );
  for (const site of perSite) {
    for (const row of site.pageviews) {
      pageviewByBucket.set(row.bucket, (pageviewByBucket.get(row.bucket) ?? 0) + row.pageviews);
    }
    for (const row of site.identities) {
      const cur = identityByBucket.get(row.bucket) ?? { visitors: 0, visits: 0 };
      identityByBucket.set(row.bucket, { visitors: cur.visitors + row.visitors, visits: cur.visits + row.visits });
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

/**
 * Drops the day-level rollups of `days` after an import added raw rows to them: ranges that
 * include those days are then read from the raw rows.
 */
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
    ...(eventStoreMode(env) === 'do' ? ['rollup_session_dims_daily'] : []),
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
}

export { dayKey, hourBucket, monthBucket, yearBucket };
