import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { ROLES, createLinkSchema, statsQuerySchema, updateLinkSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessLink, canMutateLink, canMutateTeamResource, userHasTeamAccess } from '../lib/access';
import { getAccessibleLinks, getLinkById, getLinkStats } from '../lib/queries';
import { clampReportRange } from '../lib/report-range';
import { badRequest, forbidden, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function serializeLink(l: typeof schema.link.$inferSelect) {
  return {
    id: l.linkId,
    name: l.name,
    url: l.url,
    slug: l.slug,
    userId: l.userId,
    teamId: l.teamId ?? undefined,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || uuid().slice(0, 8);
}

export async function handleList(c: Ctx) {
  const user = c.get('user');
  const teamId = c.req.query('teamId');
  let links = await getAccessibleLinks(c.env, user.userId);
  if (teamId) {
    const membership = await userHasTeamAccess(c.env, user.userId, teamId);
    if (!membership && user.role !== ROLES.admin) return notFound();
    links = links.filter((l) => l.teamId === teamId);
  }
  return json(links.map(serializeLink));
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const user = c.get('user');
  if (parsed.data.teamId) {
    if (
      !(await canMutateTeamResource(
        c.env,
        { userId: user.userId, teamId: parsed.data.teamId },
        user,
      ))
    ) {
      return forbidden('Read-only access');
    }
  }

  const linkId = uuid();
  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  const now = new Date();
  const db = createDb(c.env.DB);

  try {
    await db.insert(schema.link).values({
      linkId,
      name: parsed.data.name,
      url: parsed.data.url,
      slug,
      userId: user.userId,
      teamId: parsed.data.teamId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    return badRequest('Slug already in use');
  }

  const link = await getLinkById(c.env, linkId);
  return json(serializeLink(link!), 201);
}

export async function handleGet(c: Ctx) {
  const link = await getLinkById(c.env, c.req.param('linkId') ?? '');
  if (!link || !(await canAccessLink(c.env, link, c.get('user')))) return notFound();
  return json(serializeLink(link));
}

export async function handleStats(c: Ctx) {
  const link = await getLinkById(c.env, c.req.param('linkId') ?? '');
  if (!link || !(await canAccessLink(c.env, link, c.get('user')))) return notFound();

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt =
    query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;
  const range = clampReportRange(startAt, endAt);
  const stats = await getLinkStats(c.env, link.linkId, range.startAt, range.endAt);
  return json({ ...stats, startAt: range.startAt, endAt: range.endAt });
}

export async function handleUpdate(c: Ctx) {
  const link = await getLinkById(c.env, c.req.param('linkId') ?? '');
  if (!link || !(await canAccessLink(c.env, link, c.get('user')))) return notFound();
  if (!(await canMutateLink(c.env, link, c.get('user')))) return forbidden('Read-only access');

  const body = await c.req.json().catch(() => null);
  const parsed = updateLinkSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  try {
    await db
      .update(schema.link)
      .set({
        name: parsed.data.name ?? link.name,
        url: parsed.data.url ?? link.url,
        slug: parsed.data.slug ?? link.slug,
        updatedAt: new Date(),
      })
      .where(eq(schema.link.linkId, link.linkId));
  } catch {
    return badRequest('Slug already in use');
  }

  const updated = await getLinkById(c.env, link.linkId);
  return json(serializeLink(updated!));
}

export async function handleDelete(c: Ctx) {
  const link = await getLinkById(c.env, c.req.param('linkId') ?? '');
  if (!link || !(await canAccessLink(c.env, link, c.get('user')))) return notFound();
  if (!(await canMutateLink(c.env, link, c.get('user')))) return forbidden('Read-only access');

  const db = createDb(c.env.DB);
  await db
    .update(schema.link)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.link.linkId, link.linkId));
  return json({ ok: true });
}
