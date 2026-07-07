import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createActionSchema, statsQuerySchema, updateActionSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getActionSummary, serializeAction, type ActionRule } from '../lib/actions';
import { bumpActionDefinitionsVersion } from '../lib/action-cache';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function parseRange(c: Ctx) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;
  return { startAt, endAt };
}

function actionRow(row: typeof schema.actionDefinition.$inferSelect) {
  return {
    id: row.actionId,
    websiteId: row.websiteId,
    name: row.name,
    description: row.description,
    rules: (Array.isArray(row.rules) ? row.rules : []) as ActionRule[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getAction(env: Env, websiteId: string, actionId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.actionDefinition)
    .where(eq(schema.actionDefinition.actionId, actionId))
    .limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  return row;
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseRange(c);

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.actionDefinition)
    .where(eq(schema.actionDefinition.websiteId, website!.websiteId))
    .orderBy(schema.actionDefinition.createdAt);
  const summaries = await Promise.all(
    rows.map((row) => getActionSummary(c.env, website!.websiteId, (row.rules ?? []) as ActionRule[], startAt, endAt)),
  );
  return json(rows.map((row, index) => serializeAction(actionRow(row), summaries[index])));
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseRange(c);

  const row = await getAction(c.env, website!.websiteId, c.req.param('actionId') ?? '');
  if (!row) return notFound();
  const summary = await getActionSummary(c.env, website!.websiteId, (row.rules ?? []) as ActionRule[], startAt, endAt);
  return json(serializeAction(actionRow(row), summary));
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createActionSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const now = new Date();
  const actionId = uuid();
  const db = createDb(c.env.DB);
  await db.insert(schema.actionDefinition).values({
    actionId,
    websiteId: website!.websiteId,
    name: parsed.data.name,
    description: parsed.data.description,
    rules: parsed.data.rules,
    createdAt: now,
    updatedAt: now,
  });

  const row = await getAction(c.env, website!.websiteId, actionId);
  await bumpActionDefinitionsVersion(c.env, website!.websiteId);
  return json(serializeAction(actionRow(row!)), 201);
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getAction(c.env, website!.websiteId, c.req.param('actionId') ?? '');
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateActionSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  await db
    .update(schema.actionDefinition)
    .set({
      name: parsed.data.name ?? row.name,
      description: parsed.data.description ?? row.description,
      rules: parsed.data.rules ?? row.rules,
      updatedAt: new Date(),
    })
    .where(eq(schema.actionDefinition.actionId, row.actionId));

  const updated = await getAction(c.env, website!.websiteId, row.actionId);
  await bumpActionDefinitionsVersion(c.env, website!.websiteId);
  return json(serializeAction(actionRow(updated!)));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getAction(c.env, website!.websiteId, c.req.param('actionId') ?? '');
  if (!row) return notFound();

  const db = createDb(c.env.DB);
  await db.delete(schema.actionDefinition).where(eq(schema.actionDefinition.actionId, row.actionId));
  await bumpActionDefinitionsVersion(c.env, website!.websiteId);
  return json({ ok: true });
}
