import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { ENTITY_TYPE, createShareSchema, statsQuerySchema, updateShareSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import { cachedRead } from '../lib/cache';
import {
  getMetrics,
  getPageviews,
  getShareBySlug,
  getUserShares,
  getWebsiteById,
  getWebsiteStats,
} from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

type ShareParams = {
  websiteId: string;
};

function shareSlug() {
  return crypto.randomUUID().replace(/-/g, '');
}

function serializeShare(row: typeof schema.share.$inferSelect) {
  return {
    id: row.shareId,
    name: row.name,
    slug: row.slug,
    shareType: row.shareType,
    entityId: row.entityId,
    parameters: row.parameters,
    createdAt: row.createdAt,
  };
}

function serializeBoard(b: typeof schema.board.$inferSelect) {
  return {
    id: b.boardId,
    type: b.type,
    name: b.name,
    description: b.description,
    parameters: b.parameters,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export async function handleList(c: Ctx) {
  const shares = await getUserShares(c.env, c.get('user').userId);
  return json(shares.map(serializeShare));
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createShareSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const website = await getWebsiteById(c.env, parsed.data.websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }

  const shareId = uuid();
  const slug = shareSlug();
  const now = new Date();
  const parameters: ShareParams = { websiteId: website.websiteId };

  const db = createDb(c.env.DB);
  await db.insert(schema.share).values({
    shareId,
    entityId: website.websiteId,
    name: parsed.data.name ?? `${website.name} share`,
    shareType: ENTITY_TYPE.website,
    slug,
    parameters,
    createdAt: now,
    updatedAt: now,
  });

  const rows = await db.select().from(schema.share).where(eq(schema.share.shareId, shareId)).limit(1);
  return json(serializeShare(rows[0]!), 201);
}

async function userOwnsShare(c: Ctx, share: typeof schema.share.$inferSelect) {
  if (share.shareType === ENTITY_TYPE.board) {
    const db = createDb(c.env.DB);
    const [board] = await db
      .select()
      .from(schema.board)
      .where(eq(schema.board.boardId, share.entityId))
      .limit(1);
    return board?.userId === c.get('user').userId;
  }
  const website = await getWebsiteById(c.env, share.entityId);
  return website ? canAccessWebsite(c.env, website, c.get('user')) : false;
}

export async function handleUpdate(c: Ctx) {
  const shareId = c.req.param('shareId');
  if (!shareId) return notFound();

  const db = createDb(c.env.DB);
  const [share] = await db.select().from(schema.share).where(eq(schema.share.shareId, shareId)).limit(1);
  if (!share || !(await userOwnsShare(c, share))) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateShareSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  await db
    .update(schema.share)
    .set({ name: parsed.data.name ?? share.name, updatedAt: new Date() })
    .where(eq(schema.share.shareId, shareId));

  const [updated] = await db.select().from(schema.share).where(eq(schema.share.shareId, shareId)).limit(1);
  return json(serializeShare(updated!));
}

export async function handleDelete(c: Ctx) {
  const shareId = c.req.param('shareId');
  if (!shareId) return notFound();

  const db = createDb(c.env.DB);
  const [share] = await db.select().from(schema.share).where(eq(schema.share.shareId, shareId)).limit(1);
  if (!share || !(await userOwnsShare(c, share))) return notFound();

  await db.delete(schema.share).where(eq(schema.share.shareId, shareId));
  return json({ ok: true });
}

function parsePublicRange(c: Context<{ Bindings: Env }>) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 24 * 60 * 60 * 1000;
  const unit = query.success && query.data.unit ? query.data.unit : 'day';
  return { startAt, endAt, unit };
}

export async function handlePublicGet(c: Context<{ Bindings: Env }>) {
  const slug = c.req.param('slug');
  if (!slug) return notFound();
  const share = await getShareBySlug(c.env, slug);
  if (!share) return notFound();

  if (share.shareType === ENTITY_TYPE.board) {
    const db = createDb(c.env.DB);
    const [board] = await db
      .select()
      .from(schema.board)
      .where(eq(schema.board.boardId, share.entityId))
      .limit(1);
    if (!board) return notFound();

    const { startAt, endAt } = parsePublicRange(c);
    const params = board.parameters as { widgets?: Array<{ type?: string; websiteId?: string; label?: string }> };
    const widgets = Array.isArray(params.widgets) ? params.widgets : [];
    const enriched = await Promise.all(
      widgets.map(async (w) => {
        if (w.type !== 'stats' || !w.websiteId) return w;
        const [stats, pageviews] = await Promise.all([
          getWebsiteStats(c.env, w.websiteId, startAt, endAt),
          getPageviews(c.env, w.websiteId, startAt, endAt, 'day'),
        ]);
        return { ...w, stats, series: pageviews.pageviews };
      }),
    );

    return json({
      board: { ...serializeBoard(board), parameters: { widgets: enriched } },
      share: { name: share.name, slug: share.slug },
      period: { startAt, endAt },
    });
  }

  if (share.shareType !== ENTITY_TYPE.website) {
    return notFound();
  }

  const params = share.parameters as ShareParams;
  const website = await getWebsiteById(c.env, params.websiteId);
  if (!website) return notFound();

  const { startAt, endAt, unit } = parsePublicRange(c);
  const type = c.req.query('type');

  if (type) {
    const metrics = await cachedRead(
      c.env,
      `share-metrics:${slug}:${startAt}:${endAt}:${type}`,
      60,
      () => getMetrics(c.env, website.websiteId, startAt, endAt, type, 10),
    );
    return json(metrics);
  }

  if (c.req.path.endsWith('/pageviews') || c.req.query('pageviews') === '1') {
    const pageviews = await cachedRead(
      c.env,
      `share-pageviews:${slug}:${startAt}:${endAt}:${unit}`,
      60,
      () => getPageviews(c.env, website.websiteId, startAt, endAt, unit),
    );
    return json(pageviews);
  }

  const payload = await cachedRead(
    c.env,
    `share-stats:${slug}:${startAt}:${endAt}:${unit}`,
    60,
    async () => {
      const stats = await getWebsiteStats(c.env, website.websiteId, startAt, endAt);
      const series = await getPageviews(c.env, website.websiteId, startAt, endAt, unit);
      return {
        website: { id: website.websiteId, name: website.name, domain: website.domain },
        share: { name: share.name, slug: share.slug },
        ...stats,
        timeseries: series,
      };
    },
  );

  return json(payload);
}
