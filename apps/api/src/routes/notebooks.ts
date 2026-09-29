import type { Context } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createNotebookSchema, updateNotebookSchema, type NotebookContent } from '@flareboard/shared';
import type { Env } from '../env';
import { requireMutateWebsiteOr404, requireWebsiteOr404 } from '../lib/website';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;
type NotebookRow = typeof schema.notebook.$inferSelect;

function serializeNotebook(row: NotebookRow, withContent = true) {
  const content = row.content as NotebookContent | null;
  return {
    id: row.notebookId,
    websiteId: row.websiteId,
    title: row.title,
    ...(withContent ? { content: content ?? { blocks: [] } } : { blockCount: content?.blocks?.length ?? 0 }),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt?.getTime() ?? null,
    updatedAt: row.updatedAt?.getTime() ?? null,
  };
}

/** Insight blocks may only embed insights of the notebook's own website. */
async function contentProblem(env: Env, websiteId: string, content: NotebookContent): Promise<string | null> {
  const ids = [...new Set(content.blocks.flatMap((block) => (block.type === 'insight' ? [block.insightId] : [])))];
  if (!ids.length) return null;
  const db = createDb(env.DB);
  const rows = await db
    .select({ id: schema.insight.insightId })
    .from(schema.insight)
    .where(and(eq(schema.insight.websiteId, websiteId), inArray(schema.insight.insightId, ids)));
  const known = new Set(rows.map((row) => row.id));
  const missing = ids.find((id) => !known.has(id));
  return missing ? `Insight ${missing} is not part of this website` : null;
}

async function loadNotebook(c: Ctx, websiteId: string) {
  const db = createDb(c.env.DB);
  const [row] = await db
    .select()
    .from(schema.notebook)
    .where(and(eq(schema.notebook.notebookId, c.req.param('notebookId') ?? ''), eq(schema.notebook.websiteId, websiteId)))
    .limit(1);
  return row ?? null;
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.notebook)
    .where(eq(schema.notebook.websiteId, website!.websiteId))
    .orderBy(desc(schema.notebook.updatedAt));
  return json(rows.map((row) => serializeNotebook(row, false)));
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await loadNotebook(c, website!.websiteId);
  return row ? json(serializeNotebook(row)) : notFound();
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const parsed = createNotebookSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid notebook');
  const problem = await contentProblem(c.env, website!.websiteId, parsed.data.content);
  if (problem) return badRequest(problem);

  const now = new Date();
  const notebookId = crypto.randomUUID();
  const userId = c.get('user').userId;
  const db = createDb(c.env.DB);
  await db.insert(schema.notebook).values({
    notebookId,
    websiteId: website!.websiteId,
    title: parsed.data.title,
    content: parsed.data.content,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(schema.notebook).where(eq(schema.notebook.notebookId, notebookId)).limit(1);
  return json(serializeNotebook(row!), 201);
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const row = await loadNotebook(c, website!.websiteId);
  if (!row) return notFound();
  const parsed = updateNotebookSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid notebook');
  if (parsed.data.content) {
    const problem = await contentProblem(c.env, website!.websiteId, parsed.data.content);
    if (problem) return badRequest(problem);
  }
  const db = createDb(c.env.DB);
  await db
    .update(schema.notebook)
    .set({
      title: parsed.data.title ?? row.title,
      content: parsed.data.content ?? row.content,
      updatedBy: c.get('user').userId,
      updatedAt: new Date(),
    })
    .where(eq(schema.notebook.notebookId, row.notebookId));
  const [updated] = await db.select().from(schema.notebook).where(eq(schema.notebook.notebookId, row.notebookId)).limit(1);
  return json(serializeNotebook(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireMutateWebsiteOr404(c);
  if (response) return response;
  const row = await loadNotebook(c, website!.websiteId);
  if (!row) return notFound();
  const db = createDb(c.env.DB);
  await db.delete(schema.notebook).where(eq(schema.notebook.notebookId, row.notebookId));
  return json({ ok: true });
}
