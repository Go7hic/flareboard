import { EVENT_TYPE } from '@flareboard/shared';
import type { QueueMessage } from '@flareboard/shared';

type SessionMeta = {
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  language?: string | null;
  country?: string | null;
};

function dayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
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
       ON CONFLICT(website_id, day, session_id) DO UPDATE SET
         pageviews = pageviews + 1,
         visit_id = excluded.visit_id,
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
         COUNT(*),
         COUNT(DISTINCT visit_id),
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
