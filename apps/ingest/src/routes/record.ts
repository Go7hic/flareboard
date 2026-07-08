import type { Context } from 'hono';
import { isbot } from 'isbot';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { recordSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { checkRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { badRequest, json } from '../lib/response';
import { getWebsiteById } from '../lib/queries';

type Ctx = Context<{ Bindings: Env }>;

const MAX_RECORD_BYTES = 512 * 1024;

export async function handleRecord(c: Ctx) {
  const ua = c.req.header('user-agent') ?? '';
  if (ua && isbot(ua)) {
    return json({ ok: true, skipped: true });
  }

  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RECORD_BYTES) {
    return badRequest('Payload too large');
  }

  const raw = await c.req.text();
  if (raw.length > MAX_RECORD_BYTES) {
    return badRequest('Payload too large');
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest('Invalid JSON');
  }

  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const { website, sessionId, visitId, chunkIndex, events, startedAt, endedAt } = parsed.data.payload;
  const websiteRow = await getWebsiteById(c.env, website);
  if (!websiteRow) return badRequest('Website not found');

  const ip = getTrustedClientIp(c.req.raw);
  const rl = await checkRateLimit(c.env, website, ip);
  if (!rl.allowed) {
    return json({ message: 'Rate limit exceeded' }, 429);
  }

  const chunkBytes = new TextEncoder().encode(JSON.stringify(events));
  const r2Key = `${website}/${visitId}/${chunkIndex}`;

  const db = createDb(c.env.DB);
  const [existingChunk] = await db
    .select({ replayId: schema.sessionReplay.replayId })
    .from(schema.sessionReplay)
    .where(
      and(
        eq(schema.sessionReplay.websiteId, website),
        eq(schema.sessionReplay.visitId, visitId),
        eq(schema.sessionReplay.chunkIndex, chunkIndex),
      ),
    )
    .limit(1);
  if (existingChunk) {
    return json({ ok: true, replayId: existingChunk.replayId, deduped: true });
  }

  const replayId = uuid();

  if (c.env.REPLAY_BUCKET) {
    await c.env.REPLAY_BUCKET.put(r2Key, chunkBytes, {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  await db.insert(schema.sessionReplay).values({
    replayId,
    websiteId: website,
    sessionId,
    visitId,
    chunkIndex,
    events: new Uint8Array(0),
    eventCount: events.length,
    startedAt: new Date(startedAt),
    endedAt: new Date(endedAt),
    createdAt: new Date(),
  });

  await c.env.DB.prepare(
    `INSERT INTO session_replay_summary (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
     ON CONFLICT(website_id, visit_id) DO UPDATE SET
       session_id = excluded.session_id,
       started_at = MIN(started_at, excluded.started_at),
       ended_at = MAX(ended_at, excluded.ended_at),
       event_count = event_count + excluded.event_count,
       chunks = chunks + 1`,
  )
    .bind(website, visitId, sessionId, startedAt, endedAt, events.length)
    .run();

  return json({ ok: true, replayId, r2Key: c.env.REPLAY_BUCKET ? r2Key : null });
}
