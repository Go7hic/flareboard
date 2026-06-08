import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import type { QueueMessage } from '@flareboard/shared';
import { maintainRollupsForEvent } from './rollups';

export interface Env {
  DB: D1Database;
  DLQ?: Queue;
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

async function processSession(db: ReturnType<typeof createDb>, msg: Extract<QueueMessage, { type: 'session' }>) {
  const d = msg.data;
  await db
    .insert(schema.session)
    .values({
      sessionId: d.id,
      websiteId: d.websiteId,
      browser: d.browser,
      os: d.os,
      device: d.device,
      screen: d.screen,
      language: d.language,
      country: d.country,
      region: d.region,
      city: d.city,
      distinctId: d.distinctId,
      createdAt: new Date(d.createdAt),
    })
    .onConflictDoNothing();
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

function dayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
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

async function processMessage(db: ReturnType<typeof createDb>, d1: D1Database, msg: QueueMessage) {
  if (msg.type === 'session') {
    await processSession(db, msg);
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

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    const db = createDb(env.DB);

    const messages = [...batch.messages].sort(
      (a, b) => MESSAGE_ORDER[a.body.type] - MESSAGE_ORDER[b.body.type],
    );

    for (const message of messages) {
      try {
        await processMessage(db, env.DB, message.body);
        message.ack();
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
  },
};
