import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  createReplayShareSchema,
  createSavedReplaySchema,
  replayListQuerySchema,
  updateSavedReplaySchema,
  uuid,
} from '@flareboard/shared';
import type { Env } from '../env';
import { parseStatsRange } from '../lib/parse-range';
import { canMutateWebsite } from '../lib/access';
import { getWebsiteById } from '../lib/queries';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { InsightQueryError } from '../lib/property-filters';
import {
  getReplayShareByToken,
  getSavedReplays,
  listReplays,
  listReplayShares,
  loadReplay,
  newReplayShareToken,
  replayExists,
} from '../lib/replays';
import { badRequest, json, notFound } from '../lib/response';
import { requireMutateWebsiteOr404, requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const query = replayListQuerySchema.safeParse(c.req.query());
  if (!query.success) return badRequest(query.error.message);
  // Filter by the selected range on the server: the list used to be the newest 50
  // overall, so older ranges showed nothing and long ranges were silently truncated.
  const hasRange = c.req.query('startAt') != null && c.req.query('endAt') != null;
  const range = hasRange ? parseStatsRange(c, { clamp: true }) : undefined;
  try {
    return json(await listReplays(c.env, website!.websiteId, { ...query.data, range }));
  } catch (error) {
    if (error instanceof InsightQueryError) return badRequest(error.message);
    throw error;
  }
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  // The route id may be a visit id or a replay chunk id; both are matched.
  const replay = await loadReplay(c.env, website!.websiteId, c.req.param('replayId') ?? '');
  if (!replay) return notFound();
  return json({ visitId: replay.visitId, chunks: replay.chunks, events: replay.events });
}

function serializeShare(share: { id: string; visitId: string; token: string; expiresAt: number | null; createdAt: number }) {
  return { id: share.id, visitId: share.visitId, token: share.token, expiresAt: share.expiresAt, createdAt: share.createdAt };
}

export async function handleShareList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const shares = await listReplayShares(c.env, website!.websiteId, c.req.param('replayId') ?? '');
  return json(shares.map(serializeShare));
}

export async function handleShareCreate(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const visitId = c.req.param('replayId') ?? '';
  const body = await c.req.json().catch(() => ({}));
  const parsed = createReplayShareSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest(parsed.error.message);
  if (!(await replayExists(c.env, website!.websiteId, visitId))) return notFound();

  const now = Date.now();
  const share = {
    id: uuid(),
    visitId,
    token: newReplayShareToken(),
    expiresAt: parsed.data.expiresInDays ? now + parsed.data.expiresInDays * DAY_MS : null,
    createdAt: now,
  };
  await c.env.DB.prepare(
    `INSERT INTO session_replay_share (share_id, website_id, visit_id, token, created_by, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(share.id, website!.websiteId, visitId, share.token, c.get('user').userId, share.expiresAt, now)
    .run();
  return json(serializeShare(share), 201);
}

export async function handleShareDelete(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const result = await c.env.DB.prepare('DELETE FROM session_replay_share WHERE share_id = ?1 AND website_id = ?2')
    .bind(c.req.param('shareId') ?? '', website!.websiteId)
    .run();
  if (!result.meta?.changes) return notFound();
  return json({ ok: true });
}

const PUBLIC_REPLAY_REQUESTS_PER_MINUTE = 30;

/** GET /api/replay-shares/:token (no login): one shared recording and nothing else. */
export async function handlePublicShare(c: Context<{ Bindings: Env }>) {
  const rl = await checkIpRateLimit(
    c.env,
    'public-replay-share',
    getTrustedClientIp(c.req.raw),
    PUBLIC_REPLAY_REQUESTS_PER_MINUTE,
    60,
  );
  if (!rl.allowed) return json({ message: 'Too many requests' }, 429);
  const share = await getReplayShareByToken(c.env, c.req.param('token') ?? '');
  if (!share) return notFound();
  const website = await getWebsiteById(c.env, share.websiteId);
  if (!website) return notFound();
  const replay = await loadReplay(c.env, share.websiteId, share.visitId);
  if (!replay) return notFound();
  return json({
    website: { name: website.name, domain: website.domain },
    visitId: replay.visitId,
    startedAt: replay.startedAt,
    endedAt: replay.endedAt,
    durationMs: Math.max(replay.endedAt - replay.startedAt, 0),
    expiresAt: share.expiresAt,
    events: replay.events,
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
