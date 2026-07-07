import { eq, and, isNull, sql, gte, lte, count, countDistinct, inArray, desc, asc } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { EVENT_TYPE, type UtmReportResponse } from '@flareboard/shared';
import type { Env } from '../env';
import { cachedRead } from './cache';
import { channelCaseSql } from './channel';
import { buildSegmentSql, type SegmentParams } from './segment-filters';

export async function getUserByUsername(env: Env, username: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.username, username), isNull(schema.user.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(env: Env, email: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.email, email.toLowerCase()), isNull(schema.user.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserById(env: Env, userId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.userId, userId), isNull(schema.user.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserWebsites(env: Env, userId: string) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.website)
    .where(and(eq(schema.website.userId, userId), isNull(schema.website.deletedAt)))
    .orderBy(schema.website.createdAt);
}

export async function getAccessibleWebsites(env: Env, userId: string) {
  const db = createDb(env.DB);
  const memberships = await db
    .select({ teamId: schema.teamUser.teamId })
    .from(schema.teamUser)
    .where(eq(schema.teamUser.userId, userId));
  const teamIds = memberships.map((m) => m.teamId);
  const owned = await getUserWebsites(env, userId);
  if (!teamIds.length) return owned;
  const teamSites = await db
    .select()
    .from(schema.website)
    .where(and(inArray(schema.website.teamId, teamIds), isNull(schema.website.deletedAt)));
  const seen = new Set(owned.map((w) => w.websiteId));
  return [...owned, ...teamSites.filter((w) => !seen.has(w.websiteId))];
}

export async function getTeamWebsites(env: Env, teamId: string) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.website)
    .where(and(eq(schema.website.teamId, teamId), isNull(schema.website.deletedAt)))
    .orderBy(schema.website.createdAt);
}

export async function getWebsiteById(env: Env, websiteId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.website)
    .where(and(eq(schema.website.websiteId, websiteId), isNull(schema.website.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** website_event.created_at is integer ms; compare numerically (not Date strings). */
function eventTimeFilter(websiteId: string, startAt: number, endAt: number) {
  return and(
    eq(schema.websiteEvent.websiteId, websiteId),
    sql`${schema.websiteEvent.createdAt} >= ${startAt}`,
    sql`${schema.websiteEvent.createdAt} <= ${endAt}`,
  );
}

function timeBucketExpr(format: string) {
  return sql<string>`strftime(${format}, datetime(${schema.websiteEvent.createdAt} / 1000, 'unixepoch'))`;
}

function statChange(current: number, previous: number) {
  const change =
    previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
  return { value: current, change };
}

async function countPeriodStats(
  env: Env,
  websiteId: string,
  rangeStart: number,
  rangeEnd: number,
) {
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN event_type = ?4 THEN 1 ELSE 0 END) as pageviews,
       COUNT(DISTINCT session_id) as visitors,
       COUNT(DISTINCT visit_id) as visits
     FROM website_event
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3`,
  )
    .bind(websiteId, rangeStart, rangeEnd, EVENT_TYPE.pageView)
    .first<{ pageviews: number; visitors: number; visits: number }>();

  const bounceRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM (
      SELECT visit_id FROM website_event
      WHERE website_id = ?1 AND event_type = ?2
        AND created_at >= ?3 AND created_at <= ?4
      GROUP BY visit_id HAVING COUNT(*) = 1
    )`,
  )
    .bind(websiteId, EVENT_TYPE.pageView, rangeStart, rangeEnd)
    .first<{ count: number }>();

  const timeRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(duration_ms), 0) as total FROM (
      SELECT (MAX(created_at) - MIN(created_at)) as duration_ms
      FROM website_event
      WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
      GROUP BY visit_id
    )`,
  )
    .bind(websiteId, rangeStart, rangeEnd)
    .first<{ total: number }>();

  return {
    pageviews: row?.pageviews ?? 0,
    visitors: row?.visitors ?? 0,
    visits: row?.visits ?? 0,
    bounces: bounceRow?.count ?? 0,
    totaltime: Math.round((timeRow?.total ?? 0) / 1000),
  };
}

export async function getWebsiteStats(env: Env, websiteId: string, startAt: number, endAt: number) {
  const { getWebsiteStatsFromRollups } = await import('./rollups');
  const rollupStats = await getWebsiteStatsFromRollups(env, websiteId, startAt, endAt);
  if (rollupStats) return rollupStats;

  const period = endAt - startAt;
  const prevStart = startAt - period;
  const prevEnd = startAt;

  const [current, previous] = await Promise.all([
    countPeriodStats(env, websiteId, startAt, endAt),
    countPeriodStats(env, websiteId, prevStart, prevEnd),
  ]);

  return {
    pageviews: statChange(current.pageviews, previous.pageviews),
    visitors: statChange(current.visitors, previous.visitors),
    visits: statChange(current.visits, previous.visits),
    bounces: statChange(current.bounces, previous.bounces),
    totaltime: statChange(current.totaltime, previous.totaltime),
  };
}

export async function getPageviews(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  unit: string,
) {
  const { getPageviewsFromRollups } = await import('./rollups');
  const rollupSeries = await getPageviewsFromRollups(env, websiteId, startAt, endAt, unit);
  if (rollupSeries) return rollupSeries;

  const db = createDb(env.DB);
  const format =
    unit === 'hour'
      ? "%Y-%m-%d %H:00"
      : unit === 'month'
        ? '%Y-%m'
        : unit === 'year'
          ? '%Y'
          : '%Y-%m-%d';
  const bucket = timeBucketExpr(format);
  const rows = await db
    .select({
      x: bucket,
      y: count(),
    })
    .from(schema.websiteEvent)
    .where(
      and(
        eq(schema.websiteEvent.websiteId, websiteId),
        eq(schema.websiteEvent.eventType, EVENT_TYPE.pageView),
        sql`${schema.websiteEvent.createdAt} >= ${startAt}`,
        sql`${schema.websiteEvent.createdAt} <= ${endAt}`,
      ),
    )
    .groupBy(bucket)
    .orderBy(asc(bucket));
  return { pageviews: rows.map((r) => ({ x: r.x, y: r.y })) };
}

export type WebsiteMetricsSeries = {
  pageviews: { x: string; y: number }[];
  visitors: { x: string; y: number }[];
};

export async function getWebsiteMetricsSeries(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  unit: string,
): Promise<WebsiteMetricsSeries> {
  const { getWebsiteMetricsSeriesFromRollups } = await import('./rollups');
  const rollupSeries = await getWebsiteMetricsSeriesFromRollups(env, websiteId, startAt, endAt, unit);
  if (rollupSeries) return rollupSeries;

  const format =
    unit === 'hour'
      ? "%Y-%m-%d %H:00"
      : unit === 'month'
        ? '%Y-%m'
        : unit === 'year'
          ? '%Y'
          : '%Y-%m-%d';
  const { results } = await env.DB.prepare(
    `SELECT strftime('${format}', datetime(created_at / 1000, 'unixepoch')) as x,
            SUM(CASE WHEN event_type = ?4 THEN 1 ELSE 0 END) as pageviews,
            COUNT(DISTINCT session_id) as visitors
     FROM website_event
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
     GROUP BY x
     ORDER BY x`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.pageView)
    .all<{ x: string; pageviews: number; visitors: number }>();

  const rows = results ?? [];
  return {
    pageviews: rows.map((r) => ({ x: r.x, y: r.pageviews })),
    visitors: rows.map((r) => ({ x: r.x, y: r.visitors })),
  };
}

export type DashboardSiteMetric = {
  websiteId: string;
  pageviews: number;
  visitors: number;
  visits: number;
};

function sqlInPlaceholders(count: number, startIndex = 1) {
  return Array.from({ length: count }, (_, i) => `?${startIndex + i}`).join(', ');
}

/** Per-site totals for dashboard ranking — one query for all sites. */
export async function getDashboardMetricsByWebsite(
  env: Env,
  websiteIds: string[],
  startAt: number,
  endAt: number,
): Promise<DashboardSiteMetric[]> {
  if (!websiteIds.length) return [];

  const { getDashboardMetricsFromRollups } = await import('./rollups');
  const rollupMetrics = await getDashboardMetricsFromRollups(env, websiteIds, startAt, endAt);
  if (rollupMetrics) return rollupMetrics;

  const inClause = sqlInPlaceholders(websiteIds.length, 4);
  const { results } = await env.DB.prepare(
    `SELECT website_id as websiteId,
            SUM(CASE WHEN event_type = ?1 THEN 1 ELSE 0 END) as pageviews,
            COUNT(DISTINCT session_id) as visitors,
            COUNT(DISTINCT visit_id) as visits
     FROM website_event
     WHERE website_id IN (${inClause})
       AND created_at >= ?2 AND created_at <= ?3
     GROUP BY website_id
     ORDER BY pageviews DESC`,
  )
    .bind(EVENT_TYPE.pageView, startAt, endAt, ...websiteIds)
    .all<DashboardSiteMetric>();

  return results ?? [];
}

export type AggregateMetricsSeries = {
  pageviews: { x: string; y: number }[];
  visitors: { x: string; y: number }[];
  visits: { x: string; y: number }[];
};

/** Combined pageview / visitor / visit series across many sites — one query. */
export async function getAggregateMetricsForWebsites(
  env: Env,
  websiteIds: string[],
  startAt: number,
  endAt: number,
  unit: string,
): Promise<AggregateMetricsSeries> {
  const empty = { pageviews: [], visitors: [], visits: [] };
  if (!websiteIds.length) return empty;

  const { getAggregateMetricsFromRollups } = await import('./rollups');
  const rollupSeries = await getAggregateMetricsFromRollups(env, websiteIds, startAt, endAt, unit);
  if (rollupSeries) return rollupSeries;

  const format =
    unit === 'hour' ? '%Y-%m-%d %H:00' : unit === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const inClause = sqlInPlaceholders(websiteIds.length, 4);
  const { results } = await env.DB.prepare(
    `SELECT strftime('${format}', datetime(created_at / 1000, 'unixepoch')) as x,
            SUM(CASE WHEN event_type = ?1 THEN 1 ELSE 0 END) as pageviews,
            COUNT(DISTINCT session_id) as visitors,
            COUNT(DISTINCT visit_id) as visits
     FROM website_event
     WHERE website_id IN (${inClause})
       AND created_at >= ?2 AND created_at <= ?3
     GROUP BY x
     ORDER BY x`,
  )
    .bind(EVENT_TYPE.pageView, startAt, endAt, ...websiteIds)
    .all<{ x: string; pageviews: number; visitors: number; visits: number }>();

  const rows = results ?? [];
  return {
    pageviews: rows.map((r) => ({ x: r.x, y: r.pageviews })),
    visitors: rows.map((r) => ({ x: r.x, y: r.visitors })),
    visits: rows.map((r) => ({ x: r.x, y: r.visits })),
  };
}

export type TrafficHeatmapCell = { dow: number; hour: number; count: number };
export type TrafficHeatmapData = { cells: TrafficHeatmapCell[]; max: number };

async function getVisitUrlMetrics(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  mode: 'entry' | 'exit',
  limit: number,
) {
  const order = mode === 'entry' ? 'ASC' : 'DESC';
  const rows = await env.DB.prepare(
    `WITH ranked AS (
       SELECT e.url_path,
         ROW_NUMBER() OVER (PARTITION BY e.visit_id ORDER BY e.created_at ${order}) as rn
       FROM website_event e
       WHERE e.website_id = ?1 AND e.event_type = ?2
         AND e.created_at >= ?3 AND e.created_at <= ?4
     )
     SELECT COALESCE(url_path, '/') as x, COUNT(*) as y
     FROM ranked
     WHERE rn = 1
     GROUP BY x
     ORDER BY y DESC
     LIMIT ?5`,
  )
    .bind(websiteId, EVENT_TYPE.pageView, startAt, endAt, limit)
    .all<{ x: string; y: number }>();

  return (rows.results ?? []).map((r) => ({ x: r.x || '/', y: r.y }));
}

async function getChannelMetrics(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  limit: number,
) {
  const channelExpr = channelCaseSql('e');
  const rows = await env.DB.prepare(
    `SELECT ${channelExpr} as x, COUNT(*) as y
     FROM website_event e
     WHERE e.website_id = ?1 AND e.event_type = ?2
       AND e.created_at >= ?3 AND e.created_at <= ?4
     GROUP BY x
     ORDER BY y DESC
     LIMIT ?5`,
  )
    .bind(websiteId, EVENT_TYPE.pageView, startAt, endAt, limit)
    .all<{ x: string; y: number }>();

  return rows.results ?? [];
}

export async function getTrafficHeatmap(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
): Promise<TrafficHeatmapData> {
  const rows = await env.DB.prepare(
    `SELECT CAST(strftime('%w', datetime(created_at / 1000, 'unixepoch')) AS INTEGER) as dow,
            CAST(strftime('%H', datetime(created_at / 1000, 'unixepoch')) AS INTEGER) as hour,
            COUNT(*) as count
     FROM website_event
     WHERE website_id = ?1 AND event_type = ?2
       AND created_at >= ?3 AND created_at <= ?4
     GROUP BY dow, hour`,
  )
    .bind(websiteId, EVENT_TYPE.pageView, startAt, endAt)
    .all<{ dow: number; hour: number; count: number }>();

  const cells = rows.results ?? [];
  const max = cells.reduce((m, c) => Math.max(m, c.count), 0);
  return { cells, max };
}

export async function getMetrics(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  type: string,
  limit = 10,
) {
  if (type === 'entry' || type === 'exit') {
    return getVisitUrlMetrics(env, websiteId, startAt, endAt, type, limit);
  }
  if (type === 'channel') {
    return getChannelMetrics(env, websiteId, startAt, endAt, limit);
  }

  const { getMetricsFromRollups } = await import('./rollups');
  const rollupMetrics = await getMetricsFromRollups(env, websiteId, startAt, endAt, type, limit);
  if (rollupMetrics) return rollupMetrics;

  const db = createDb(env.DB);
  const timeFilter = eventTimeFilter(websiteId, startAt, endAt);

  if (type === 'url' || type === 'path') {
    const rows = await db
      .select({ x: schema.websiteEvent.urlPath, y: count() })
      .from(schema.websiteEvent)
      .where(and(timeFilter, eq(schema.websiteEvent.eventType, EVENT_TYPE.pageView)))
      .groupBy(schema.websiteEvent.urlPath)
      .orderBy(desc(count()))
      .limit(limit);
    return rows.map((r) => ({ x: r.x ?? 'Unknown', y: r.y }));
  }

  if (type === 'referrer') {
    const rows = await db
      .select({ x: schema.websiteEvent.referrerDomain, y: count() })
      .from(schema.websiteEvent)
      .where(and(timeFilter, eq(schema.websiteEvent.eventType, EVENT_TYPE.pageView)))
      .groupBy(schema.websiteEvent.referrerDomain)
      .orderBy(desc(count()))
      .limit(limit);
    return rows.map((r) => ({ x: r.x || 'Direct', y: r.y }));
  }

  if (type === 'language') {
    const rows = await db
      .select({ x: schema.session.language, y: count() })
      .from(schema.websiteEvent)
      .innerJoin(schema.session, eq(schema.websiteEvent.sessionId, schema.session.sessionId))
      .where(and(timeFilter, eq(schema.websiteEvent.eventType, EVENT_TYPE.pageView)))
      .groupBy(schema.session.language)
      .orderBy(desc(count()))
      .limit(limit);
    return rows.map((r) => ({ x: r.x ?? 'Unknown', y: r.y }));
  }

  const column =
    type === 'browser'
      ? schema.session.browser
      : type === 'os'
        ? schema.session.os
        : type === 'device'
          ? schema.session.device
          : type === 'country'
            ? schema.session.country
            : type === 'region'
              ? schema.session.region
              : type === 'city'
                ? schema.session.city
                : schema.session.browser;

  const rows = await db
    .select({ x: column, y: count() })
    .from(schema.websiteEvent)
    .innerJoin(schema.session, eq(schema.websiteEvent.sessionId, schema.session.sessionId))
    .where(and(timeFilter, eq(schema.websiteEvent.eventType, EVENT_TYPE.pageView)))
    .groupBy(column)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => ({ x: r.x ?? 'Unknown', y: r.y }));
}

export async function getCustomEvents(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
) {
  const { getCustomEventsFromRollups } = await import('./rollups');
  const rollupEvents = await getCustomEventsFromRollups(env, websiteId, startAt, endAt);
  if (rollupEvents) return rollupEvents;

  const db = createDb(env.DB);
  const rows = await db
    .select({
      x: schema.websiteEvent.eventName,
      y: count(),
    })
    .from(schema.websiteEvent)
    .where(
      and(
        eventTimeFilter(websiteId, startAt, endAt),
        eq(schema.websiteEvent.eventType, EVENT_TYPE.customEvent),
      ),
    )
    .groupBy(schema.websiteEvent.eventName)
    .orderBy(desc(count()));
  return rows.map((r) => ({ x: r.x ?? 'Unknown', y: r.y }));
}

export async function getEventSeries(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  eventName: string,
  unit: string,
) {
  const db = createDb(env.DB);
  const format = unit === 'hour' ? "%Y-%m-%d %H:00" : '%Y-%m-%d';
  const bucket = timeBucketExpr(format);
  const rows = await db
    .select({
      x: bucket,
      y: count(),
    })
    .from(schema.websiteEvent)
    .where(
      and(
        eventTimeFilter(websiteId, startAt, endAt),
        eq(schema.websiteEvent.eventType, EVENT_TYPE.customEvent),
        eq(schema.websiteEvent.eventName, eventName),
      ),
    )
    .groupBy(bucket)
    .orderBy(asc(bucket));
  return rows.map((r) => ({ x: r.x, y: r.y }));
}

export async function getEventStats(env: Env, websiteId: string, startAt: number, endAt: number) {
  const db = createDb(env.DB);
  const filter = and(
    eventTimeFilter(websiteId, startAt, endAt),
    eq(schema.websiteEvent.eventType, EVENT_TYPE.customEvent),
  );
  const [totals] = await db.select({ count: count() }).from(schema.websiteEvent).where(filter);
  const [visitors] = await db
    .select({ count: countDistinct(schema.websiteEvent.sessionId) })
    .from(schema.websiteEvent)
    .where(filter);
  return {
    events: { value: totals?.count ?? 0 },
    visitors: { value: visitors?.count ?? 0 },
  };
}

export async function getUserTeams(env: Env, userId: string) {
  const db = createDb(env.DB);
  return db
    .select({
      id: schema.team.teamId,
      name: schema.team.name,
      accessCode: schema.team.accessCode,
      role: schema.teamUser.role,
      createdAt: schema.team.createdAt,
    })
    .from(schema.teamUser)
    .innerJoin(schema.team, eq(schema.teamUser.teamId, schema.team.teamId))
    .where(and(eq(schema.teamUser.userId, userId), isNull(schema.team.deletedAt)));
}

export async function getTeamById(env: Env, teamId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.team)
    .where(and(eq(schema.team.teamId, teamId), isNull(schema.team.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTeamByAccessCode(env: Env, accessCode: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.team)
    .where(and(eq(schema.team.accessCode, accessCode), isNull(schema.team.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserShares(env: Env, userId: string) {
  const db = createDb(env.DB);
  const websites = await getAccessibleWebsites(env, userId);
  const websiteIds = websites.map((w) => w.websiteId);
  const boards = await db.select().from(schema.board).where(eq(schema.board.userId, userId));
  const boardIds = boards.map((b) => b.boardId);
  const entityIds = [...websiteIds, ...boardIds];
  if (!entityIds.length) return [];
  return db.select().from(schema.share).where(inArray(schema.share.entityId, entityIds));
}

export async function getShareBySlug(env: Env, slug: string) {
  const db = createDb(env.DB);
  const rows = await db.select().from(schema.share).where(eq(schema.share.slug, slug)).limit(1);
  return rows[0] ?? null;
}

const REALTIME_WINDOW_MS = 5 * 60 * 1000;
const REALTIME_SESSION_LIMIT = 50;
const REALTIME_KV_PREFIX = (websiteId: string) => `rt:${websiteId}:s:`;

type RealtimeKvMeta = {
  urlPath?: string;
  referrerDomain?: string | null;
  country?: string | null;
  updatedAt?: number;
};

type RealtimeSessionRow = {
  sessionId: string;
  urlPath: string;
  referrerDomain: string | null;
  country: string | null;
  createdAt: number;
};

async function getRealtimeFromKv(
  env: Env,
  websiteId: string,
  since: number,
): Promise<{ visitors: number; sessions: RealtimeSessionRow[] } | null> {
  const listed = await env.CACHE.list({
    prefix: REALTIME_KV_PREFIX(websiteId),
    limit: REALTIME_SESSION_LIMIT,
  });
  if (!listed.keys.length) return null;

  const prefix = REALTIME_KV_PREFIX(websiteId);
  const rows = await Promise.all(
    listed.keys.map(async (key) => {
      const raw = await env.CACHE.get(key.name);
      if (!raw) return null;
      try {
        const meta = JSON.parse(raw) as RealtimeKvMeta;
        const updatedAt = meta.updatedAt ?? 0;
        if (updatedAt < since) return null;
        return {
          sessionId: key.name.slice(prefix.length),
          urlPath: meta.urlPath ?? '',
          referrerDomain: meta.referrerDomain ?? null,
          country: meta.country ?? null,
          createdAt: updatedAt,
        } satisfies RealtimeSessionRow;
      } catch {
        return null;
      }
    }),
  );
  const sessions = rows.filter((r): r is RealtimeSessionRow => r !== null);

  if (!sessions.length) return null;

  sessions.sort((a, b) => b.createdAt - a.createdAt);

  let visitors = sessions.length;
  const kvCount = await env.CACHE.get(`rt:${websiteId}:visitors`);
  if (kvCount !== null) {
    const kvN = parseInt(kvCount, 10) || 0;
    if (kvN > visitors) visitors = kvN;
  }

  return { visitors, sessions: sessions.slice(0, REALTIME_SESSION_LIMIT) };
}

export async function getRealtime(env: Env, websiteId: string) {
  const since = Date.now() - REALTIME_WINDOW_MS;
  const endAt = Date.now();
  const start30 = endAt - 30 * 60 * 1000;

  const [kv, window30] = await Promise.all([
    getRealtimeFromKv(env, websiteId, since),
    cachedRead(env, `realtime-30m:${websiteId}`, 30, async () => {
      const row = await env.DB.prepare(
        `SELECT
           SUM(CASE WHEN event_type = ?4 THEN 1 ELSE 0 END) as pageviews,
           COUNT(DISTINCT session_id) as visitors,
           COUNT(DISTINCT visit_id) as visits
         FROM website_event
         WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3`,
      )
        .bind(websiteId, start30, endAt, EVENT_TYPE.pageView)
        .first<{ pageviews: number; visitors: number; visits: number }>();
      return {
        visitors: row?.visitors ?? 0,
        pageviews: row?.pageviews ?? 0,
        visits: row?.visits ?? 0,
      };
    }),
  ]);

  if (kv) {
    return {
      visitors: kv.visitors,
      sessions: kv.sessions,
      pageviews: [],
      window30,
    };
  }

  return { visitors: 0, sessions: [], pageviews: [], window30 };
}

export async function getLinkStats(
  env: Env,
  linkId: string,
  startAt: number,
  endAt: number,
) {
  const clicksRow = await env.DB.prepare(
    `SELECT COUNT(*) as clicks FROM website_event
     WHERE website_id = ?1 AND event_type = ?2
       AND created_at >= ?3 AND created_at <= ?4`,
  )
    .bind(linkId, EVENT_TYPE.linkEvent, startAt, endAt)
    .first<{ clicks: number }>();

  const visitorsRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT session_id) as visitors FROM website_event
     WHERE website_id = ?1 AND event_type = ?2
       AND created_at >= ?3 AND created_at <= ?4`,
  )
    .bind(linkId, EVENT_TYPE.linkEvent, startAt, endAt)
    .first<{ visitors: number }>();

  const series = await env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch')) as x,
            COUNT(*) as y
     FROM website_event
     WHERE website_id = ?1 AND event_type = ?2
       AND created_at >= ?3 AND created_at <= ?4
     GROUP BY x
     ORDER BY x`,
  )
    .bind(linkId, EVENT_TYPE.linkEvent, startAt, endAt)
    .all<{ x: string; y: number }>();

  return {
    clicks: clicksRow?.clicks ?? 0,
    visitors: visitorsRow?.visitors ?? 0,
    series: series.results ?? [],
  };
}

export async function getWebsiteSegments(env: Env, websiteId: string) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.segment)
    .where(eq(schema.segment.websiteId, websiteId))
    .orderBy(schema.segment.createdAt);
}

export async function getSegmentById(env: Env, segmentId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.segment)
    .where(eq(schema.segment.segmentId, segmentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRevenueSessions(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
) {
  const rows = await env.DB.prepare(
    `SELECT r.session_id as sessionId, r.event_name as eventName, r.currency,
            SUM(r.revenue) as revenue, COUNT(*) as transactions, MAX(r.created_at) as lastAt
     FROM revenue r
     WHERE r.website_id = ?1 AND r.created_at >= ?2 AND r.created_at <= ?3
     GROUP BY r.session_id, r.currency
     ORDER BY revenue DESC LIMIT 100`,
  )
    .bind(websiteId, startAt, endAt)
    .all<{
      sessionId: string;
      eventName: string;
      currency: string;
      revenue: number;
      transactions: number;
      lastAt: number;
    }>();

  const summary = await env.DB.prepare(
    `SELECT currency, SUM(revenue) as total, COUNT(*) as transactions
     FROM revenue
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
     GROUP BY currency`,
  )
    .bind(websiteId, startAt, endAt)
    .all<{ currency: string; total: number; transactions: number }>();

  return {
    summary: summary.results ?? [],
    sessions: rows.results ?? [],
  };
}

export async function getUserLinks(env: Env, userId: string) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.link)
    .where(and(eq(schema.link.userId, userId), isNull(schema.link.deletedAt)))
    .orderBy(schema.link.createdAt);
}

export async function getAccessibleLinks(env: Env, userId: string) {
  const owned = await getUserLinks(env, userId);
  const memberships = await dbTeamIds(env, userId);
  if (!memberships.length) return owned;
  const db = createDb(env.DB);
  const teamLinks = await db
    .select()
    .from(schema.link)
    .where(and(inArray(schema.link.teamId, memberships), isNull(schema.link.deletedAt)));
  const seen = new Set(owned.map((l) => l.linkId));
  return [...owned, ...teamLinks.filter((l) => !seen.has(l.linkId))];
}

async function dbTeamIds(env: Env, userId: string) {
  const db = createDb(env.DB);
  const memberships = await db
    .select({ teamId: schema.teamUser.teamId })
    .from(schema.teamUser)
    .where(eq(schema.teamUser.userId, userId));
  return memberships.map((m) => m.teamId);
}

export async function getLinkById(env: Env, linkId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.link)
    .where(and(eq(schema.link.linkId, linkId), isNull(schema.link.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLinkBySlug(env: Env, slug: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.link)
    .where(and(eq(schema.link.slug, slug), isNull(schema.link.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserPixels(env: Env, userId: string) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.pixel)
    .where(and(eq(schema.pixel.userId, userId), isNull(schema.pixel.deletedAt)))
    .orderBy(schema.pixel.createdAt);
}

export async function getAccessiblePixels(env: Env, userId: string) {
  const owned = await getUserPixels(env, userId);
  const memberships = await dbTeamIds(env, userId);
  if (!memberships.length) return owned;
  const db = createDb(env.DB);
  const teamPixels = await db
    .select()
    .from(schema.pixel)
    .where(and(inArray(schema.pixel.teamId, memberships), isNull(schema.pixel.deletedAt)));
  const seen = new Set(owned.map((p) => p.pixelId));
  return [...owned, ...teamPixels.filter((p) => !seen.has(p.pixelId))];
}

export async function getPixelById(env: Env, pixelId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.pixel)
    .where(and(eq(schema.pixel.pixelId, pixelId), isNull(schema.pixel.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPixelBySlug(env: Env, slug: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.pixel)
    .where(and(eq(schema.pixel.slug, slug), isNull(schema.pixel.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserReports(env: Env, userId: string) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.report)
    .where(eq(schema.report.userId, userId))
    .orderBy(schema.report.createdAt);
}

export async function getReportById(env: Env, reportId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.report)
    .where(eq(schema.report.reportId, reportId))
    .limit(1);
  return rows[0] ?? null;
}

const UTM_DIMENSIONS = [
  { key: 'campaign' as const, column: 'utm_campaign', empty: '(none)' },
  { key: 'content' as const, column: 'utm_content', empty: '(none)' },
  { key: 'medium' as const, column: 'utm_medium', empty: '(direct)' },
  { key: 'source' as const, column: 'utm_source', empty: '(direct)' },
  { key: 'term' as const, column: 'utm_term', empty: '(none)' },
];

async function utmDimensionBreakdown(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  column: string,
  emptyLabel: string,
  segment?: SegmentParams | null,
) {
  const seg = buildSegmentSql(segment ?? null);
  const joins = seg.joinSession ? ' INNER JOIN session s ON e.session_id = s.session_id' : '';
  const clauses = [
    'e.website_id = ?',
    'e.created_at >= ?',
    'e.created_at <= ?',
    'e.event_type = ?',
    ...seg.eventClauses,
    ...seg.sessionClauses,
  ];
  const binds: (string | number)[] = [websiteId, startAt, endAt, EVENT_TYPE.pageView, ...seg.binds];
  const sql = `SELECT COALESCE(NULLIF(e.${column}, ''), ?) AS name,
                      COUNT(*) AS pageviews
               FROM website_event e${joins}
               WHERE ${clauses.join(' AND ')}
               GROUP BY name
               ORDER BY pageviews DESC
               LIMIT 50`;
  const rows = await env.DB.prepare(sql)
    .bind(emptyLabel, ...binds)
    .all<{ name: string; pageviews: number }>();
  return rows.results ?? [];
}

export async function getUtmReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  segment?: SegmentParams | null,
): Promise<Omit<UtmReportResponse, 'segmentId' | 'startAt' | 'endAt'>> {
  const breakdowns = await Promise.all(
    UTM_DIMENSIONS.map(({ column, empty }) =>
      utmDimensionBreakdown(env, websiteId, startAt, endAt, column, empty, segment),
    ),
  );
  return {
    campaign: breakdowns[0] ?? [],
    content: breakdowns[1] ?? [],
    medium: breakdowns[2] ?? [],
    source: breakdowns[3] ?? [],
    term: breakdowns[4] ?? [],
  };
}

export async function getGoalReport(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  eventName?: string,
) {
  const website = await getWebsiteById(env, websiteId);
  const goalConfig = (website?.goalConfig ?? { goals: [] }) as {
    goals?: Array<{ event: string; target: number; period: string }>;
  };
  const goals = goalConfig.goals ?? [];

  function goalPeriodWindow(period: string): { startAt: number; endAt: number; label: string } {
    const now = Date.now();
    const d = new Date(now);
    if (period === 'daily') {
      const start = new Date(d);
      start.setUTCHours(0, 0, 0, 0);
      return { startAt: start.getTime(), endAt: now, label: 'daily' };
    }
    if (period === 'weekly') {
      const start = new Date(d);
      const day = start.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setUTCDate(start.getUTCDate() - diff);
      start.setUTCHours(0, 0, 0, 0);
      return { startAt: start.getTime(), endAt: now, label: 'weekly' };
    }
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    return { startAt: start.getTime(), endAt: now, label: 'monthly' };
  }

  async function countEvents(from: number, to: number, event: string) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM website_event
       WHERE website_id = ?1 AND event_type = ?2 AND event_name = ?3
         AND created_at >= ?4 AND created_at <= ?5`,
    )
      .bind(websiteId, EVENT_TYPE.customEvent, event, from, to)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  const configured = await Promise.all(
    goals.map(async (g) => {
      const window = goalPeriodWindow(g.period || 'monthly');
      const count = await countEvents(window.startAt, window.endAt, g.event);
      const progress = g.target > 0 ? Math.min(100, Math.round((count / g.target) * 100)) : 0;
      return {
        event: g.event,
        count,
        target: g.target,
        period: g.period,
        periodStart: window.startAt,
        periodEnd: window.endAt,
        periodLabel: window.label,
        progress,
      };
    }),
  );

  const db = createDb(env.DB);
  const filter = and(
    eq(schema.websiteEvent.websiteId, websiteId),
    eq(schema.websiteEvent.eventType, EVENT_TYPE.customEvent),
    sql`${schema.websiteEvent.createdAt} >= ${startAt}`,
    sql`${schema.websiteEvent.createdAt} <= ${endAt}`,
    ...(eventName ? [eq(schema.websiteEvent.eventName, eventName)] : []),
  );
  const rows = await db
    .select({ x: schema.websiteEvent.eventName, y: count() })
    .from(schema.websiteEvent)
    .where(filter)
    .groupBy(schema.websiteEvent.eventName)
    .orderBy(desc(count()));

  const unconfigured = rows
    .filter((r) => !goals.some((g) => g.event === r.x))
    .map((r) => ({
      event: r.x ?? 'Unknown',
      count: r.y,
      target: null as number | null,
      period: null as string | null,
      periodStart: startAt,
      periodEnd: endAt,
      periodLabel: null as string | null,
      progress: null as number | null,
    }));

  return [...configured, ...unconfigured];
}

export type PageMetricRow = {
  x: string;
  y: number;
  visitors: number;
  avgTime: number;
};

export async function getPageMetrics(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  sortBy: 'views' | 'visitors' | 'time' = 'views',
  limit = 10,
): Promise<PageMetricRow[]> {
  const orderCol =
    sortBy === 'visitors' ? 'visitors' : sortBy === 'time' ? 'avg_time_sec' : 'views';

  const rows = await env.DB.prepare(
    `WITH page_events AS (
       SELECT e.url_path, e.session_id, e.visit_id, e.created_at,
         LEAD(e.created_at) OVER (PARTITION BY e.visit_id ORDER BY e.created_at) as next_at
       FROM website_event e
       WHERE e.website_id = ?1 AND e.event_type = ?2
         AND e.created_at >= ?3 AND e.created_at <= ?4
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
     LIMIT ?5`,
  )
    .bind(websiteId, EVENT_TYPE.pageView, startAt, endAt, limit)
    .all<{ path: string; views: number; visitors: number; avg_time_sec: number }>();

  return (rows.results ?? []).map((r) => ({
    x: r.path ?? '/',
    y: r.views,
    visitors: r.visitors,
    avgTime: r.avg_time_sec ?? 0,
  }));
}

export async function getWebsiteReplays(env: Env, websiteId: string, limit = 50) {
  const rows = await env.DB.prepare(
    `WITH replay_meta AS (
       SELECT visit_id as visitId,
              session_id as sessionId,
              started_at as startedAt,
              ended_at as endedAt,
              event_count as eventCount,
              chunks
       FROM session_replay_summary
       WHERE website_id = ?1
       UNION ALL
       SELECT r.visit_id as visitId,
              r.session_id as sessionId,
              MIN(r.started_at) as startedAt,
              MAX(r.ended_at) as endedAt,
              SUM(r.event_count) as eventCount,
              COUNT(*) as chunks
       FROM session_replay r
       WHERE r.website_id = ?1
         AND NOT EXISTS (
           SELECT 1
           FROM session_replay_summary s
           WHERE s.website_id = r.website_id AND s.visit_id = r.visit_id
         )
       GROUP BY r.visit_id, r.session_id
     ),
     context_counts AS (
       SELECT e.visit_id as visitId,
              SUM(CASE WHEN e.event_type = ?3 THEN 1 ELSE 0 END) as pageviews,
              SUM(CASE WHEN e.event_type = ?4 THEN 1 ELSE 0 END) as customEvents,
              SUM(CASE WHEN e.event_type = ?5 THEN 1 ELSE 0 END) as errors,
              SUM(CASE WHEN e.event_type = ?6 THEN 1 ELSE 0 END) as logs,
              SUM(CASE WHEN e.event_type = ?7 THEN 1 ELSE 0 END) as aiCalls,
              MAX(CASE WHEN e.event_type IN (?5, ?6) THEN e.created_at ELSE NULL END) as lastIssueAt
       FROM website_event e
       INNER JOIN replay_meta rm ON rm.visitId = e.visit_id
       WHERE e.website_id = ?1
       GROUP BY e.visit_id
     )
     SELECT replay_meta.visitId,
            replay_meta.sessionId,
            replay_meta.startedAt,
            replay_meta.endedAt,
            replay_meta.eventCount,
            replay_meta.chunks,
            MAX(replay_meta.endedAt - replay_meta.startedAt, 0) as durationMs,
            COALESCE(context_counts.pageviews, 0) as pageviews,
            COALESCE(context_counts.customEvents, 0) as customEvents,
            COALESCE(context_counts.errors, 0) as errors,
            COALESCE(context_counts.logs, 0) as logs,
            COALESCE(context_counts.aiCalls, 0) as aiCalls,
            context_counts.lastIssueAt
     FROM replay_meta
     LEFT JOIN context_counts ON context_counts.visitId = replay_meta.visitId
     ORDER BY replay_meta.startedAt DESC
     LIMIT ?2`,
  )
    .bind(
      websiteId,
      limit,
      EVENT_TYPE.pageView,
      EVENT_TYPE.customEvent,
      EVENT_TYPE.error,
      EVENT_TYPE.log,
      EVENT_TYPE.ai,
    )
    .all<{
      visitId: string;
      sessionId: string;
      startedAt: number;
      endedAt: number;
      eventCount: number;
      chunks: number;
      durationMs: number;
      pageviews: number;
      customEvents: number;
      errors: number;
      logs: number;
      aiCalls: number;
      lastIssueAt: number | null;
    }>();
  return rows.results ?? [];
}

function coalesceValueSql() {
  return `COALESCE(string_value, CAST(number_value AS TEXT), '')`;
}

export async function getEventDataProperties(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
) {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT data_key as propertyName
     FROM event_data
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
     ORDER BY propertyName`,
  )
    .bind(websiteId, startAt, endAt)
    .all<{ propertyName: string }>();
  return (rows.results ?? []).map((r) => r.propertyName);
}

export async function getEventDataValues(
  env: Env,
  websiteId: string,
  propertyName: string,
  startAt: number,
  endAt: number,
  search?: string,
) {
  const valueExpr = coalesceValueSql();
  let sql = `SELECT DISTINCT ${valueExpr} as value
     FROM event_data
     WHERE website_id = ?1 AND data_key = ?2
       AND created_at >= ?3 AND created_at <= ?4`;
  const binds: (string | number)[] = [websiteId, propertyName, startAt, endAt];
  if (search) {
    sql += ` AND ${valueExpr} LIKE ?5`;
    binds.push(`%${search}%`);
  }
  sql += ` ORDER BY value LIMIT 100`;
  const rows = await env.DB.prepare(sql).bind(...binds).all<{ value: string }>();
  return (rows.results ?? []).map((r) => r.value).filter(Boolean);
}

export async function getEventDataStats(
  env: Env,
  websiteId: string,
  propertyName: string,
  startAt: number,
  endAt: number,
) {
  const valueExpr = coalesceValueSql();
  const rows = await env.DB.prepare(
    `SELECT ${valueExpr} as value, COUNT(*) as total
     FROM event_data
     WHERE website_id = ?1 AND data_key = ?2
       AND created_at >= ?3 AND created_at <= ?4
     GROUP BY value
     ORDER BY total DESC
     LIMIT 50`,
  )
    .bind(websiteId, propertyName, startAt, endAt)
    .all<{ value: string; total: number }>();
  return (rows.results ?? []).map((r) => ({ value: r.value || '(empty)', total: r.total }));
}

export async function getSessionDataProperties(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
) {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT data_key as propertyName
     FROM session_data
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
     ORDER BY propertyName`,
  )
    .bind(websiteId, startAt, endAt)
    .all<{ propertyName: string }>();
  return (rows.results ?? []).map((r) => r.propertyName);
}

export async function getSessionDataValues(
  env: Env,
  websiteId: string,
  propertyName: string,
  startAt: number,
  endAt: number,
  search?: string,
) {
  const valueExpr = coalesceValueSql();
  let sql = `SELECT DISTINCT ${valueExpr} as value
     FROM session_data
     WHERE website_id = ?1 AND data_key = ?2
       AND created_at >= ?3 AND created_at <= ?4`;
  const binds: (string | number)[] = [websiteId, propertyName, startAt, endAt];
  if (search) {
    sql += ` AND ${valueExpr} LIKE ?5`;
    binds.push(`%${search}%`);
  }
  sql += ` ORDER BY value LIMIT 100`;
  const rows = await env.DB.prepare(sql).bind(...binds).all<{ value: string }>();
  return (rows.results ?? []).map((r) => r.value).filter(Boolean);
}

export async function getRevenueReport(env: Env, websiteId: string, startAt: number, endAt: number) {
  const byDay = await env.DB.prepare(
    `SELECT date(created_at / 1000, 'unixepoch') as date, currency,
            SUM(revenue) as total, COUNT(*) as transactions
     FROM revenue
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
     GROUP BY date, currency
     ORDER BY date DESC`,
  )
    .bind(websiteId, startAt, endAt)
    .all<{ date: string; currency: string; total: number; transactions: number }>();

  const byEvent = await env.DB.prepare(
    `SELECT event_name as eventName, currency,
            SUM(revenue) as total, COUNT(*) as transactions
     FROM revenue
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
     GROUP BY event_name, currency
     ORDER BY total DESC LIMIT 50`,
  )
    .bind(websiteId, startAt, endAt)
    .all<{ eventName: string; currency: string; total: number; transactions: number }>();

  return {
    byDay: byDay.results ?? [],
    byEvent: byEvent.results ?? [],
  };
}

export async function getAllUsers(env: Env) {
  const db = createDb(env.DB);
  return db
    .select({
      id: schema.user.userId,
      username: schema.user.username,
      role: schema.user.role,
      displayName: schema.user.displayName,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(isNull(schema.user.deletedAt))
    .orderBy(schema.user.createdAt);
}

export async function getAllTeamsAdmin(env: Env) {
  const db = createDb(env.DB);
  return db
    .select({
      id: schema.team.teamId,
      name: schema.team.name,
      accessCode: schema.team.accessCode,
      createdAt: schema.team.createdAt,
    })
    .from(schema.team)
    .where(isNull(schema.team.deletedAt))
    .orderBy(schema.team.createdAt);
}

export async function getAllWebsitesAdmin(env: Env) {
  const db = createDb(env.DB);
  return db
    .select()
    .from(schema.website)
    .where(isNull(schema.website.deletedAt))
    .orderBy(schema.website.createdAt);
}
