import type { Context } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  createInsightSchema,
  insightQuerySchema,
  insightTypeSchema,
  updateInsightSchema,
  uuid,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { parseStatsRange } from '../lib/parse-range';
import { requireWebsiteById } from '../lib/website';
import {
  runInsightQuery,
  serializeInsight,
  type InsightQuery,
  type InsightType,
} from '../lib/insights';
import { getAccessibleWebsites } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function rowLike(row: typeof schema.insight.$inferSelect) {
  return {
    id: row.insightId,
    websiteId: row.websiteId,
    userId: row.userId,
    type: row.type,
    name: row.name,
    description: row.description,
    query: row.query as InsightQuery,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}


async function getInsight(c: Ctx, insightId: string) {
  const db = createDb(c.env.DB);
  const [row] = await db.select().from(schema.insight).where(eq(schema.insight.insightId, insightId)).limit(1);
  if (!row) return null;
  const website = await requireWebsiteById(c, row.websiteId);
  if (!website) return null;
  return { row, website };
}

export async function handleList(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  const db = createDb(c.env.DB);
  if (!websiteId) {
    const websites = await getAccessibleWebsites(c.env, c.get('user').userId);
    const websiteIds = websites.map((website) => website.websiteId);
    if (!websiteIds.length) return json([]);
    const rows = await db
      .select()
      .from(schema.insight)
      .where(inArray(schema.insight.websiteId, websiteIds))
      .orderBy(schema.insight.createdAt);
    return json(rows.map((row) => serializeInsight(rowLike(row))));
  }
  const website = await requireWebsiteById(c, websiteId);
  if (!website) return notFound();

  const rows = await db
    .select()
    .from(schema.insight)
    .where(eq(schema.insight.websiteId, website.websiteId))
    .orderBy(schema.insight.createdAt);
  return json(rows.map((row) => serializeInsight(rowLike(row))));
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createInsightSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const website = await requireWebsiteById(c, parsed.data.websiteId);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const now = new Date();
  const insightId = uuid();
  const db = createDb(c.env.DB);
  await db.insert(schema.insight).values({
    insightId,
    websiteId: website.websiteId,
    userId: c.get('user').userId,
    type: parsed.data.type,
    name: parsed.data.name,
    description: parsed.data.description,
    query: parsed.data.query,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db.select().from(schema.insight).where(eq(schema.insight.insightId, insightId)).limit(1);
  return json(serializeInsight(rowLike(row!)), 201);
}

export async function handleGet(c: Ctx) {
  const found = await getInsight(c, c.req.param('insightId') ?? '');
  if (!found) return notFound();
  return json(serializeInsight(rowLike(found.row)));
}

export async function handleUpdate(c: Ctx) {
  const found = await getInsight(c, c.req.param('insightId') ?? '');
  if (!found) return notFound();
  if (!(await canMutateWebsite(c.env, found.website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = updateInsightSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  await db
    .update(schema.insight)
    .set({
      name: parsed.data.name ?? found.row.name,
      description: parsed.data.description ?? found.row.description,
      type: parsed.data.type ?? found.row.type,
      query: parsed.data.query ?? found.row.query,
      updatedAt: new Date(),
    })
    .where(eq(schema.insight.insightId, found.row.insightId));

  const [row] = await db.select().from(schema.insight).where(eq(schema.insight.insightId, found.row.insightId)).limit(1);
  return json(serializeInsight(rowLike(row!)));
}

export async function handleDelete(c: Ctx) {
  const found = await getInsight(c, c.req.param('insightId') ?? '');
  if (!found) return notFound();
  if (!(await canMutateWebsite(c.env, found.website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const db = createDb(c.env.DB);
  await db.delete(schema.insight).where(eq(schema.insight.insightId, found.row.insightId));
  return json({ ok: true });
}

export async function handleRun(c: Ctx) {
  const found = await getInsight(c, c.req.param('insightId') ?? '');
  if (!found) return notFound();
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const data = await runInsightQuery(
    c.env,
    found.row.websiteId,
    found.row.type as InsightType,
    found.row.query as InsightQuery,
    startAt,
    endAt,
  );
  return json({ insight: serializeInsight(rowLike(found.row)), data });
}

export async function handlePreview(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  if (!websiteId) return badRequest('websiteId required');
  const website = await requireWebsiteById(c, websiteId);
  if (!website) return notFound();
  const body = await c.req.json().catch(() => null);
  const typeParsed = insightTypeSchema.safeParse((body as { type?: unknown } | null)?.type);
  const queryParsed = insightQuerySchema.safeParse((body as { query?: unknown } | null)?.query ?? {});
  if (!typeParsed.success) return badRequest(typeParsed.error.message);
  if (!queryParsed.success) return badRequest(queryParsed.error.message);
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const data = await runInsightQuery(c.env, website.websiteId, typeParsed.data, queryParsed.data, startAt, endAt);
  return json({ data, startAt, endAt });
}
