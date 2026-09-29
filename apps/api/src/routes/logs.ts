import type { Context } from 'hono';
import {
  createLogAlertRuleSchema,
  createLogSavedFilterSchema,
  updateLogAlertRuleSchema,
  updateLogSavedFilterSchema,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { parseStatsRange } from '../lib/parse-range';
import { requireWebsite } from '../lib/website';
import { logSources, SEVERITIES } from '../lib/log-sources';
import {
  createLogAlertRule,
  createLogSavedFilter,
  decodeTailCursor,
  deleteLogAlertRule,
  deleteLogSavedFilter,
  getLogAlertRule,
  getLogEvents,
  getLogHistogram,
  getLogSavedFilter,
  getLogStats,
  getServiceSummaries,
  getTraceDetail,
  getTraceSummaries,
  listLogAlertRules,
  listLogSavedFilters,
  tailLogs,
  updateLogAlertRule,
  updateLogSavedFilter,
  type AttributeFilter,
  type LogFilters,
  type LogPageCursor,
  type Severity,
} from '../lib/logs';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function normalizeOptionalParam(value: string | undefined, max = 200) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Filters shared by the log endpoints: `level` (one or more, comma-separated), `q` (body
 * substring), `release`, `environment`, `service`, `traceId`, `sessionId`, `source`
 * (`otlp` | `browser`) and repeatable `attr=key=value` (or `attr=key` for "is set").
 */
export function parseLogFilters(c: Ctx): LogFilters {
  const levels = (c.req.query('level') ?? '')
    .split(',')
    .map((level) => level.trim().toLowerCase())
    .filter((level): level is Severity => (SEVERITIES as readonly string[]).includes(level));
  const source = c.req.query('source');
  const attributes: AttributeFilter[] = (c.req.queries('attr') ?? [])
    .slice(0, 10)
    .map((raw) => {
      const separator = raw.indexOf('=');
      const key = (separator === -1 ? raw : raw.slice(0, separator)).trim().slice(0, 256);
      return separator === -1 ? { key } : { key, value: raw.slice(separator + 1).slice(0, 500) };
    })
    .filter((attribute) => attribute.key);
  return {
    levels: levels.length ? levels : undefined,
    search: normalizeOptionalParam(c.req.query('q')),
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
    service: normalizeOptionalParam(c.req.query('service')),
    traceId: normalizeOptionalParam(c.req.query('traceId')),
    sessionId: normalizeOptionalParam(c.req.query('sessionId')),
    source: source === 'otlp' || source === 'browser' ? source : undefined,
    attributes: attributes.length ? attributes : undefined,
  };
}

function parseLimit(value: string | undefined, fallback = 100) {
  const limit = Number(value ?? fallback);
  return Number.isFinite(limit) ? limit : fallback;
}

/** `before=<timeUs>:<id>`: continue the newest-first list after that line. */
function parseBefore(value: string | undefined): LogPageCursor | undefined {
  const match = /^(\d+):(.+)$/.exec(value ?? '');
  return match ? { timeUs: Number(match[1]), id: match[2]!.slice(0, 200) } : undefined;
}

export async function handleList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const filters = parseLogFilters(c);
  const limit = Math.min(Math.max(parseLimit(c.req.query('limit')), 1), 500);
  const before = parseBefore(c.req.query('before'));
  const [stats, logs] = await Promise.all([
    getLogStats(c.env, website.websiteId, startAt, endAt, filters),
    getLogEvents(c.env, website.websiteId, startAt, endAt, filters, limit, before),
  ]);
  const last = logs[logs.length - 1];
  return json({
    stats,
    logs,
    nextBefore: logs.length === limit && last ? `${last.timeUs}:${last.id}` : null,
    otlpEnabled: logSources(c.env, website.websiteId).otlp,
  });
}

export async function handleHistogram(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  return json(await getLogHistogram(c.env, website.websiteId, startAt, endAt, parseLogFilters(c)));
}

export async function handleTail(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();

  const sinceAt = Number(c.req.query('sinceAt') ?? 0);
  const result = await tailLogs(
    c.env,
    website.websiteId,
    Number.isFinite(sinceAt) ? sinceAt : 0,
    parseLogFilters(c),
    parseLimit(c.req.query('limit')),
    decodeTailCursor(c.req.query('seq')),
  );
  return json(result);
}

export async function handleTraceList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const filters = parseLogFilters(c);
  const traces = await getTraceSummaries(
    c.env,
    website.websiteId,
    startAt,
    endAt,
    {
      service: filters.service,
      environment: filters.environment,
      release: filters.release,
      search: filters.search,
      sessionId: filters.sessionId,
      traceId: filters.traceId,
      source: filters.source,
      errorsOnly: c.req.query('status') === 'error',
    },
    parseLimit(c.req.query('limit')),
  );
  return json({ traces });
}

export async function handleTraceDetail(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const traceId = c.req.param('traceId')?.trim();
  if (!traceId) return notFound();
  const trace = await getTraceDetail(c.env, website.websiteId, traceId.slice(0, 200));
  if (!trace) return notFound();
  return json(trace);
}

export async function handleServiceList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const services = await getServiceSummaries(c.env, website.websiteId, startAt, endAt, parseLogFilters(c));
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
