import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createPixelSchema, updatePixelSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { ROLES } from '@flareboard/shared';
import { canAccessPixel, userHasTeamAccess } from '../lib/access';
import { getAccessiblePixels, getPixelById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function serializePixel(p: typeof schema.pixel.$inferSelect) {
  return {
    id: p.pixelId,
    name: p.name,
    slug: p.slug,
    userId: p.userId,
    teamId: p.teamId ?? undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
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
  let pixels = await getAccessiblePixels(c.env, user.userId);
  if (teamId) {
    const membership = await userHasTeamAccess(c.env, user.userId, teamId);
    if (!membership && user.role !== ROLES.admin) return notFound();
    pixels = pixels.filter((p) => p.teamId === teamId);
  }
  return json(pixels.map(serializePixel));
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createPixelSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const user = c.get('user');
  if (parsed.data.teamId) {
    const membership = await userHasTeamAccess(c.env, user.userId, parsed.data.teamId);
    if (!membership && user.role !== ROLES.admin) return notFound();
  }

  const pixelId = uuid();
  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  const now = new Date();
  const db = createDb(c.env.DB);

  try {
    await db.insert(schema.pixel).values({
      pixelId,
      name: parsed.data.name,
      slug,
      userId: user.userId,
      teamId: parsed.data.teamId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    return badRequest('Slug already in use');
  }

  const pixel = await getPixelById(c.env, pixelId);
  return json(serializePixel(pixel!), 201);
}

export async function handleGet(c: Ctx) {
  const pixel = await getPixelById(c.env, c.req.param('pixelId') ?? '');
  if (!pixel || !(await canAccessPixel(c.env, pixel, c.get('user')))) return notFound();
  return json(serializePixel(pixel));
}

export async function handleUpdate(c: Ctx) {
  const pixel = await getPixelById(c.env, c.req.param('pixelId') ?? '');
  if (!pixel || !(await canAccessPixel(c.env, pixel, c.get('user')))) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updatePixelSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  try {
    await db
      .update(schema.pixel)
      .set({
        name: parsed.data.name ?? pixel.name,
        slug: parsed.data.slug ?? pixel.slug,
        updatedAt: new Date(),
      })
      .where(eq(schema.pixel.pixelId, pixel.pixelId));
  } catch {
    return badRequest('Slug already in use');
  }

  const updated = await getPixelById(c.env, pixel.pixelId);
  return json(serializePixel(updated!));
}

export async function handleDelete(c: Ctx) {
  const pixel = await getPixelById(c.env, c.req.param('pixelId') ?? '');
  if (!pixel || !(await canAccessPixel(c.env, pixel, c.get('user')))) return notFound();

  const db = createDb(c.env.DB);
  await db
    .update(schema.pixel)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.pixel.pixelId, pixel.pixelId));
  return json({ ok: true });
}
