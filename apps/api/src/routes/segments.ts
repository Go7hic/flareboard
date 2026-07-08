import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createSegmentSchema, updateSegmentSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { getSegmentById, getWebsiteSegments } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import { requireMutateWebsiteOr404, requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function serializeSegment(s: typeof schema.segment.$inferSelect) {
  return {
    id: s.segmentId,
    websiteId: s.websiteId,
    type: s.type,
    name: s.name,
    parameters: s.parameters,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const segments = await getWebsiteSegments(c.env, website!.websiteId);
  return json(segments.map(serializeSegment));
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const body = await c.req.json().catch(() => null);
  const parsed = createSegmentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const segmentId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.segment).values({
    segmentId,
    websiteId: website!.websiteId,
    type: parsed.data.type,
    name: parsed.data.name,
    parameters: parsed.data.parameters,
    createdAt: now,
    updatedAt: now,
  });

  const segment = await getSegmentById(c.env, segmentId);
  return json(serializeSegment(segment!), 201);
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const segment = await getSegmentById(c.env, c.req.param('segmentId') ?? '');
  if (!segment || segment.websiteId !== website!.websiteId) return notFound();
  return json(serializeSegment(segment));
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const segment = await getSegmentById(c.env, c.req.param('segmentId') ?? '');
  if (!segment || segment.websiteId !== website!.websiteId) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateSegmentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  await db
    .update(schema.segment)
    .set({
      type: parsed.data.type ?? segment.type,
      name: parsed.data.name ?? segment.name,
      parameters: parsed.data.parameters ?? segment.parameters,
      updatedAt: new Date(),
    })
    .where(eq(schema.segment.segmentId, segment.segmentId));

  const updated = await getSegmentById(c.env, segment.segmentId);
  return json(serializeSegment(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const segment = await getSegmentById(c.env, c.req.param('segmentId') ?? '');
  if (!segment || segment.websiteId !== website!.websiteId) return notFound();

  const db = createDb(c.env.DB);
  await db.delete(schema.segment).where(eq(schema.segment.segmentId, segment.segmentId));
  return json({ ok: true });
}
