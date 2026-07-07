import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createSavedReplaySchema, updateSavedReplaySchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getWebsiteReplays } from '../lib/queries';
import { getSavedReplays } from '../lib/replays';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const replays = await getWebsiteReplays(c.env, website!.websiteId);
  return json(replays);
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const replayId = c.req.param('replayId') ?? '';
  const visitId = replayId.includes('-') && replayId.length > 20 ? replayId : replayId;

  const chunks = await c.env.DB.prepare(
    `SELECT replay_id as id, visit_id as visitId, chunk_index as chunkIndex,
            event_count as eventCount, started_at as startedAt, ended_at as endedAt
     FROM session_replay
     WHERE website_id = ?1 AND (visit_id = ?2 OR replay_id = ?2)
     ORDER BY chunk_index ASC`,
  )
    .bind(website!.websiteId, visitId)
    .all<{ id: string; visitId: string; chunkIndex: number }>();

  if (!chunks.results?.length) return notFound();

  const events: unknown[] = [];
  if (c.env.REPLAY_BUCKET) {
    const websiteId = website!.websiteId;
    const vid = chunks.results[0].visitId ?? visitId;
    const fetched = await Promise.all(
      chunks.results.map(async (chunk) => {
        const idx = (chunk as { chunkIndex: number }).chunkIndex;
        const key = `${websiteId}/${vid}/${idx}`;
        const obj = await c.env.REPLAY_BUCKET!.get(key);
        if (!obj) return [] as unknown[];
        const text = await obj.text();
        try {
          const parsed = JSON.parse(text);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [] as unknown[];
        }
      }),
    );
    for (const part of fetched) events.push(...part);
  }

  return json({
    visitId,
    chunks: chunks.results,
    events,
  });
}

export async function handleSavedList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  return json(await getSavedReplays(c.env, website!.websiteId));
}

export async function handleSavedCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createSavedReplaySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const savedReplayId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.sessionReplaySaved).values({
    savedReplayId,
    name: parsed.data.name,
    websiteId: website!.websiteId,
    visitId: parsed.data.visitId,
    createdAt: now,
    updatedAt: now,
  });

  return json({ id: savedReplayId, name: parsed.data.name, visitId: parsed.data.visitId, createdAt: now }, 201);
}

export async function handleSavedUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const savedId = c.req.param('savedReplayId') ?? '';
  const body = await c.req.json().catch(() => null);
  const parsed = updateSavedReplaySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  const [row] = await db
    .select()
    .from(schema.sessionReplaySaved)
    .where(eq(schema.sessionReplaySaved.savedReplayId, savedId))
    .limit(1);
  if (!row || row.websiteId !== website!.websiteId) return notFound();

  await db
    .update(schema.sessionReplaySaved)
    .set({ name: parsed.data.name ?? row.name, updatedAt: new Date() })
    .where(eq(schema.sessionReplaySaved.savedReplayId, savedId));

  return json({ ok: true });
}

export async function handleSavedDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const savedId = c.req.param('savedReplayId') ?? '';
  const db = createDb(c.env.DB);
  await db
    .delete(schema.sessionReplaySaved)
    .where(
      and(
        eq(schema.sessionReplaySaved.savedReplayId, savedId),
        eq(schema.sessionReplaySaved.websiteId, website!.websiteId),
      ),
    );
  return json({ ok: true });
}
