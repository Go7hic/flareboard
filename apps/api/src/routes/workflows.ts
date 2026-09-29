import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  capWorkflowEventProperties,
  createWorkflowSchema,
  generateWorkflowSigningSecret,
  legacyWorkflowSteps,
  parseStoredWorkflowFilters,
  parseStoredWorkflowSteps,
  summarizeWorkflowActionType,
  updateWorkflowSchema,
  uuid,
  workflowStepsSchema,
  workflowTestRequestSchema,
  type WorkflowStep,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { logAdminAction } from '../lib/audit';
import { siteDb } from '../lib/site-db';
import {
  deleteWorkflowCascade,
  getWorkflowExecutionDetail,
  getWorkflowExecutions,
  getWorkflowSummary,
  type WorkflowExecutionFilters,
} from '../lib/workflows';
import { checkIpRateLimit } from '../lib/rate-limit';
import { WORKFLOW_TEST_SENDS_PER_HOUR, loadPersonProperties } from '../lib/workflow-runtime';
import { runWorkflowTest } from '../lib/workflow-test';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;
type WorkflowRow = typeof schema.workflow.$inferSelect;

const REDACTED = '••••••';

function legacyActionConfig(value: unknown): { note: string; url: string; email: string } {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    note: typeof config.note === 'string' ? config.note : '',
    url: typeof config.url === 'string' ? config.url : '',
    email: typeof config.email === 'string' ? config.email : '',
  };
}

/** Header values and Slack webhook URLs are credentials: only editors see them. */
function redactSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step) => {
    if (step.type === 'webhook') {
      return { ...step, headers: step.headers.map((header) => ({ key: header.key, value: REDACTED })) };
    }
    if (step.type === 'slack') return { ...step, webhookUrl: 'https://hooks.slack.com/' + REDACTED };
    return step;
  });
}

function secretPreview(secret: string | null) {
  return secret ? `whsec_…${secret.slice(-4)}` : null;
}

function serialize(row: WorkflowRow, canEdit: boolean) {
  const steps = parseStoredWorkflowSteps(row.steps);
  return {
    id: row.workflowId,
    websiteId: row.websiteId,
    name: row.name,
    description: row.description,
    triggerEvent: row.triggerEvent,
    enabled: row.enabled,
    filters: parseStoredWorkflowFilters(row.triggerFilters) ?? [],
    steps: canEdit ? (steps ?? []) : redactSteps(steps ?? []),
    /** False when the stored steps cannot be read (executions fail until the flow is saved again). */
    stepsValid: steps !== null,
    /** @deprecated summary of the steps for older clients. */
    actionType: row.actionType,
    /** @deprecated */
    actionConfig: legacyActionConfig(row.actionConfig),
    signingSecretPreview: secretPreview(row.signingSecret),
    signingSecretRotatedAt: row.signingSecretRotatedAt,
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

async function requireEditor(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return { website: null, response };
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return { website: null, response: json({ message: 'Read-only access' }, 403) };
  }
  return { website: website!, response: null };
}

function issuesMessage(error: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  return error.issues
    .slice(0, 5)
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

/** Legacy bodies (`actionType` + `actionConfig`) become steps, validated like new ones. */
function resolveSteps(input: {
  steps?: WorkflowStep[];
  actionType?: 'record' | 'webhook' | 'email';
  actionConfig?: { url?: string; email?: string };
}): { steps: WorkflowStep[] | undefined } | { error: string } {
  if (input.steps) return { steps: input.steps };
  if (!input.actionType) return { steps: undefined };
  const parsed = workflowStepsSchema.safeParse(legacyWorkflowSteps(input.actionType, input.actionConfig));
  return parsed.success ? { steps: parsed.data as WorkflowStep[] } : { error: issuesMessage(parsed.error) };
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const canEdit = await canMutateWebsite(c.env, website!, c.get('user'));
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.workflow)
    .where(eq(schema.workflow.websiteId, website!.websiteId))
    .orderBy(schema.workflow.createdAt);

  const summaries = await Promise.all(
    rows.map((row) => getWorkflowSummary(c.env, website!.websiteId, row.workflowId)),
  );
  return json(rows.map((row, index) => ({ ...serialize(row, canEdit), summary: summaries[index] })));
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireEditor(c);
  if (response) return response;
  const parsed = createWorkflowSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(issuesMessage(parsed.error));
  const resolved = resolveSteps(parsed.data);
  if ('error' in resolved) return badRequest(resolved.error);
  const steps = resolved.steps ?? [];

  const workflowId = uuid();
  const signingSecret = generateWorkflowSigningSecret();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.workflow).values({
    workflowId,
    websiteId: website.websiteId,
    name: parsed.data.name,
    description: parsed.data.description ?? parsed.data.actionConfig?.note ?? '',
    triggerEvent: parsed.data.triggerEvent,
    enabled: parsed.data.enabled,
    triggerFilters: JSON.stringify(parsed.data.filters ?? []),
    steps: JSON.stringify(steps),
    actionType: summarizeWorkflowActionType(steps),
    actionConfig: {},
    signingSecret,
    signingSecretRotatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await logAdminAction(c.env, c.get('user').userId, 'create', 'workflow', workflowId, {
    websiteId: website.websiteId,
    name: parsed.data.name,
  });
  const row = await getWorkflow(c.env, website.websiteId, workflowId);
  // The signing secret is returned once, here and on rotation.
  return json({ ...serialize(row!, true), signingSecret }, 201);
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireEditor(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();

  const parsed = updateWorkflowSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(issuesMessage(parsed.error));
  const resolved = resolveSteps(parsed.data);
  if ('error' in resolved) return badRequest(resolved.error);

  const db = createDb(c.env.DB);
  await db
    .update(schema.workflow)
    .set({
      name: parsed.data.name ?? row.name,
      description: parsed.data.description ?? row.description,
      triggerEvent: parsed.data.triggerEvent ?? row.triggerEvent,
      enabled: parsed.data.enabled ?? row.enabled,
      ...(parsed.data.filters ? { triggerFilters: JSON.stringify(parsed.data.filters) } : {}),
      ...(resolved.steps
        ? { steps: JSON.stringify(resolved.steps), actionType: summarizeWorkflowActionType(resolved.steps) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.workflow.workflowId, row.workflowId));
  await logAdminAction(c.env, c.get('user').userId, 'update', 'workflow', row.workflowId, {
    websiteId: website.websiteId,
    fields: Object.keys(parsed.data),
  });
  const updated = await getWorkflow(c.env, website.websiteId, row.workflowId);
  return json(serialize(updated!, true));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireEditor(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  // Pending executions notice the missing row at their next step and stop.
  await deleteWorkflowCascade(c.env, row.workflowId);
  await logAdminAction(c.env, c.get('user').userId, 'delete', 'workflow', row.workflowId, {
    websiteId: website.websiteId,
    name: row.name,
  });
  return json({ ok: true });
}

export async function handleRotateSecret(c: Ctx) {
  const { website, response } = await requireEditor(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  const signingSecret = generateWorkflowSigningSecret();
  const now = new Date();
  await createDb(c.env.DB)
    .update(schema.workflow)
    .set({ signingSecret, signingSecretRotatedAt: now, updatedAt: now })
    .where(eq(schema.workflow.workflowId, row.workflowId));
  await logAdminAction(c.env, c.get('user').userId, 'rotate_secret', 'workflow', row.workflowId, {
    websiteId: website.websiteId,
  });
  return json({ signingSecret, signingSecretPreview: secretPreview(signingSecret), signingSecretRotatedAt: now.getTime() });
}

function parseTime(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function handleExecutions(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website!.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  const canEdit = await canMutateWebsite(c.env, website!, c.get('user'));
  const filters: WorkflowExecutionFilters = {
    status: c.req.query('status')?.trim() || undefined,
    event: c.req.query('event')?.trim() || undefined,
    search: c.req.query('q')?.trim() || undefined,
    from: parseTime(c.req.query('from')),
    to: parseTime(c.req.query('to')),
  };
  const limit = Number(c.req.query('limit') ?? 100);
  const [summary, executions] = await Promise.all([
    getWorkflowSummary(c.env, website!.websiteId, row.workflowId, filters),
    getWorkflowExecutions(c.env, website!.websiteId, row.workflowId, Number.isFinite(limit) ? limit : 100, filters),
  ]);
  return json({ workflow: serialize(row, canEdit), summary, executions });
}

export async function handleExecutionDetail(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website!.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  const detail = await getWorkflowExecutionDetail(
    c.env,
    website!.websiteId,
    row.workflowId,
    c.req.param('executionId') ?? '',
  );
  return detail ? json(detail) : notFound();
}

/** Most recent stored event with the trigger name, to prefill the test form. */
async function latestTriggerEvent(env: Env, websiteId: string, eventName: string) {
  const db = siteDb(env, websiteId);
  const event = await db
    .prepare(
      `SELECT e.event_id as id, e.event_name as name, e.created_at as createdAt, e.session_id as sessionId,
              e.visit_id as visitId, e.hostname, e.url_path as urlPath, e.url_query as urlQuery,
              s.distinct_id as distinctId
       FROM website_event e
       LEFT JOIN session s ON s.session_id = e.session_id
       WHERE e.website_id = ?1 AND e.event_name = ?2
       ORDER BY e.created_at DESC
       LIMIT 1`,
    )
    .bind(websiteId, eventName)
    .first<{
      id: string;
      name: string;
      createdAt: number;
      sessionId: string | null;
      visitId: string | null;
      hostname: string | null;
      urlPath: string | null;
      urlQuery: string | null;
      distinctId: string | null;
    }>();
  if (!event) return null;
  const rows = await db
    .prepare(
      `SELECT data_key as dataKey, string_value as stringValue, number_value as numberValue,
              date_value as dateValue, data_type as dataType
       FROM event_data
       WHERE website_event_id = ?1
       LIMIT 200`,
    )
    .bind(event.id)
    .all<{ dataKey: string; stringValue: string | null; numberValue: number | null; dateValue: number | null; dataType: number }>();
  const properties: Record<string, unknown> = {};
  for (const item of rows.results ?? []) {
    if (item.dataKey.startsWith('$action/')) continue;
    properties[item.dataKey] =
      item.dataType === 2
        ? item.numberValue
        : item.dataType === 3
          ? item.stringValue === 'true'
          : item.dataType === 4 && item.dateValue != null
            ? new Date(item.dateValue).toISOString()
            : item.stringValue;
  }
  return { ...event, properties };
}

export async function handleSampleEvent(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website!.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  const event = await latestTriggerEvent(c.env, website!.websiteId, row.triggerEvent);
  return json({ event });
}

function splitUrl(raw: string | undefined, fallbackHost: string | null) {
  if (!raw?.trim()) return { hostname: fallbackHost, urlPath: '/', urlQuery: null };
  try {
    const url = new URL(raw.trim(), `https://${fallbackHost ?? 'example.com'}`);
    return { hostname: url.hostname, urlPath: url.pathname + url.hash, urlQuery: url.search.slice(1) || null };
  } catch {
    return { hostname: fallbackHost, urlPath: raw.trim(), urlQuery: null };
  }
}

export async function handleTest(c: Ctx) {
  const { website, response } = await requireEditor(c);
  if (response) return response;
  const row = await getWorkflow(c.env, website.websiteId, c.req.param('workflowId') ?? '');
  if (!row) return notFound();
  const parsed = workflowTestRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(issuesMessage(parsed.error));
  const body = parsed.data;

  const filters = body.filters ?? parseStoredWorkflowFilters(row.triggerFilters) ?? [];
  const steps = (body.steps as WorkflowStep[] | undefined) ?? parseStoredWorkflowSteps(row.steps);
  if (!steps) return badRequest('Stored workflow steps are unreadable; save the workflow again');

  if (body.send) {
    const cap = await checkIpRateLimit(c.env, 'workflow-test', website.websiteId, WORKFLOW_TEST_SENDS_PER_HOUR, 3600);
    if (!cap.allowed) {
      return json({ message: `Test sends are limited to ${WORKFLOW_TEST_SENDS_PER_HOUR} per hour per website` }, 429);
    }
  }

  const distinctId = body.event?.distinctId?.trim() || null;
  const stored = await loadPersonProperties(c.env, website.websiteId, distinctId);
  const location = splitUrl(body.event?.url, website.domain ?? null);
  const result = await runWorkflowTest(c.env, {
    website: { id: website.websiteId, name: website.name, domain: website.domain ?? null },
    workflow: { id: row.workflowId, name: row.name, filters, steps, signingSecret: row.signingSecret },
    event: {
      id: `test-${crypto.randomUUID()}`,
      name: body.event?.name || row.triggerEvent,
      createdAt: Date.now(),
      sessionId: null,
      visitId: null,
      distinctId,
      ...location,
      properties: capWorkflowEventProperties(body.event?.properties ?? {}),
    },
    personProperties: { ...stored, ...(body.personProperties ?? {}) },
    send: body.send,
  });
  return json(result);
}
