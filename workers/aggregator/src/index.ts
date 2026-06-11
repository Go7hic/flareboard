import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { EVENT_TYPE, currentMonthKey, type QueueMessage } from '@flareboard/shared';
import {
  buildDimensionDailyStatements,
  buildEventDailyStatements,
  buildHeatmapStatements,
  buildPageviewSeriesStatements,
  buildSessionDayStatements,
  buildStatsRefreshStatements,
  dayKey,
  hourBucket,
  maintainRollupsForEvent,
  monthBucket,
  yearBucket,
  type DimensionAgg,
  type EventDailyAgg,
  type HeatmapAgg,
  type SeriesAgg,
  type SessionDayAgg,
} from './rollups';

export interface Env {
  DB: D1Database;
  DLQ?: Queue;
  /** When "true", billable queue messages update usage_monthly (matches ingest HOSTED_MODE). */
  HOSTED_MODE?: string;
}

const MAX_RETRIES = 5;

/** Process sessions before events so FK inserts succeed when messages arrive out of order. */
const MESSAGE_ORDER: Record<QueueMessage['type'], number> = {
  session: 0,
  session_data: 1,
  event: 2,
  revenue: 3,
  heatmap: 4,
};

async function ensureSessionRow(
  db: ReturnType<typeof createDb>,
  sessionId: string,
  websiteId: string,
  createdAt: number,
) {
  await db
    .insert(schema.session)
    .values({
      sessionId,
      websiteId,
      createdAt: new Date(createdAt),
    })
    .onConflictDoNothing();
}

async function getSessionMeta(db: ReturnType<typeof createDb>, sessionId: string) {
  const [row] = await db
    .select({
      browser: schema.session.browser,
      os: schema.session.os,
      device: schema.session.device,
      language: schema.session.language,
      country: schema.session.country,
    })
    .from(schema.session)
    .where(eq(schema.session.sessionId, sessionId))
    .limit(1);
  return row;
}

async function processSession(d1: D1Database, msg: Extract<QueueMessage, { type: 'session' }>) {
  const d = msg.data;
  await d1
    .prepare(
      `INSERT INTO session (session_id, website_id, browser, os, device, screen, language, country, region, city, distinct_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         website_id = excluded.website_id,
         browser = COALESCE(excluded.browser, browser),
         os = COALESCE(excluded.os, os),
         device = COALESCE(excluded.device, device),
         screen = COALESCE(excluded.screen, screen),
         language = COALESCE(excluded.language, language),
         country = COALESCE(excluded.country, country),
         region = COALESCE(excluded.region, region),
         city = COALESCE(excluded.city, city),
         distinct_id = COALESCE(excluded.distinct_id, distinct_id),
         created_at = MIN(created_at, excluded.created_at)`,
    )
    .bind(
      d.id,
      d.websiteId,
      d.browser ?? null,
      d.os ?? null,
      d.device ?? null,
      d.screen ?? null,
      d.language ?? null,
      d.country ?? null,
      d.region ?? null,
      d.city ?? null,
      d.distinctId ?? null,
      d.createdAt,
    )
    .run();
}

async function processEvent(
  db: ReturnType<typeof createDb>,
  d1: D1Database,
  msg: Extract<QueueMessage, { type: 'event' }>,
) {
  const d = msg.data;
  await ensureSessionRow(db, d.sessionId, d.websiteId, d.createdAt);
  await db
    .insert(schema.websiteEvent)
    .values({
      eventId: d.id,
      websiteId: d.websiteId,
      sessionId: d.sessionId,
      visitId: d.visitId,
      createdAt: new Date(d.createdAt),
      urlPath: d.urlPath,
      urlQuery: d.urlQuery,
      utmSource: d.utmSource,
      utmMedium: d.utmMedium,
      utmCampaign: d.utmCampaign,
      utmContent: d.utmContent,
      utmTerm: d.utmTerm,
      referrerPath: d.referrerPath,
      referrerQuery: d.referrerQuery,
      referrerDomain: d.referrerDomain,
      pageTitle: d.pageTitle,
      gclid: d.gclid,
      fbclid: d.fbclid,
      msclkid: d.msclkid,
      ttclid: d.ttclid,
      lifatid: d.lifatid,
      twclid: d.twclid,
      eventType: d.eventType,
      eventName: d.eventName,
      tag: d.tag,
      hostname: d.hostname,
      lcp: d.lcp ?? null,
      inp: d.inp ?? null,
      cls: d.cls ?? null,
      fcp: d.fcp ?? null,
      ttfb: d.ttfb ?? null,
    })
    .onConflictDoNothing();

  if (msg.eventData?.length) {
    await db
      .insert(schema.eventData)
      .values(
        msg.eventData.map((row) => ({
          eventDataId: row.id,
          websiteId: row.websiteId,
          websiteEventId: row.websiteEventId,
          dataKey: row.dataKey,
          stringValue: row.stringValue,
          numberValue: row.numberValue,
          dateValue: row.dateValue ? new Date(row.dateValue) : null,
          dataType: row.dataType,
          createdAt: new Date(row.createdAt),
        })),
      )
      .onConflictDoNothing();
  }

  const sessionMeta = await getSessionMeta(db, d.sessionId);
  await maintainRollupsForEvent(d1, d, sessionMeta);
}

async function processSessionData(
  db: ReturnType<typeof createDb>,
  msg: Extract<QueueMessage, { type: 'session_data' }>,
) {
  if (!msg.data.length) return;
  const sessionSeen = new Set<string>();
  for (const row of msg.data) {
    if (sessionSeen.has(row.sessionId)) continue;
    sessionSeen.add(row.sessionId);
    await ensureSessionRow(db, row.sessionId, row.websiteId, row.createdAt);
  }

  await db
    .insert(schema.sessionData)
    .values(
      msg.data.map((row) => ({
        sessionDataId: row.id,
        websiteId: row.websiteId,
        sessionId: row.sessionId,
        dataKey: row.dataKey,
        stringValue: row.stringValue,
        numberValue: row.numberValue,
        dateValue: row.dateValue ? new Date(row.dateValue) : null,
        dataType: row.dataType,
        distinctId: row.distinctId,
        createdAt: new Date(row.createdAt),
      })),
    )
    .onConflictDoNothing();
}

async function processHeatmap(d1: D1Database, msg: Extract<QueueMessage, { type: 'heatmap' }>) {
  const d = msg.data;
  const day = dayKey(d.createdAt);
  await d1
    .prepare(
      `INSERT INTO heatmap_cell (website_id, url_path, day, kind, norm_x, norm_y, device_class, viewport_w, viewport_h, count)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)
       ON CONFLICT(website_id, url_path, day, kind, norm_x, norm_y, device_class)
       DO UPDATE SET count = count + 1,
         viewport_w = MAX(viewport_w, excluded.viewport_w),
         viewport_h = MAX(viewport_h, excluded.viewport_h)`,
    )
    .bind(
      d.websiteId,
      d.urlPath,
      day,
      d.kind,
      d.normX,
      d.normY,
      d.deviceClass ?? '',
      d.viewportW,
      d.viewportH,
    )
    .run();
}

async function processRevenue(
  db: ReturnType<typeof createDb>,
  msg: Extract<QueueMessage, { type: 'revenue' }>,
) {
  const d = msg.data;
  await ensureSessionRow(db, d.sessionId, d.websiteId, d.createdAt);
  await db
    .insert(schema.revenue)
    .values({
      revenueId: d.id,
      websiteId: d.websiteId,
      sessionId: d.sessionId,
      eventId: d.eventId,
      eventName: d.eventName,
      currency: d.currency,
      revenue: d.revenue,
      createdAt: new Date(d.createdAt),
    })
    .onConflictDoNothing();
}

async function getWebsiteOwners(
  d1: D1Database,
  websiteIds: string[],
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  if (!websiteIds.length) return owners;

  const unique = [...new Set(websiteIds)];
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await d1
    .prepare(
      `SELECT website_id, user_id FROM website WHERE website_id IN (${placeholders}) AND deleted_at IS NULL`,
    )
    .bind(...unique)
    .all<{ website_id: string; user_id: string | null }>();

  for (const row of results ?? []) {
    if (row.user_id) owners.set(row.website_id, row.user_id);
  }
  return owners;
}

async function flushUsageToD1(d1: D1Database, usageByUser: Map<string, number>) {
  if (!usageByUser.size) return;
  const monthKey = currentMonthKey();
  for (const [userId, delta] of usageByUser) {
    if (delta <= 0) continue;
    await d1
      .prepare(
        `INSERT INTO usage_monthly (user_id, month_key, events_count) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, month_key) DO UPDATE SET events_count = events_count + excluded.events_count`,
      )
      .bind(userId, monthKey, delta)
      .run();
  }
}

function billableWebsiteId(msg: QueueMessage): string | null {
  if (msg.type === 'event' || msg.type === 'revenue' || msg.type === 'heatmap') {
    return msg.data.websiteId;
  }
  return null;
}

async function processMessage(db: ReturnType<typeof createDb>, d1: D1Database, msg: QueueMessage) {
  if (msg.type === 'session') {
    await processSession(d1, msg);
    return;
  }
  if (msg.type === 'event') {
    await processEvent(db, d1, msg);
    return;
  }
  if (msg.type === 'session_data') {
    await processSessionData(db, msg);
    return;
  }
  if (msg.type === 'revenue') {
    await processRevenue(db, msg);
    return;
  }
  if (msg.type === 'heatmap') {
    await processHeatmap(d1, msg);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Optimized batch path
 *
 * Aggregates an entire queue batch in memory and flushes via env.DB.batch(),
 * collapsing the per-event "+1" rollup upserts into one count-bearing upsert per
 * key. Core rows (session/event/eventData/revenue/session_data) use raw INSERT
 * ... ON CONFLICT DO NOTHING so they stay idempotent under retry.
 *
 * Rollup counters are best-effort and rebuildable via `pnpm backfill:rollups`.
 * Core write failures still fall back per-message for poison isolation; rollup
 * write failures are acknowledged to avoid replaying increment-style counters.
 * ────────────────────────────────────────────────────────────────────────── */

const DB_BATCH_SIZE = 50;
const SESSION_META_IN_SIZE = 100;

class BatchProcessingError extends Error {
  constructor(
    message: string,
    readonly fallbackSafe: boolean,
  ) {
    super(message);
  }
}

type SessionMetaRow = {
  browser: string | null;
  os: string | null;
  device: string | null;
  language: string | null;
  country: string | null;
};

type D1BatchResult = Awaited<ReturnType<D1Database['batch']>>[number];

function statementChanged(result: D1BatchResult | undefined) {
  const changes = result?.meta?.changes;
  return typeof changes === 'number' ? changes > 0 : true;
}

async function runBatched(
  db: D1Database,
  stmts: D1PreparedStatement[],
  size = DB_BATCH_SIZE,
): Promise<D1BatchResult[]> {
  const results: D1BatchResult[] = [];
  for (let i = 0; i < stmts.length; i += size) {
    const slice = stmts.slice(i, i + size);
    if (slice.length) results.push(...(await db.batch(slice)));
  }
  return results;
}

async function fetchSessionMeta(
  db: D1Database,
  sessionIds: string[],
): Promise<Map<string, SessionMetaRow>> {
  const map = new Map<string, SessionMetaRow>();
  const unique = [...new Set(sessionIds)];
  for (let i = 0; i < unique.length; i += SESSION_META_IN_SIZE) {
    const chunk = unique.slice(i, i + SESSION_META_IN_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT session_id, browser, os, device, language, country
         FROM session WHERE session_id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ session_id: string } & SessionMetaRow>();
    for (const r of results ?? []) {
      map.set(r.session_id, {
        browser: r.browser,
        os: r.os,
        device: r.device,
        language: r.language,
        country: r.country,
      });
    }
  }
  return map;
}

async function getUsageByUser(
  d1: D1Database,
  messages: QueueMessage[],
  hostedBilling: boolean,
): Promise<Map<string, number>> {
  const usageByUser = new Map<string, number>();
  if (!hostedBilling) return usageByUser;

  const billableIds = messages
    .map((m) => billableWebsiteId(m))
    .filter((id): id is string => id !== null);
  const owners = await getWebsiteOwners(d1, billableIds);
  for (const m of messages) {
    const websiteId = billableWebsiteId(m);
    if (!websiteId) continue;
    const userId = owners.get(websiteId);
    if (userId) usageByUser.set(userId, (usageByUser.get(userId) ?? 0) + 1);
  }
  return usageByUser;
}

async function flushUsageAfterAck(env: Env, usageByUser: Map<string, number>) {
  if (!usageByUser.size) return;

  try {
    await flushUsageToD1(env.DB, usageByUser);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'queue_usage_flush_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function flushMessageUsageAfterAck(env: Env, messages: QueueMessage[], hostedBilling: boolean) {
  try {
    await flushUsageAfterAck(env, await getUsageByUser(env.DB, messages, hostedBilling));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'queue_usage_prepare_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function processBatchOptimized(
  env: Env,
  messages: QueueMessage[],
  hostedBilling: boolean,
): Promise<Map<string, number>> {
  const db = env.DB;
  let fallbackSafe = true;

  try {
    const sessionMsgs = messages.filter((m): m is Extract<QueueMessage, { type: 'session' }> => m.type === 'session');
    const eventMsgs = messages.filter((m): m is Extract<QueueMessage, { type: 'event' }> => m.type === 'event');
    const sessionDataMsgs = messages.filter((m): m is Extract<QueueMessage, { type: 'session_data' }> => m.type === 'session_data');
    const revenueMsgs = messages.filter((m): m is Extract<QueueMessage, { type: 'revenue' }> => m.type === 'revenue');
    const heatmapMsgs = messages.filter((m): m is Extract<QueueMessage, { type: 'heatmap' }> => m.type === 'heatmap');

    // ── Phase 1: sessions (full inserts first so real metadata wins over stubs) ──
    const sessionStmts: D1PreparedStatement[] = [];
    const fullSessionMeta = new Map<string, SessionMetaRow>();
    for (const m of sessionMsgs) {
      const d = m.data;
      sessionStmts.push(
        db
          .prepare(
            `INSERT INTO session (session_id, website_id, browser, os, device, screen, language, country, region, city, distinct_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
               website_id = excluded.website_id,
               browser = COALESCE(excluded.browser, browser),
               os = COALESCE(excluded.os, os),
               device = COALESCE(excluded.device, device),
               screen = COALESCE(excluded.screen, screen),
               language = COALESCE(excluded.language, language),
               country = COALESCE(excluded.country, country),
               region = COALESCE(excluded.region, region),
               city = COALESCE(excluded.city, city),
               distinct_id = COALESCE(excluded.distinct_id, distinct_id),
               created_at = MIN(created_at, excluded.created_at)`,
          )
          .bind(
            d.id,
            d.websiteId,
            d.browser ?? null,
            d.os ?? null,
            d.device ?? null,
            d.screen ?? null,
            d.language ?? null,
            d.country ?? null,
            d.region ?? null,
            d.city ?? null,
            d.distinctId ?? null,
            d.createdAt,
          ),
      );
      fullSessionMeta.set(d.id, {
        browser: d.browser ?? null,
        os: d.os ?? null,
        device: d.device ?? null,
        language: d.language ?? null,
        country: d.country ?? null,
      });
    }

    const stubSeen = new Set<string>();
    const pushStub = (sessionId: string, websiteId: string, createdAt: number) => {
      if (fullSessionMeta.has(sessionId) || stubSeen.has(sessionId)) return;
      stubSeen.add(sessionId);
      sessionStmts.push(
        db
          .prepare(
            `INSERT INTO session (session_id, website_id, created_at) VALUES (?, ?, ?)
             ON CONFLICT(session_id) DO NOTHING`,
          )
          .bind(sessionId, websiteId, createdAt),
      );
    };
    for (const m of eventMsgs) pushStub(m.data.sessionId, m.data.websiteId, m.data.createdAt);
    for (const m of revenueMsgs) pushStub(m.data.sessionId, m.data.websiteId, m.data.createdAt);
    for (const m of sessionDataMsgs) {
      for (const row of m.data) pushStub(row.sessionId, row.websiteId, row.createdAt);
    }
    await runBatched(db, sessionStmts);

    // ── Phase 2: session meta for events whose session isn't in this batch ──
    const missingMetaIds = eventMsgs
      .map((m) => m.data.sessionId)
      .filter((id) => !fullSessionMeta.has(id));
    const fetchedMeta = await fetchSessionMeta(db, missingMetaIds);
    const metaMap = new Map<string, SessionMetaRow>([...fullSessionMeta, ...fetchedMeta]);

    // ── Phase 3: core rows (events, eventData, revenue, session_data) ──
    const eventInsertStmts: D1PreparedStatement[] = [];
    for (const m of eventMsgs) {
      const d = m.data;
      eventInsertStmts.push(
        db
          .prepare(
            `INSERT INTO website_event (
            event_id, website_id, session_id, visit_id, created_at, url_path, url_query,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            referrer_path, referrer_query, referrer_domain, page_title,
            gclid, fbclid, msclkid, ttclid, li_fat_id, twclid,
            event_type, event_name, tag, hostname, lcp, inp, cls, fcp, ttfb
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO NOTHING`,
          )
          .bind(
            d.id,
            d.websiteId,
            d.sessionId,
            d.visitId,
            d.createdAt,
            d.urlPath,
            d.urlQuery ?? null,
            d.utmSource ?? null,
            d.utmMedium ?? null,
            d.utmCampaign ?? null,
            d.utmContent ?? null,
            d.utmTerm ?? null,
            d.referrerPath ?? null,
            d.referrerQuery ?? null,
            d.referrerDomain ?? null,
            d.pageTitle ?? null,
            d.gclid ?? null,
            d.fbclid ?? null,
            d.msclkid ?? null,
            d.ttclid ?? null,
            d.lifatid ?? null,
            d.twclid ?? null,
            d.eventType,
            d.eventName ?? null,
            d.tag ?? null,
            d.hostname ?? null,
            d.lcp ?? null,
            d.inp ?? null,
            d.cls ?? null,
            d.fcp ?? null,
            d.ttfb ?? null,
          ),
      );
    }
    const eventInsertResults = await runBatched(db, eventInsertStmts);
    const insertedEventMsgs = eventMsgs.filter((_, index) => statementChanged(eventInsertResults[index]));

    const relatedCoreStmts: D1PreparedStatement[] = [];
    for (const m of eventMsgs) {
      for (const row of m.eventData ?? []) {
        relatedCoreStmts.push(
          db
            .prepare(
              `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, date_value, data_type, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(event_data_id) DO NOTHING`,
            )
            .bind(
              row.id,
              row.websiteId,
              row.websiteEventId,
              row.dataKey,
              row.stringValue ?? null,
              row.numberValue ?? null,
              row.dateValue ?? null,
              row.dataType,
              row.createdAt,
            ),
        );
      }
    }
    for (const m of sessionDataMsgs) {
      for (const row of m.data) {
        relatedCoreStmts.push(
          db
            .prepare(
              `INSERT INTO session_data (session_data_id, website_id, session_id, data_key, string_value, number_value, date_value, data_type, distinct_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_data_id) DO NOTHING`,
            )
            .bind(
              row.id,
              row.websiteId,
              row.sessionId,
              row.dataKey,
              row.stringValue ?? null,
              row.numberValue ?? null,
              row.dateValue ?? null,
              row.dataType,
              row.distinctId ?? null,
              row.createdAt,
            ),
        );
      }
    }
    for (const m of revenueMsgs) {
      const d = m.data;
      relatedCoreStmts.push(
        db
          .prepare(
            `INSERT INTO revenue (revenue_id, website_id, session_id, event_id, event_name, currency, revenue, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(revenue_id) DO NOTHING`,
          )
          .bind(d.id, d.websiteId, d.sessionId, d.eventId, d.eventName, d.currency, d.revenue, d.createdAt),
      );
    }
    await runBatched(db, relatedCoreStmts);

    // ── Phase 4: aggregate rollups in memory ──
    const sessionDay = new Map<string, SessionDayAgg>();
    const series = new Map<string, SeriesAgg>();
    const dimension = new Map<string, DimensionAgg>();
    const eventDaily = new Map<string, EventDailyAgg>();
    const heatmap = new Map<string, HeatmapAgg>();
    const statsDays = new Map<string, { websiteId: string; day: string }>();
    const SEP = '\u0000';

    const addSeries = (websiteId: string, unit: string, bucket: string) => {
      const key = `${websiteId}${SEP}${unit}${SEP}${bucket}`;
      const cur = series.get(key);
      if (cur) cur.count += 1;
      else series.set(key, { websiteId, unit, bucket, count: 1 });
    };
    const addDim = (websiteId: string, day: string, dim: string, value: string) => {
      const key = `${websiteId}${SEP}${day}${SEP}${dim}${SEP}${value}`;
      const cur = dimension.get(key);
      if (cur) cur.count += 1;
      else dimension.set(key, { websiteId, day, dimension: dim, value, count: 1 });
    };

    for (const m of insertedEventMsgs) {
      const d = m.data;
      const day = dayKey(d.createdAt);

      if (d.eventType === EVENT_TYPE.pageView) {
        const sdKey = `${d.websiteId}${SEP}${day}${SEP}${d.sessionId}${SEP}${d.visitId}`;
        const sd = sessionDay.get(sdKey);
        if (sd) {
          sd.pageviews += 1;
          sd.firstAt = Math.min(sd.firstAt, d.createdAt);
          sd.lastAt = Math.max(sd.lastAt, d.createdAt);
        } else {
          sessionDay.set(sdKey, {
            websiteId: d.websiteId,
            day,
            sessionId: d.sessionId,
            visitId: d.visitId,
            pageviews: 1,
            firstAt: d.createdAt,
            lastAt: d.createdAt,
          });
        }
        statsDays.set(`${d.websiteId}${SEP}${day}`, { websiteId: d.websiteId, day });

        addSeries(d.websiteId, 'day', day);
        addSeries(d.websiteId, 'hour', hourBucket(d.createdAt));
        addSeries(d.websiteId, 'month', monthBucket(d.createdAt));
        addSeries(d.websiteId, 'year', yearBucket(d.createdAt));

        addDim(d.websiteId, day, 'path', d.urlPath || '');
        addDim(d.websiteId, day, 'referrer', d.referrerDomain || 'Direct');
        const meta = metaMap.get(d.sessionId);
        if (meta) {
          addDim(d.websiteId, day, 'browser', meta.browser || 'Unknown');
          addDim(d.websiteId, day, 'os', meta.os || 'Unknown');
          addDim(d.websiteId, day, 'device', meta.device || 'Unknown');
          addDim(d.websiteId, day, 'language', meta.language || 'Unknown');
          addDim(d.websiteId, day, 'country', meta.country || 'Unknown');
        }
      }

      if (d.eventType === EVENT_TYPE.customEvent && d.eventName) {
        const key = `${d.websiteId}${SEP}${day}${SEP}${d.eventName}`;
        const cur = eventDaily.get(key);
        if (cur) cur.count += 1;
        else eventDaily.set(key, { websiteId: d.websiteId, day, eventName: d.eventName, count: 1 });
      }
    }

    for (const m of heatmapMsgs) {
      const d = m.data;
      const day = dayKey(d.createdAt);
      const deviceClass = d.deviceClass ?? '';
      const key = `${d.websiteId}${SEP}${d.urlPath}${SEP}${day}${SEP}${d.kind}${SEP}${d.normX}${SEP}${d.normY}${SEP}${deviceClass}`;
      const cur = heatmap.get(key);
      if (cur) {
        cur.count += 1;
        cur.viewportW = Math.max(cur.viewportW, d.viewportW);
        cur.viewportH = Math.max(cur.viewportH, d.viewportH);
      } else {
        heatmap.set(key, {
          websiteId: d.websiteId,
          urlPath: d.urlPath,
          day,
          kind: d.kind,
          normX: d.normX,
          normY: d.normY,
          deviceClass,
          viewportW: d.viewportW,
          viewportH: d.viewportH,
          count: 1,
        });
      }
    }

    // After this point, fallback would replay increment-style rollups and can
    // inflate counters if any D1 batch chunk already committed.
    fallbackSafe = false;
    await runBatched(db, [
      ...buildSessionDayStatements(db, [...sessionDay.values()]),
      ...buildPageviewSeriesStatements(db, [...series.values()]),
      ...buildDimensionDailyStatements(db, [...dimension.values()]),
      ...buildEventDailyStatements(db, [...eventDaily.values()]),
      ...buildHeatmapStatements(db, [...heatmap.values()]),
    ]);
    await runBatched(db, buildStatsRefreshStatements(db, [...statsDays.values()]));

    return getUsageByUser(db, messages, hostedBilling);
  } catch (error) {
    throw new BatchProcessingError(
      error instanceof Error ? error.message : String(error),
      fallbackSafe,
    );
  }
}

/** Per-message fallback: isolates poison messages with ack/retry/DLQ semantics. */
async function processPerMessageFallback(
  batch: MessageBatch<QueueMessage>,
  env: Env,
  hostedBilling: boolean,
) {
  const db = createDb(env.DB);
  const messages = [...batch.messages].sort(
    (a, b) => MESSAGE_ORDER[a.body.type] - MESSAGE_ORDER[b.body.type],
  );

  const usageByUser = new Map<string, number>();
  let owners = new Map<string, string>();
  if (hostedBilling) {
    const billableWebsiteIds = messages
      .map((m) => billableWebsiteId(m.body))
      .filter((id): id is string => id !== null);
    owners = await getWebsiteOwners(env.DB, billableWebsiteIds);
  }

  for (const message of messages) {
    try {
      await processMessage(db, env.DB, message.body);
      message.ack();

      if (hostedBilling) {
        const websiteId = billableWebsiteId(message.body);
        if (websiteId) {
          const userId = owners.get(websiteId);
          if (userId) usageByUser.set(userId, (usageByUser.get(userId) ?? 0) + 1);
        }
      }
    } catch (error) {
      const attempts = message.attempts ?? 1;
      if (attempts >= MAX_RETRIES) {
        console.error(
          JSON.stringify({
            event: 'queue_message_dead_letter',
            type: message.body?.type,
            attempts,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        if (env.DLQ) {
          await env.DLQ.send(message.body);
        }
        message.ack();
      } else {
        console.error(
          JSON.stringify({
            event: 'queue_message_retry',
            type: message.body?.type,
            attempts,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        message.retry();
      }
    }
  }

  if (hostedBilling && usageByUser.size) {
    await flushUsageToD1(env.DB, usageByUser);
  }
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    const hostedBilling = env.HOSTED_MODE === 'true';
    const messages = [...batch.messages]
      .sort((a, b) => MESSAGE_ORDER[a.body.type] - MESSAGE_ORDER[b.body.type])
      .map((m) => m.body);

    try {
      const usageByUser = await processBatchOptimized(env, messages, hostedBilling);
      batch.ackAll();
      await flushUsageAfterAck(env, usageByUser);
    } catch (error) {
      const fallbackSafe = error instanceof BatchProcessingError ? error.fallbackSafe : true;
      console.error(
        JSON.stringify({
          event: fallbackSafe ? 'queue_batch_fallback' : 'queue_batch_rollup_failed',
          size: messages.length,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (fallbackSafe) {
        await processPerMessageFallback(batch, env, hostedBilling);
        return;
      }

      batch.ackAll();
      await flushMessageUsageAfterAck(env, messages, hostedBilling);
    }
  },
};
