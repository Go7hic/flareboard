import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createWorkflowSchema, updateWorkflowSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getWorkflowExecutions, getWorkflowSummary } from '../lib/workflows';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

type WorkflowActionConfig = {
  note?: string;
  url?: string;
  email?: string;
};

function normalizeActionConfig(value: unknown): WorkflowActionConfig {
  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeActionConfig(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      note:
        typeof (value as WorkflowActionConfig).note === 'string'
          ? (value as WorkflowActionConfig).note
          : '',
      url:
        typeof (value as WorkflowActionConfig).url === 'string'
          ? (value as WorkflowActionConfig).url
          : '',
      email:
        typeof (value as WorkflowActionConfig).email === 'string'
          ? (value as WorkflowActionConfig).email
          : '',
    };
  }
  return {};
}

function serialize(row: typeof schema.workflow.$inferSelect) {
  return {
    id: row.workflowId,
    websiteId: row.websiteId,
    name: row.name,
    triggerEvent: row.triggerEvent,
    enabled: row.enabled,
    actionType: row.actionType,
    actionConfig: normalizeActionConfig(row.actionConfig),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getWorkflow(env: Env, websiteId: string, workflowId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.workflow)
    .where(eq(schema.workflow.workflowId, workflowId))
    .limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  return row;
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.workflow)
    .where(eq(schema.workflow.websiteId, website!.websiteId))
    .orderBy(schema.workflow.createdAt);

  const summaries = await Promise.all(
    rows.map((row) => getWorkflowSummary(c.env, website!.websiteId, row.workflowId)),
  );
  return json(rows.map((row, index) => ({ ...serialize(row), summary: summaries[index] })));
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createWorkflowSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  const workflowId = uuid();
  const now = new Date();
  await db.insert(schema.workflow).values({
    workflowId,
    websiteId: website!.websiteId,
    name: parsed.data.name,
    triggerEvent: parsed.data.triggerEvent,
    enabled: parsed.data.enabled,
    actionType: parsed.data.actionType,
    actionConfig: parsed.data.actionConfig,
    createdAt: now,
    updatedAt: now,
  });
  const row = await getWorkflow(c.env, website!.websiteId, workflowId);
  return json(serialize(row!), 201);
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const row = await getWorkflow(c.env, website!.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateWorkflowSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  await db
    .update(schema.workflow)
    .set({
      name: parsed.data.name ?? row.name,
      triggerEvent: parsed.data.triggerEvent ?? row.triggerEvent,
      enabled: parsed.data.enabled ?? row.enabled,
      actionType: parsed.data.actionType ?? row.actionType,
      actionConfig: parsed.data.actionConfig ?? row.actionConfig,
      updatedAt: new Date(),
    })
    .where(eq(schema.workflow.workflowId, row.workflowId));
  const updated = await getWorkflow(c.env, website!.websiteId, row.workflowId);
  return json(serialize(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const row = await getWorkflow(c.env, website!.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  const db = createDb(c.env.DB);
  await db.delete(schema.workflow).where(eq(schema.workflow.workflowId, row.workflowId));
  return json({ ok: true });
}

export async function handleExecutions(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website!.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  const status = c.req.query('status')?.trim();
  const event = c.req.query('event')?.trim();
  const search = c.req.query('q')?.trim();
  const filters = {
    status: status || undefined,
    event: event || undefined,
    search: search || undefined,
  };
  const [summary, executions] = await Promise.all([
    getWorkflowSummary(c.env, website!.websiteId, row.workflowId, filters),
    getWorkflowExecutions(c.env, website!.websiteId, row.workflowId, 100, filters),
  ]);
  return json({ workflow: serialize(row), summary, executions });
}
