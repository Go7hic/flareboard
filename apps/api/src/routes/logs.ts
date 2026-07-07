import type { Context } from 'hono';
import {
  createLogAlertRuleSchema,
  createLogSavedFilterSchema,
  statsQuerySchema,
  updateLogAlertRuleSchema,
  updateLogSavedFilterSchema,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite, canMutateWebsite } from '../lib/access';
import {
  createLogAlertRule,
  createLogSavedFilter,
  deleteLogAlertRule,
  deleteLogSavedFilter,
  getLogAlertRule,
  getLogSavedFilter,
  getLogEvents,
  getLogStats,
  getLogTail,
  getServiceSummaries,
  getTraceDetail,
  getTraceSummaries,
  listLogAlertRules,
  listLogSavedFilters,
  updateLogAlertRule,
  updateLogSavedFilter,
} from '../lib/logs';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function parseRange(c: Ctx) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 24 * 60 * 60 * 1000;
  return { startAt, endAt };
}

async function requireWebsite(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return null;
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) return null;
  return website;
}

function normalizeOptionalParam(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

export async function handleList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const filters = {
    level: normalizeOptionalParam(c.req.query('level')),
    search: normalizeOptionalParam(c.req.query('q')),
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
  };
  const [stats, logs] = await Promise.all([
    getLogStats(c.env, website.websiteId, startAt, endAt, filters),
    getLogEvents(c.env, website.websiteId, startAt, endAt, filters),
  ]);
  return json({ stats, logs });
}

export async function handleTail(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();

  const sinceAt = Number(c.req.query('sinceAt') ?? 0);
  const limit = Number(c.req.query('limit') ?? 100);
  const filters = {
    level: normalizeOptionalParam(c.req.query('level')),
    search: normalizeOptionalParam(c.req.query('q')),
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
  };
  const logs = await getLogTail(c.env, website.websiteId, Number.isFinite(sinceAt) ? sinceAt : 0, filters, limit);
  const cursor = logs.reduce((latest, row) => Math.max(latest, row.createdAt), Number.isFinite(sinceAt) ? sinceAt : 0);
  return json({ cursor, logs });
}

export async function handleTraceList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const filters = {
    level: normalizeOptionalParam(c.req.query('level')),
    search: normalizeOptionalParam(c.req.query('q')),
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
  };
  const traces = await getTraceSummaries(c.env, website.websiteId, startAt, endAt, filters);
  return json({ traces });
}

export async function handleTraceDetail(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const traceId = c.req.param('traceId')?.trim();
  if (!traceId) return notFound();
  const trace = await getTraceDetail(c.env, website.websiteId, traceId);
  if (!trace) return notFound();
  return json(trace);
}

export async function handleServiceList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const filters = {
    level: normalizeOptionalParam(c.req.query('level')),
    search: normalizeOptionalParam(c.req.query('q')),
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
  };
  const services = await getServiceSummaries(c.env, website.websiteId, startAt, endAt, filters);
  return json({ services });
}

export async function handleSavedFilterList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const filters = await listLogSavedFilters(c.env, website.websiteId);
  return json({ filters });
}

export async function handleSavedFilterCreate(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createLogSavedFilterSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const filter = await createLogSavedFilter(c.env, website.websiteId, c.get('user').userId, parsed.data);
  return json(filter, 201);
}

export async function handleSavedFilterUpdate(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const filterId = c.req.param('filterId')?.trim();
  if (!filterId || !(await getLogSavedFilter(c.env, website.websiteId, filterId))) return notFound();
  const body = await c.req.json().catch(() => null);
  const parsed = updateLogSavedFilterSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const filter = await updateLogSavedFilter(c.env, website.websiteId, filterId, parsed.data);
  if (!filter) return notFound();
  return json(filter);
}

export async function handleSavedFilterDelete(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const filterId = c.req.param('filterId')?.trim();
  if (!filterId) return notFound();
  const deleted = await deleteLogSavedFilter(c.env, website.websiteId, filterId);
  if (!deleted) return notFound();
  return json({ ok: true });
}

export async function handleAlertRuleList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const alertRules = await listLogAlertRules(c.env, website.websiteId);
  return json({ alertRules });
}

export async function handleAlertRuleCreate(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createLogAlertRuleSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const alertRule = await createLogAlertRule(c.env, website.websiteId, parsed.data);
  return json(alertRule, 201);
}

export async function handleAlertRuleUpdate(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const alertRuleId = c.req.param('alertRuleId')?.trim();
  if (!alertRuleId || !(await getLogAlertRule(c.env, website.websiteId, alertRuleId))) return notFound();
  const body = await c.req.json().catch(() => null);
  const parsed = updateLogAlertRuleSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const alertRule = await updateLogAlertRule(c.env, website.websiteId, alertRuleId, parsed.data);
  if (!alertRule) return notFound();
  return json(alertRule);
}

export async function handleAlertRuleDelete(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const alertRuleId = c.req.param('alertRuleId')?.trim();
  if (!alertRuleId) return notFound();
  const deleted = await deleteLogAlertRule(c.env, website.websiteId, alertRuleId);
  if (!deleted) return notFound();
  return json({ ok: true });
}
