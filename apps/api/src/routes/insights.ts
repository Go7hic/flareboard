import type { Context } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, schema, type Website } from '@flareboard/db';
import {
  createInsightSchema,
  insightQuerySchema,
  insightTypeSchema,
  mergeInsightFilters,
  propertyFiltersSchema,
  updateInsightSchema,
  uuid,
  type PropertyFilter,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { parseStatsRange } from '../lib/parse-range';
import { requireWebsiteById } from '../lib/website';
import {
  resolveInsightQuery,
  runInsightFunnelActors,
  runInsightQuery,
  serializeInsight,
} from '../lib/insights';
import { listPropertyKeys, listPropertyValues } from '../lib/property-discovery';
import { InsightQueryError } from '../lib/property-filters';
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
    query: row.query,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Invalid queries (bad filter, formula, too many values) answer 400 instead of 500. */
async function withQueryErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InsightQueryError) return badRequest(error.message);
    throw error;
  }
}

/** `?filters=<json>`: extra filters merged into the saved query (e.g. dashboard-wide filters). */
function extraFilters(c: Ctx): PropertyFilter[] | Response {
  const raw = c.req.query('filters');
  if (!raw) return [];
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return badRequest('filters must be JSON');
  }
  const parsed = propertyFiltersSchema.safeParse(parsedJson);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid filters');
  return parsed.data;
}

function runOptions(website: Website) {
  return { timezone: website.timezone ?? 'UTC' };
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

  return withQueryErrors(async () => {
    // Stored as v2 so every saved insight has one shape from now on.
    const query = resolveInsightQuery(parsed.data.type, parsed.data.query);
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
      query,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await db.select().from(schema.insight).where(eq(schema.insight.insightId, insightId)).limit(1);
    return json(serializeInsight(rowLike(row!)), 201);
  });
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

  return withQueryErrors(async () => {
    const type = parsed.data.type ?? found.row.type;
    // A type change re-validates (and upgrades) the stored query for the new type.
    const query =
      parsed.data.query !== undefined || parsed.data.type
        ? resolveInsightQuery(type, parsed.data.query ?? found.row.query)
        : found.row.query;
    const db = createDb(c.env.DB);
    await db
      .update(schema.insight)
      .set({
        name: parsed.data.name ?? found.row.name,
        description: parsed.data.description ?? found.row.description,
        type,
        query,
        updatedAt: new Date(),
      })
      .where(eq(schema.insight.insightId, found.row.insightId));

    const [row] = await db
      .select()
      .from(schema.insight)
      .where(eq(schema.insight.insightId, found.row.insightId))
      .limit(1);
    return json(serializeInsight(rowLike(row!)));
  });
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
  const filters = extraFilters(c);
  if (filters instanceof Response) return filters;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  return withQueryErrors(async () => {
    const query = mergeInsightFilters(resolveInsightQuery(found.row.type, found.row.query), filters);
    const data = await runInsightQuery(
      c.env,
      found.row.websiteId,
      found.row.type,
      query,
      startAt,
      endAt,
      runOptions(found.website),
    );
    return json({ insight: serializeInsight(rowLike(found.row)), data });
  });
}

async function previewInput(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  if (!websiteId) return { error: badRequest('websiteId required') };
  const website = await requireWebsiteById(c, websiteId);
  if (!website) return { error: notFound() };
  const body = await c.req.json().catch(() => null);
  const typeParsed = insightTypeSchema.safeParse((body as { type?: unknown } | null)?.type);
  const queryParsed = insightQuerySchema.safeParse((body as { query?: unknown } | null)?.query ?? {});
  if (!typeParsed.success) return { error: badRequest(typeParsed.error.message) };
  if (!queryParsed.success) return { error: badRequest(queryParsed.error.message) };
  return { website, type: typeParsed.data, query: queryParsed.data, body };
}

export async function handlePreview(c: Ctx) {
  const input = await previewInput(c);
  if ('error' in input) return input.error;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  return withQueryErrors(async () => {
    const data = await runInsightQuery(
      c.env,
      input.website.websiteId,
      input.type,
      input.query,
      startAt,
      endAt,
      runOptions(input.website),
    );
    return json({ data, startAt, endAt });
  });
}

/**
 * Funnel drill-down: ids (distinct ids, else session ids) of units that converted at or dropped
 * off at a step. Body: `{ query, step, outcome, breakdownValue?, breakdownOther?, limit? }`.
 */
export async function handleFunnelActors(c: Ctx) {
  const input = await previewInput(c);
  if ('error' in input) return input.error;
  if (input.type !== 'funnel') return badRequest('Only funnel insights have step actors');
  const body = (input.body ?? {}) as Record<string, unknown>;
  const step = Number(body.step);
  const outcome = body.outcome === 'dropped' ? 'dropped' : 'converted';
  const breakdownValue =
    body.breakdownValue === null || typeof body.breakdownValue === 'string' ? body.breakdownValue : undefined;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  return withQueryErrors(async () => {
    const data = await runInsightFunnelActors(
      c.env,
      input.website.websiteId,
      input.query,
      startAt,
      endAt,
      {
        step,
        outcome,
        breakdownValue,
        breakdownOther: body.breakdownOther === true,
        limit: typeof body.limit === 'number' ? body.limit : undefined,
      },
      runOptions(input.website),
    );
    return json(data);
  });
}

/** Observed property keys: `?websiteId=&type=event|person`. */
export async function handlePropertyKeys(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  if (!websiteId) return badRequest('websiteId required');
  const website = await requireWebsiteById(c, websiteId);
  if (!website) return notFound();
  const type = c.req.query('type');
  if (type !== 'event' && type !== 'person') return badRequest('type must be event or person');
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d', clamp: true });
  return json(await listPropertyKeys(c.env, website.websiteId, type, startAt, endAt));
}

/** Observed values of one property: `?websiteId=&type=event|person|dimension&key=&search=`. */
export async function handlePropertyValues(c: Ctx) {
  const websiteId = c.req.query('websiteId');
  if (!websiteId) return badRequest('websiteId required');
  const website = await requireWebsiteById(c, websiteId);
  if (!website) return notFound();
  const type = c.req.query('type');
  const key = c.req.query('key')?.trim();
  if (type !== 'event' && type !== 'person' && type !== 'dimension') {
    return badRequest('type must be event, person or dimension');
  }
  if (!key || key.length > 200) return badRequest('key required');
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d', clamp: true });
  return withQueryErrors(async () =>
    json(
      await listPropertyValues(c.env, website.websiteId, type, key, startAt, endAt, c.req.query('search')?.slice(0, 200)),
    ),
  );
}
