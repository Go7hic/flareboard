import type { Context } from 'hono';
import {
  createErrorAlertRuleSchema,
  createErrorIssueCommentSchema,
  updateErrorAlertRuleSchema,
  updateErrorIssueStateSchema,
  uploadErrorSourceMapSchema,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite, userIdHasWebsiteAccess } from '../lib/access';
import { parseStatsRange } from '../lib/parse-range';
import { requireWebsite } from '../lib/website';
import {
  addErrorIssueComment,
  createErrorAlertRule,
  deleteErrorAlertRule,
  getErrorAlertRule,
  getErrorEvent,
  getErrorEvents,
  getErrorIssues,
  getErrorStats,
  listErrorAlertRules,
  listErrorSourceMaps,
  updateErrorAlertRule,
  updateErrorIssueState,
  upsertErrorSourceMap,
} from '../lib/errors';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function normalizeOptionalParam(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function parseIssueStatus(value: string | undefined): 'open' | 'resolved' | 'ignored' | undefined {
  if (value === 'open' || value === 'resolved' || value === 'ignored') return value;
  return undefined;
}


export async function handleList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const filters = {
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
    status: parseIssueStatus(c.req.query('status')),
  };
  const [stats, issues, errors] = await Promise.all([
    getErrorStats(c.env, website.websiteId, startAt, endAt, filters),
    getErrorIssues(c.env, website.websiteId, startAt, endAt, filters),
    getErrorEvents(c.env, website.websiteId, startAt, endAt, filters),
  ]);
  return json({ stats, issues, errors });
}

export async function handleGet(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const eventId = c.req.param('eventId');
  if (!eventId) return notFound();
  const event = await getErrorEvent(c.env, website.websiteId, eventId);
  if (!event) return notFound();
  return json(event);
}

export async function handleUpdateIssue(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateErrorIssueStateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  if (
    parsed.data.assigneeUserId &&
    !(await userIdHasWebsiteAccess(c.env, website, parsed.data.assigneeUserId))
  ) {
    return badRequest('Assignee does not have access to this website.');
  }

  const state = await updateErrorIssueState(
    c.env,
    website.websiteId,
    parsed.data.fingerprint,
    parsed.data.status,
    parsed.data.note,
    parsed.data.assigneeUserId,
  );
  return json(state);
}

export async function handleCreateIssueComment(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createErrorIssueCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const comment = await addErrorIssueComment(
    c.env,
    website.websiteId,
    parsed.data.fingerprint,
    c.get('user').userId,
    parsed.data.body,
  );
  return json(comment, 201);
}

export async function handleListSourceMaps(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();

  const release = normalizeOptionalParam(c.req.query('release'));
  const sourceMaps = await listErrorSourceMaps(c.env, website.websiteId, release);
  return json({ sourceMaps });
}

export async function handleUploadSourceMap(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = uploadErrorSourceMapSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const sourceMap = await upsertErrorSourceMap(
    c.env,
    website.websiteId,
    parsed.data.release,
    parsed.data.file,
    parsed.data.content,
  );
  return json(sourceMap, 201);
}

export async function handleListAlertRules(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();

  const alertRules = await listErrorAlertRules(c.env, website.websiteId);
  return json({ alertRules });
}

export async function handleCreateAlertRule(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createErrorAlertRuleSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const alertRule = await createErrorAlertRule(c.env, website.websiteId, parsed.data);
  return json(alertRule, 201);
}

export async function handleUpdateAlertRule(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const alertRuleId = c.req.param('alertRuleId');
  if (!alertRuleId || !(await getErrorAlertRule(c.env, website.websiteId, alertRuleId))) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateErrorAlertRuleSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const alertRule = await updateErrorAlertRule(c.env, website.websiteId, alertRuleId, parsed.data);
  if (!alertRule) return notFound();
  return json(alertRule);
}

export async function handleDeleteAlertRule(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const alertRuleId = c.req.param('alertRuleId');
  if (!alertRuleId) return notFound();
  const deleted = await deleteErrorAlertRule(c.env, website.websiteId, alertRuleId);
  if (!deleted) return notFound();
  return json({ ok: true });
}
