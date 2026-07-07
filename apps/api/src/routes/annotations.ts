import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createAnnotationSchema, statsQuerySchema, updateAnnotationSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { listAnnotations, serializeAnnotation } from '../lib/annotations';
import { json, notFound, badRequest } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function parseRange(c: Ctx) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 90 * 24 * 60 * 60 * 1000;
  return { startAt, endAt };
}

async function getAnnotation(env: Env, websiteId: string, annotationId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.annotation)
    .where(eq(schema.annotation.annotationId, annotationId))
    .limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  return row;
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseRange(c);

  const rows = await listAnnotations(c.env, website!.websiteId, startAt, endAt);
  return json({ annotations: rows.map(serializeAnnotation), startAt, endAt });
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createAnnotationSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const annotationId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.annotation).values({
    annotationId,
    websiteId: website!.websiteId,
    userId: c.get('user').userId,
    title: parsed.data.title,
    description: parsed.data.description,
    category: parsed.data.category,
    happenedAt: new Date(parsed.data.happenedAt),
    createdAt: now,
    updatedAt: now,
  });

  const row = await getAnnotation(c.env, website!.websiteId, annotationId);
  return json(serializeAnnotation(row!), 201);
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getAnnotation(c.env, website!.websiteId, c.req.param('annotationId') ?? '');
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateAnnotationSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  await db
    .update(schema.annotation)
    .set({
      title: parsed.data.title ?? row.title,
      description: parsed.data.description ?? row.description,
      category: parsed.data.category ?? row.category,
      happenedAt: parsed.data.happenedAt ? new Date(parsed.data.happenedAt) : row.happenedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.annotation.annotationId, row.annotationId));

  const updated = await getAnnotation(c.env, website!.websiteId, row.annotationId);
  return json(serializeAnnotation(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getAnnotation(c.env, website!.websiteId, c.req.param('annotationId') ?? '');
  if (!row) return notFound();

  const db = createDb(c.env.DB);
  await db.delete(schema.annotation).where(eq(schema.annotation.annotationId, row.annotationId));
  return json({ ok: true });
}
