import { EVENT_TYPE } from '@flareboard/shared';
import type { QueueMessage } from '@flareboard/shared';

type SessionMeta = {
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  language?: string | null;
  country?: string | null;
};

/** Session columns that website stores count per combination in rollup_session_dims_daily. */
export const SESSION_DIMENSIONS = ['browser', 'os', 'device', 'language', 'country'] as const;

/** The rollup values of a session's dimensions ('Unknown' when missing), in SESSION_DIMENSIONS order. */
export function sessionDimensionValues(meta: SessionMeta): string[] {
  return SESSION_DIMENSIONS.map((column) => meta[column] || 'Unknown');
}

export function dayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function hourBucket(ms: number) {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().slice(0, 13).replace('T', ' ') + ':00';
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

async function recordSeriesBucket(
  db: D1Database,
  websiteId: string,
  unit: string,
  bucket: string,
  sessionId: string,
  visitId: string,
) {
  await db
    .prepare(
      `INSERT INTO rollup_series_bucket (website_id, unit, bucket, session_id, visit_id)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(website_id, unit, bucket, session_id, visit_id) DO NOTHING`,
    )
    .bind(websiteId, unit, bucket, sessionId, visitId)
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

async function bumpSessionDimensions(db: D1Database, websiteId: string, day: string, meta: SessionMeta) {
  await db
    .prepare(
      `INSERT INTO rollup_session_dims_daily (website_id, day, browser, os, device, language, country, count)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
       ON CONFLICT(website_id, day, browser, os, device, language, country) DO UPDATE SET count = count + 1`,
    )
    .bind(websiteId, day, ...sessionDimensionValues(meta))
    .run();
}

/** Marks a day as having rollups. Readers sum its counters from rollup_session_day. */
async function markRollupDay(db: D1Database, websiteId: string, day: string) {
  await db
    .prepare(
      `INSERT INTO rollup_stats_daily (website_id, day) VALUES (?1, ?2)
       ON CONFLICT(website_id, day) DO NOTHING`,
    )
    .bind(websiteId, day)
    .run();
}

/**
 * Rollups for one event (the per-message fallback). `sessionDimensionsCombined` writes the
 * session dimensions as one rollup_session_dims_daily row (website stores) instead of one
 * rollup_dimension_daily row each (legacy D1).
 */
export async function maintainRollupsForEvent(
  db: D1Database,
  event: Extract<QueueMessage, { type: 'event' }>['data'],
  sessionMeta?: SessionMeta,
  sessionDimensionsCombined = false,
) {
  const createdAt = event.createdAt;
  const day = dayKey(createdAt);
  const websiteId = event.websiteId;

  if (event.eventType === EVENT_TYPE.pageView) {
    await upsertSessionDay(db, websiteId, day, event.sessionId, event.visitId, createdAt);
    await markRollupDay(db, websiteId, day);

    await bumpPageviewSeries(db, websiteId, 'day', day);
    await bumpPageviewSeries(db, websiteId, 'hour', hourBucket(createdAt));
    await recordSeriesBucket(db, websiteId, 'hour', hourBucket(createdAt), event.sessionId, event.visitId);

    await bumpDimension(db, websiteId, day, 'path', event.urlPath || '');
    await bumpDimension(db, websiteId, day, 'referrer', event.referrerDomain || 'Direct');
    if (sessionMeta && sessionDimensionsCombined) {
      await bumpSessionDimensions(db, websiteId, day, sessionMeta);
    } else if (sessionMeta) {
      const values = sessionDimensionValues(sessionMeta);
      for (const [i, column] of SESSION_DIMENSIONS.entries()) {
        await bumpDimension(db, websiteId, day, column, values[i]!);
      }
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

export interface SeriesBucketAgg {
  websiteId: string;
  unit: string;
  bucket: string;
  sessionId: string;
  visitId: string;
}

export interface DimensionAgg {
  websiteId: string;
  day: string;
  dimension: string;
  value: string;
  count: number;
}

export interface SessionDimensionsAgg {
  websiteId: string;
  day: string;
  /** In SESSION_DIMENSIONS order. */
  values: string[];
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

export function buildSeriesBucketStatements(
  db: D1Database,
  items: SeriesBucketAgg[],
): D1PreparedStatement[] {
  return items.map((s) =>
    db
      .prepare(
        `INSERT INTO rollup_series_bucket (website_id, unit, bucket, session_id, visit_id)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(website_id, unit, bucket, session_id, visit_id) DO NOTHING`,
      )
      .bind(s.websiteId, s.unit, s.bucket, s.sessionId, s.visitId),
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

export function buildSessionDimensionsStatements(
  db: D1Database,
  items: SessionDimensionsAgg[],
): D1PreparedStatement[] {
  return items.map((s) =>
    db
      .prepare(
        `INSERT INTO rollup_session_dims_daily (website_id, day, browser, os, device, language, country, count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(website_id, day, browser, os, device, language, country) DO UPDATE SET count = count + ?8`,
      )
      .bind(s.websiteId, s.day, ...s.values, s.count),
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

/** One rollup_stats_daily row per day that has rollups (see markRollupDay). */
export function buildRollupDayStatements(
  db: D1Database,
  siteDays: Array<{ websiteId: string; day: string }>,
): D1PreparedStatement[] {
  return siteDays.map(({ websiteId, day }) =>
    db
      .prepare(
        `INSERT INTO rollup_stats_daily (website_id, day) VALUES (?1, ?2)
         ON CONFLICT(website_id, day) DO NOTHING`,
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
