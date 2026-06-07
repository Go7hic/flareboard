import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
import type { PageMetricRow } from './queries';
import { buildSegmentSql, type SegmentParams } from './segment-filters';

function statChange(current: number, previous: number) {
  const change =
    previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
  return { value: current, change };
}

function baseEventSql(
  websiteId: string,
  startAt: number,
  endAt: number,
  segment: SegmentParams | null | undefined,
  extraEventType?: number,
) {
  const seg = buildSegmentSql(segment);
  const joins = seg.joinSession ? ' INNER JOIN session s ON e.session_id = s.session_id' : '';
  const clauses = [
    'e.website_id = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [websiteId, startAt, endAt, ...seg.binds];
  if (extraEventType !== undefined) {
    clauses.push('e.event_type = ?');
    binds.push(extraEventType);
  }
  return { joins, where: clauses.join(' AND '), binds };
}

async function countFiltered(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment: SegmentParams | null | undefined,
  mode: 'pageviews' | 'visitors' | 'visits',
) {
  const eventType = mode === 'pageviews' ? EVENT_TYPE.pageView : undefined;
  const { joins, where, binds } = baseEventSql(websiteId, startAt, endAt, segment, eventType);
  const col =
    mode === 'visitors'
      ? 'COUNT(DISTINCT e.session_id)'
      : mode === 'visits'
        ? 'COUNT(DISTINCT e.visit_id)'
        : 'COUNT(*)';
  const row = await env.DB.prepare(`SELECT ${col} as count FROM website_event e${joins} WHERE ${where}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function sumTotalTimeFiltered(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment: SegmentParams | null | undefined,
) {
  const seg = buildSegmentSql(segment);
  const joins = seg.joinSession ? ' INNER JOIN session s ON e.session_id = s.session_id' : '';
  const clauses = [
    'e.website_id = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [websiteId, startAt, endAt, ...seg.binds];

  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(duration_ms), 0) as total FROM (
      SELECT (MAX(e.created_at) - MIN(e.created_at)) as duration_ms
      FROM website_event e${joins}
      WHERE ${clauses.join(' AND ')}
      GROUP BY e.session_id
    )`,
  )
    .bind(...binds)
    .first<{ total: number }>();
  return Math.round((row?.total ?? 0) / 1000);
}

async function countBouncesFiltered(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment: SegmentParams | null | undefined,
) {
  const seg = buildSegmentSql(segment);
  const sessionJoin = seg.joinSession ? ' INNER JOIN session s ON e.session_id = s.session_id' : '';
  const extra = [...seg.eventClauses, ...seg.sessionClauses];
  const extraSql = extra.length ? ` AND ${extra.join(' AND ')}` : '';
  const binds = [websiteId, EVENT_TYPE.pageView, startAt, endAt, ...seg.binds];

  const row = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM (
      SELECT e.session_id FROM website_event e${sessionJoin}
      WHERE e.website_id = ?1 AND e.event_type = ?2
        AND e.created_at >= ?3 AND e.created_at <= ?4${extraSql}
      GROUP BY e.session_id HAVING COUNT(*) = 1
    )`,
  )
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getWebsiteStatsFiltered(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment?: SegmentParams | null,
) {
  const period = endAt - startAt;
  const prevStart = startAt - period;
  const prevEnd = startAt;

  const [
    pageviews,
    visitors,
    visits,
    bounces,
    totaltime,
    prevPageviews,
    prevVisitors,
    prevVisits,
    prevBounces,
    prevTotaltime,
  ] = await Promise.all([
    countFiltered(env, websiteId, startAt, endAt, segment, 'pageviews'),
    countFiltered(env, websiteId, startAt, endAt, segment, 'visitors'),
    countFiltered(env, websiteId, startAt, endAt, segment, 'visits'),
    countBouncesFiltered(env, websiteId, startAt, endAt, segment),
    sumTotalTimeFiltered(env, websiteId, startAt, endAt, segment),
    countFiltered(env, websiteId, prevStart, prevEnd, segment, 'pageviews'),
    countFiltered(env, websiteId, prevStart, prevEnd, segment, 'visitors'),
    countFiltered(env, websiteId, prevStart, prevEnd, segment, 'visits'),
    countBouncesFiltered(env, websiteId, prevStart, prevEnd, segment),
    sumTotalTimeFiltered(env, websiteId, prevStart, prevEnd, segment),
  ]);

  return {
    pageviews: statChange(pageviews, prevPageviews),
    visitors: statChange(visitors, prevVisitors),
    visits: statChange(visits, prevVisits),
    bounces: statChange(bounces, prevBounces),
    totaltime: statChange(totaltime, prevTotaltime),
  };
}

export async function getPageviewsFiltered(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  unit: string,
  segment?: SegmentParams | null,
) {
  const seg = buildSegmentSql(segment);
  const joins = seg.joinSession ? ' INNER JOIN session s ON e.session_id = s.session_id' : '';
  const format =
    unit === 'hour'
      ? "%Y-%m-%d %H:00"
      : unit === 'month'
        ? '%Y-%m'
        : unit === 'year'
          ? '%Y'
          : '%Y-%m-%d';
  const clauses = [
    'e.website_id = ?',
    'e.event_type = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [
    websiteId,
    EVENT_TYPE.pageView,
    startAt,
    endAt,
    ...seg.binds,
  ];

  const rows = await env.DB.prepare(
    `SELECT strftime('${format}', datetime(e.created_at / 1000, 'unixepoch')) as x,
            COUNT(*) as y
     FROM website_event e${joins}
     WHERE ${clauses.join(' AND ')}
     GROUP BY x ORDER BY x`,
  )
    .bind(...binds)
    .all<{ x: string; y: number }>();

  return { pageviews: (rows.results ?? []).map((r) => ({ x: r.x, y: r.y })) };
}

export async function getMetricsFiltered(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  type: string,
  limit: number,
  segment?: SegmentParams | null,
) {
  const seg = buildSegmentSql(segment);
  const joins = ' INNER JOIN session s ON e.session_id = s.session_id';
  const clauses = [
    'e.website_id = ?',
    'e.event_type = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [
    websiteId,
    EVENT_TYPE.pageView,
    startAt,
    endAt,
    ...seg.binds,
  ];

  const col =
    type === 'url' || type === 'path'
      ? 'e.url_path'
      : type === 'referrer'
        ? 'e.referrer_domain'
        : type === 'language'
          ? 's.language'
          : type === 'browser'
            ? 's.browser'
            : type === 'os'
              ? 's.os'
              : type === 'device'
                ? 's.device'
                : type === 'country'
                  ? 's.country'
                  : type === 'region'
                    ? 's.region'
                    : type === 'city'
                      ? 's.city'
                      : 'e.url_path';

  const rows = await env.DB.prepare(
    `SELECT COALESCE(${col}, 'Unknown') as x, COUNT(*) as y
     FROM website_event e${joins}
     WHERE ${clauses.join(' AND ')}
     GROUP BY x ORDER BY y DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<{ x: string; y: number }>();

  return (rows.results ?? []).map((r) => ({
    x: type === 'referrer' && !r.x ? 'Direct' : r.x,
    y: r.y,
  }));
}

export async function getPageMetricsFiltered(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  sortBy: 'views' | 'visitors' | 'time' = 'views',
  limit = 10,
  segment?: SegmentParams | null,
): Promise<PageMetricRow[]> {
  const seg = buildSegmentSql(segment);
  const joins = ' INNER JOIN session s ON e.session_id = s.session_id';
  const clauses = [
    'e.website_id = ?',
    'e.event_type = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [
    websiteId,
    EVENT_TYPE.pageView,
    startAt,
    endAt,
    ...seg.binds,
  ];
  const orderCol =
    sortBy === 'visitors' ? 'visitors' : sortBy === 'time' ? 'avg_time_sec' : 'views';

  const rows = await env.DB.prepare(
    `WITH page_events AS (
       SELECT e.url_path, e.session_id, e.visit_id, e.created_at,
         LEAD(e.created_at) OVER (PARTITION BY e.visit_id ORDER BY e.created_at) as next_at
       FROM website_event e${joins}
       WHERE ${clauses.join(' AND ')}
     ),
     page_stats AS (
       SELECT url_path,
         COUNT(*) as views,
         COUNT(DISTINCT session_id) as visitors,
         ROUND(AVG(COALESCE(next_at - created_at, 0)) / 1000.0) as avg_time_sec
       FROM page_events
       GROUP BY url_path
     )
     SELECT url_path as path, views, visitors, avg_time_sec
     FROM page_stats
     ORDER BY ${orderCol} DESC
     LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<{ path: string; views: number; visitors: number; avg_time_sec: number }>();

  return (rows.results ?? []).map((r) => ({
    x: r.path ?? '/',
    y: r.views,
    visitors: r.visitors,
    avgTime: r.avg_time_sec ?? 0,
  }));
}
