import { EVENT_TYPE } from '@flareboard/shared';
import type { QueueMessage } from '@flareboard/shared';

type SessionMeta = {
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  language?: string | null;
  country?: string | null;
};

export function dayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function hourBucket(ms: number) {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13).replace('T', ' ') + ':00';
}

export function monthBucket(ms: number) {
  return new Date(ms).toISOString().slice(0, 7);
}

export function yearBucket(ms: number) {
  return new Date(ms).toISOString().slice(0, 4);
}

async function bumpPageviewSeries(db: D1Database, websiteId: string, unit: string, bucket: string) {
  await db
    .prepare(
      `INSERT INTO rollup_pageview_series (website_id, unit, bucket, pageviews)
       VALUES (?1, ?2, ?3, 1)
       ON CONFLICT(website_id, unit, bucket) DO UPDATE SET pageviews = pageviews + 1`,
    )
    .bind(websiteId, unit, bucket)
    .run();
}

async function bumpDimension(
  db: D1Database,
  websiteId: string,
  day: string,
  dimension: string,
  value: string,
) {
  await db
    .prepare(
      `INSERT INTO rollup_dimension_daily (website_id, day, dimension, value, count)
       VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(website_id, day, dimension, value) DO UPDATE SET count = count + 1`,
    )
    .bind(websiteId, day, dimension, value)
    .run();
}

async function upsertSessionDay(
  db: D1Database,
  websiteId: string,
  day: string,
  sessionId: string,
  visitId: string,
  createdAt: number,
) {
  await db
    .prepare(
      `INSERT INTO rollup_session_day (website_id, day, session_id, visit_id, pageviews, first_at, last_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
       ON CONFLICT(website_id, day, session_id, visit_id) DO UPDATE SET
         pageviews = pageviews + 1,
         first_at = MIN(first_at, excluded.first_at),
         last_at = MAX(last_at, excluded.last_at)`,
    )
    .bind(websiteId, day, sessionId, visitId, createdAt)
    .run();
}

async function refreshRollupStatsDaily(db: D1Database, websiteId: string, day: string) {
  await db
    .prepare(
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

export async function maintainRollupsForEvent(
  db: D1Database,
  event: Extract<QueueMessage, { type: 'event' }>['data'],
  sessionMeta?: SessionMeta,
) {
  const createdAt = event.createdAt;
  const day = dayKey(createdAt);
  const websiteId = event.websiteId;

  if (event.eventType === EVENT_TYPE.pageView) {
    await upsertSessionDay(db, websiteId, day, event.sessionId, event.visitId, createdAt);
    await refreshRollupStatsDaily(db, websiteId, day);

    await bumpPageviewSeries(db, websiteId, 'day', day);
    await bumpPageviewSeries(db, websiteId, 'hour', hourBucket(createdAt));
    await bumpPageviewSeries(db, websiteId, 'month', monthBucket(createdAt));
    await bumpPageviewSeries(db, websiteId, 'year', yearBucket(createdAt));

    await bumpDimension(db, websiteId, day, 'path', event.urlPath || '');
    await bumpDimension(db, websiteId, day, 'referrer', event.referrerDomain || 'Direct');
    if (sessionMeta) {
      await bumpDimension(db, websiteId, day, 'browser', sessionMeta.browser || 'Unknown');
      await bumpDimension(db, websiteId, day, 'os', sessionMeta.os || 'Unknown');
      await bumpDimension(db, websiteId, day, 'device', sessionMeta.device || 'Unknown');
      await bumpDimension(db, websiteId, day, 'language', sessionMeta.language || 'Unknown');
      await bumpDimension(db, websiteId, day, 'country', sessionMeta.country || 'Unknown');
    }
  }

  if (event.eventType === EVENT_TYPE.customEvent && event.eventName) {
    await db
      .prepare(
        `INSERT INTO rollup_event_daily (website_id, day, event_name, count)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(website_id, day, event_name) DO UPDATE SET count = count + 1`,
      )
      .bind(websiteId, day, event.eventName)
      .run();
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Batched rollup builders
 *
 * These return D1 prepared statements (with count/delta params) so a whole queue
 * batch can be aggregated in memory and flushed via env.DB.batch(), instead of
 * issuing one +1 upsert per event. Counts are merged per key before building.
 * ────────────────────────────────────────────────────────────────────────── */

export interface SessionDayAgg {
  websiteId: string;
  day: string;
  sessionId: string;
  visitId: string;
  pageviews: number;
  firstAt: number;
  lastAt: number;
}

export interface SeriesAgg {
  websiteId: string;
  unit: string;
  bucket: string;
  count: number;
}

export interface DimensionAgg {
  websiteId: string;
  day: string;
  dimension: string;
  value: string;
  count: number;
}

export interface EventDailyAgg {
  websiteId: string;
  day: string;
  eventName: string;
  count: number;
}

export interface HeatmapAgg {
  websiteId: string;
  urlPath: string;
  day: string;
  kind: string;
  normX: number;
  normY: number;
  deviceClass: string;
  viewportW: number;
  viewportH: number;
  count: number;
}

export function buildSessionDayStatements(
  db: D1Database,
  items: SessionDayAgg[],
): D1PreparedStatement[] {
  return items.map((s) =>
    db
      .prepare(
        `INSERT INTO rollup_session_day (website_id, day, session_id, visit_id, pageviews, first_at, last_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(website_id, day, session_id, visit_id) DO UPDATE SET
           pageviews = pageviews + ?5,
           first_at = MIN(first_at, excluded.first_at),
           last_at = MAX(last_at, excluded.last_at)`,
      )
      .bind(s.websiteId, s.day, s.sessionId, s.visitId, s.pageviews, s.firstAt, s.lastAt),
  );
}

export function buildPageviewSeriesStatements(
  db: D1Database,
  items: SeriesAgg[],
): D1PreparedStatement[] {
  return items.map((s) =>
    db
      .prepare(
        `INSERT INTO rollup_pageview_series (website_id, unit, bucket, pageviews)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(website_id, unit, bucket) DO UPDATE SET pageviews = pageviews + ?4`,
      )
      .bind(s.websiteId, s.unit, s.bucket, s.count),
  );
}

export function buildDimensionDailyStatements(
  db: D1Database,
  items: DimensionAgg[],
): D1PreparedStatement[] {
  return items.map((s) =>
    db
      .prepare(
        `INSERT INTO rollup_dimension_daily (website_id, day, dimension, value, count)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(website_id, day, dimension, value) DO UPDATE SET count = count + ?5`,
      )
      .bind(s.websiteId, s.day, s.dimension, s.value, s.count),
  );
}

export function buildEventDailyStatements(
  db: D1Database,
  items: EventDailyAgg[],
): D1PreparedStatement[] {
  return items.map((s) =>
    db
      .prepare(
        `INSERT INTO rollup_event_daily (website_id, day, event_name, count)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(website_id, day, event_name) DO UPDATE SET count = count + ?4`,
      )
      .bind(s.websiteId, s.day, s.eventName, s.count),
  );
}

export function buildHeatmapStatements(
  db: D1Database,
  items: HeatmapAgg[],
): D1PreparedStatement[] {
  return items.map((h) =>
    db
      .prepare(
        `INSERT INTO heatmap_cell (website_id, url_path, day, kind, norm_x, norm_y, device_class, viewport_w, viewport_h, count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(website_id, url_path, day, kind, norm_x, norm_y, device_class)
         DO UPDATE SET count = count + ?10,
           viewport_w = MAX(viewport_w, excluded.viewport_w),
           viewport_h = MAX(viewport_h, excluded.viewport_h)`,
      )
      .bind(
        h.websiteId,
        h.urlPath,
        h.day,
        h.kind,
        h.normX,
        h.normY,
        h.deviceClass,
        h.viewportW,
        h.viewportH,
        h.count,
      ),
  );
}

export function buildStatsRefreshStatements(
  db: D1Database,
  siteDays: Array<{ websiteId: string; day: string }>,
): D1PreparedStatement[] {
  return siteDays.map(({ websiteId, day }) =>
    db
      .prepare(
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
      .bind(websiteId, day),
  );
}

export async function maintainReplaySummary(
  db: D1Database,
  websiteId: string,
  sessionId: string,
  visitId: string,
  eventCount: number,
  startedAt: number,
  endedAt: number,
) {
  await db
    .prepare(
      `INSERT INTO session_replay_summary (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
       ON CONFLICT(website_id, visit_id) DO UPDATE SET
         session_id = excluded.session_id,
         started_at = MIN(started_at, excluded.started_at),
         ended_at = MAX(ended_at, excluded.ended_at),
         event_count = event_count + excluded.event_count,
         chunks = chunks + 1`,
    )
    .bind(websiteId, visitId, sessionId, startedAt, endedAt, eventCount)
    .run();
}
