/**
 * One tool registry behind both the MCP server (routes/mcp.ts) and the "Ask Flareboard"
 * assistant (lib/assistant.ts). Every call goes through `callTool`, which validates the input,
 * checks the credential's scope, the caller's access to the website (and write access for
 * write tools) and hosted-plan gates, and turns every failure into `{ ok: false, error }` so
 * callers can hand it back to the model instead of throwing.
 *
 * Tool results are compact on purpose (row caps, trimmed strings, summarized insight series):
 * they are read by a language model, not by the dashboard. The dashboard renders `display`.
 */
import { and, eq } from 'drizzle-orm';
import { createDb, schema, type Website } from '@flareboard/db';
import {
  AI_ANNOTATION_CATEGORIES,
  AI_INSIGHT_TYPES,
  AI_RANGE_PRESETS,
  AI_TOOL_LIMITS,
  aiToolInputError,
  aiToolInputSchemas,
  getPlan,
  parseInsightQuery,
  uuid,
  type AiInsightType,
  type AiRangePreset,
  type AiToolDisplay,
  type AiToolInput,
  type AiToolName,
  type AuthUser,
  type InsightResult,
  type PlanDefinition,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite, canMutateWebsite } from './access';
import { logAdminAction } from './audit';
import { getWebsitePlanId, isHostedMode } from './billing';
import { getErrorOverview } from './errors';
import { getEventCatalog } from './event-catalog';
import {
  evaluateAllFeatureFlags,
  invalidateFeatureFlagCaches,
  loadWebsiteFlagRows,
  recordFeatureFlagChange,
  serializeFeatureFlag,
} from './feature-flags';
import { runInsightQuery } from './insights';
import { listPeople } from './people';
import { listPropertyKeys, listPropertyValues } from './property-discovery';
import { InsightQueryError } from './property-filters';
import { getAccessibleWebsites, getWebsiteById } from './queries';
import { getWarehouseSchema, recordWarehouseQueryHistory, runWarehouseQuery } from './warehouse';
import {
  computeResults as computeExperimentResults,
  EXPERIMENT_COLUMNS,
  serialize as serializeExperiment,
  type ExperimentRow,
} from '../routes/experiments';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type ToolScope = 'read' | 'write';
export type ToolChannel = 'mcp' | 'assistant';

export type ToolCaller = {
  user: AuthUser;
  /** Scopes of the credential (API key scopes; the assistant passes `['read']`). */
  scopes: readonly ToolScope[];
  channel: ToolChannel;
  /** When set (assistant), the only website the tools may touch; `websiteId` is injected. */
  websiteId?: string;
};

export type ToolDisplay = AiToolDisplay;

export type ToolOutcome =
  | { ok: true; data: unknown; display?: ToolDisplay }
  | { ok: false; error: string };

type JsonSchema = Record<string, unknown>;

type ToolRunContext = { env: Env; caller: ToolCaller; website: Website | null };
type ToolRunResult = { data: unknown; display?: ToolDisplay };

type ToolSpec<N extends AiToolName> = {
  name: N;
  title: string;
  description: string;
  scope: ToolScope;
  /** Takes a `websiteId` the caller must be able to access. */
  websiteScoped: boolean;
  /** Plan feature the website's owner needs in hosted mode. */
  planFeature?: keyof Pick<PlanDefinition, 'warehouseEnabled' | 'experimentationEnabled'>;
  /** Not offered by the dashboard assistant. */
  mcpOnly?: boolean;
  /** Input properties other than `websiteId`. */
  properties: Record<string, JsonSchema>;
  required?: string[];
  run(ctx: ToolRunContext, input: AiToolInput<N>): Promise<ToolRunResult>;
};

/** An error whose message is safe and useful to show the model / MCP client. */
export class ToolError extends Error {}

export class UnknownToolError extends Error {}

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

export const TOOL_LIMITS = {
  /** Rows of a SQL result returned to the model and rendered. */
  sqlRows: 100,
  /** Longest string value kept in a row. */
  cellChars: 300,
  /** Series points kept per trend line; longer series are summarized. */
  trendPoints: 62,
  trendSeries: 12,
  people: AI_TOOL_LIMITS.people,
  eventNames: 100,
  errorIssues: AI_TOOL_LIMITS.errorIssues,
  flags: 100,
  experiments: 10,
} as const;

const DAY_MS = 86_400_000;
const RANGE_PRESETS = AI_RANGE_PRESETS;
type RangePreset = AiRangePreset;

// ---------------------------------------------------------------------------------------------
// Shared schema pieces
// ---------------------------------------------------------------------------------------------

const WEBSITE_ID_PROPERTY: JsonSchema = {
  type: 'string',
  description: 'Website id (from list_websites).',
};

const RANGE_PROPERTIES: Record<string, JsonSchema> = {
  range: {
    type: 'string',
    enum: Object.keys(RANGE_PRESETS),
    description: 'Relative date range ending now. Ignored when dateFrom is given. Default 30d.',
  },
  dateFrom: { type: 'string', description: 'Start, ISO 8601 date or datetime (UTC), e.g. 2026-09-01.' },
  dateTo: { type: 'string', description: 'End, ISO 8601 date or datetime (UTC). A date means the end of that day. Default now.' },
};

type RangeInput = { range?: RangePreset; dateFrom?: string; dateTo?: string };

function parseDate(value: string, endOfDay: boolean): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new ToolError(`Invalid date "${value}". Use ISO 8601, e.g. 2026-09-01.`);
  return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? ms + DAY_MS - 1 : ms;
}

function resetFloor(website: Website | null): number {
  const reset = website?.resetAt instanceof Date ? website.resetAt.getTime() : Number(website?.resetAt ?? 0);
  return Number.isFinite(reset) ? reset : 0;
}

/** Date range of a tool call, floored at the website's statistics reset. */
export function resolveToolRange(input: RangeInput, website: Website | null, defaultRange: RangePreset = '30d', now = Date.now()) {
  const endAt = input.dateTo ? Math.min(parseDate(input.dateTo, true), now) : now;
  const requested = input.dateFrom ? parseDate(input.dateFrom, false) : endAt - RANGE_PRESETS[input.range ?? defaultRange];
  if (requested > endAt) throw new ToolError('dateFrom must be before dateTo.');
  const reset = resetFloor(website);
  const startAt = reset > 0 ? Math.min(Math.max(requested, reset), endAt) : requested;
  return { startAt, endAt };
}

function trimString(value: string, max: number = TOOL_LIMITS.cellChars) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Row values the model can read: long strings trimmed, blobs dropped. */
function compactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string') out[key] = trimString(value);
    else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) out[key] = '[binary]';
    else if (value && typeof value === 'object') out[key] = trimString(JSON.stringify(value));
    else out[key] = value;
  }
  return out;
}

function isoOrNull(ms: number | Date | null | undefined) {
  if (ms == null) return null;
  const value = ms instanceof Date ? ms.getTime() : Number(ms);
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

// ---------------------------------------------------------------------------------------------
// Insight summaries for the model
// ---------------------------------------------------------------------------------------------

export const INSIGHT_TOOL_TYPES = AI_INSIGHT_TYPES;
export type InsightToolType = AiInsightType;

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** The numbers of an insight result, bounded in size. */
export function summarizeInsightResult(result: InsightResult): unknown {
  const range = { from: isoOrNull(result.startAt), to: isoOrNull(result.endAt) };
  if (result.kind === 'trend') {
    const fullSeries = result.labels.length <= TOOL_LIMITS.trendPoints;
    const lines = result.results.slice(0, TOOL_LIMITS.trendSeries).map((line) => ({
      key: line.key,
      label: line.label,
      math: line.math,
      ...(line.breakdownValue !== undefined || line.isOther ? { breakdownValue: line.isOther ? '(other)' : line.breakdownValue } : {}),
      total: round(line.total),
      ...(fullSeries
        ? { data: line.data.map(round) }
        : { min: round(Math.min(...line.data)), max: round(Math.max(...line.data)), last: round(line.data.at(-1) ?? 0) }),
    }));
    return {
      kind: 'trend',
      ...range,
      interval: result.interval,
      ...(fullSeries
        ? { labels: result.labels }
        : { buckets: result.labels.length, firstBucket: result.labels[0], lastBucket: result.labels.at(-1), note: 'Series too long to list; totals, min, max and last value shown. Use a coarser interval for the full series.' }),
      formula: result.formula,
      series: lines,
      ...(result.results.length > lines.length ? { omittedSeries: result.results.length - lines.length } : {}),
      ...(result.compare
        ? { previousPeriod: result.compare.results.slice(0, TOOL_LIMITS.trendSeries).map((line) => ({ key: line.key, breakdownValue: line.breakdownValue, total: round(line.total) })) }
        : {}),
    };
  }
  if (result.kind === 'funnel') {
    const steps = (list: typeof result.steps) =>
      list.map((step) => ({
        step: step.index + 1,
        label: step.label,
        count: step.count,
        conversionRatePercent: round(step.conversionRate),
        fromPreviousPercent: round(step.rate),
        medianTimeToConvertMs: step.medianTimeToConvertMs,
      }));
    return {
      kind: 'funnel',
      ...range,
      countBy: result.countBy,
      order: result.order,
      conversionPercent: round(result.conversion),
      steps: steps(result.steps),
      ...(result.breakdown
        ? {
            breakdown: result.breakdown.slice(0, 10).map((row) => ({
              value: row.isOther ? '(other)' : row.value,
              conversionPercent: round(row.conversion),
              counts: row.steps.map((step) => step.count),
            })),
          }
        : {}),
    };
  }
  if (result.kind === 'retention') {
    return {
      kind: 'retention',
      ...range,
      period: result.period,
      countBy: result.countBy,
      note: 'values[i] = units of the cohort active in period i (values[0] = cohort size).',
      cohorts: result.cohorts.slice(0, 12).map((cohort) => ({ cohort: cohort.cohort, size: cohort.size, values: cohort.values })),
    };
  }
  return { kind: result.kind };
}

const FILTER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['event', 'person', 'dimension'], description: 'event: custom event property, person: person property, dimension: built-in column.' },
    key: {
      type: 'string',
      description:
        'Property key. Dimensions: path, hostname, page_title, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, event, tag, browser, os, device, screen, country, region, city, language.',
    },
    operator: { type: 'string', enum: ['is', 'is_not', 'contains', 'not_contains', 'regex', 'not_regex', 'is_set', 'is_not_set', 'gt', 'lt', 'between'] },
    value: { description: 'String, number or boolean; an array for is / is_not (up to 10) and [min, max] for between. Omit for is_set / is_not_set.' },
  },
  required: ['type', 'key', 'operator'],
};

const EVENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['event', 'pageview', 'all'], description: 'event: custom events (one name via `event`), pageview: pageviews (optionally URL-matched), all: both.' },
    event: { type: 'string', description: 'Custom event name, for kind=event.' },
    url: {
      type: 'object',
      properties: { match: { type: 'string', enum: ['exact', 'contains', 'regex'] }, value: { type: 'string' } },
      required: ['match', 'value'],
      description: 'Page URL path match, for kind=pageview.',
    },
    filters: { type: 'array', items: FILTER_SCHEMA },
    label: { type: 'string' },
  },
};

const INSIGHT_QUERY_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'Insight query (version 2). trend: `series` (1-5) with optional `formula`, `interval`, `breakdown`, `compare`. funnel: `funnel.steps` (2-20). retention: `retention.startEvent` / `returnEvent`. `filters` apply to everything.',
  properties: {
    series: {
      type: 'array',
      maxItems: 5,
      items: {
        ...EVENT_SCHEMA,
        properties: {
          ...(EVENT_SCHEMA.properties as Record<string, JsonSchema>),
          math: { type: 'string', enum: ['total', 'unique_users', 'unique_sessions', 'sum', 'avg', 'min', 'max', 'median'], description: 'Default total. sum..median need mathProperty.' },
          mathProperty: { type: 'string', description: 'Numeric event property for sum / avg / min / max / median.' },
        },
      },
    },
    formula: { type: 'string', description: 'Trend formula over series letters, e.g. "A / B * 100".' },
    interval: { type: 'string', enum: ['hour', 'day', 'week', 'month'] },
    compare: { type: 'boolean', description: 'Trends: also return the previous period.' },
    breakdown: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['event', 'person', 'dimension'] }, key: { type: 'string' } },
      required: ['type', 'key'],
    },
    filters: { type: 'array', items: FILTER_SCHEMA },
    countBy: { type: 'string', enum: ['person', 'session'], description: 'Unit of funnels and retention. Default person.' },
    funnel: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: EVENT_SCHEMA, maxItems: 20 },
        window: {
          type: 'object',
          properties: { value: { type: 'integer' }, unit: { type: 'string', enum: ['minute', 'hour', 'day', 'week'] } },
          required: ['value', 'unit'],
          description: 'Conversion window, 1 minute to 90 days. Default 14 days.',
        },
        order: { type: 'string', enum: ['strict', 'any'] },
      },
    },
    retention: {
      type: 'object',
      properties: {
        startEvent: EVENT_SCHEMA,
        returnEvent: EVENT_SCHEMA,
        period: { type: 'string', enum: ['day', 'week', 'month'] },
        periods: { type: 'integer', minimum: 2, maximum: 12 },
      },
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

function defineTool<N extends AiToolName>(spec: ToolSpec<N>): ToolSpec<N> {
  return spec;
}

const listWebsitesTool = defineTool({
  name: 'list_websites',
  title: 'List websites',
  description: 'Lists the websites (projects) you can access, with their ids. Call this first to find the websiteId other tools need.',
  scope: 'read',
  websiteScoped: false,
  mcpOnly: true,
  properties: {},
  async run({ env, caller }) {
    const websites = await getAccessibleWebsites(env, caller.user.userId);
    return {
      data: {
        websites: websites.map((website) => ({
          id: website.websiteId,
          name: website.name,
          domain: website.domain ?? null,
          timezone: website.timezone ?? 'UTC',
        })),
      },
    };
  },
});

const runInsightTool = defineTool({
  name: 'run_insight',
  title: 'Run an insight',
  description:
    'Runs a trend, funnel or retention insight and returns its numbers. Use this for questions about counts, unique users, conversion or retention over time. Discover event names and property keys first with list_event_names / list_property_keys; pageviews use kind "pageview".',
  scope: 'read',
  websiteScoped: true,
  properties: {
    type: { type: 'string', enum: [...INSIGHT_TOOL_TYPES] },
    query: INSIGHT_QUERY_SCHEMA,
    ...RANGE_PROPERTIES,
  },
  required: ['type', 'query'],
  async run({ env, website }, input) {
    const parsed = parseInsightQuery(input.type, { ...input.query, version: 2 });
    if (!parsed.ok) throw new ToolError(`Invalid query: ${parsed.error}`);
    const query = parsed.query;
    if (input.type === 'trend' && !query.series?.length) throw new ToolError('A trend needs at least one series.');
    if (input.type === 'funnel' && (query.funnel?.steps.length ?? 0) < 2) throw new ToolError('A funnel needs at least two steps.');
    const { startAt, endAt } = resolveToolRange(input, website);
    const result = await runInsightQuery(env, website!.websiteId, input.type, query, startAt, endAt, {
      timezone: website!.timezone ?? 'UTC',
      minStartAt: resetFloor(website) || null,
    });
    return {
      data: summarizeInsightResult(result),
      display: { kind: 'insight', insightType: input.type, query, startAt: result.startAt, endAt: result.endAt, result },
    };
  },
});

const listEventNamesTool = defineTool({
  name: 'list_event_names',
  title: 'List event names',
  description: 'Lists custom event names seen on the website in a date range, with counts and their property keys. Pageviews are not custom events.',
  scope: 'read',
  websiteScoped: true,
  properties: { search: { type: 'string', description: 'Only names containing this text.' }, ...RANGE_PROPERTIES },
  async run({ env, website }, input) {
    const { startAt, endAt } = resolveToolRange(input, website);
    const rows = await getEventCatalog(env, website!.websiteId, startAt, endAt, { search: input.search });
    return {
      data: {
        events: rows.slice(0, TOOL_LIMITS.eventNames).map((row) => ({
          name: row.eventName,
          events: row.events,
          sessions: row.sessions,
          lastSeenAt: isoOrNull(row.lastSeenAt),
          propertyKeys: row.propertyKeys.slice(0, 30),
        })),
        truncated: rows.length > TOOL_LIMITS.eventNames,
      },
    };
  },
});

const listPropertyKeysTool = defineTool({
  name: 'list_property_keys',
  title: 'List property keys',
  description: 'Lists observed event property keys (type=event) or person property keys (type=person), most common first, with whether they are numeric.',
  scope: 'read',
  websiteScoped: true,
  properties: { type: { type: 'string', enum: ['event', 'person'] }, ...RANGE_PROPERTIES },
  required: ['type'],
  async run({ env, website }, input) {
    const { startAt, endAt } = resolveToolRange(input, website);
    return { data: { keys: await listPropertyKeys(env, website!.websiteId, input.type, startAt, endAt) } };
  },
});

const listPropertyValuesTool = defineTool({
  name: 'list_property_values',
  title: 'List property values',
  description: 'Lists the most common values of one event property, person property or built-in dimension (e.g. country, browser, path).',
  scope: 'read',
  websiteScoped: true,
  properties: {
    type: { type: 'string', enum: ['event', 'person', 'dimension'] },
    key: { type: 'string' },
    search: { type: 'string', description: 'Only values containing this text.' },
    ...RANGE_PROPERTIES,
  },
  required: ['type', 'key'],
  async run({ env, website }, input) {
    const { startAt, endAt } = resolveToolRange(input, website);
    const values = await listPropertyValues(env, website!.websiteId, input.type, input.key, startAt, endAt, input.search);
    return { data: { values: values.map((row) => ({ value: trimString(row.value), count: row.count })) } };
  },
});

const getSqlSchemaTool = defineTool({
  name: 'get_sql_schema',
  title: 'Get the SQL schema',
  description: 'Returns the tables and columns run_sql can query. Call it before writing SQL.',
  scope: 'read',
  websiteScoped: true,
  planFeature: 'warehouseEnabled',
  properties: {},
  async run() {
    return { data: getWarehouseSchema() };
  },
});

const runSqlTool = defineTool({
  name: 'run_sql',
  title: 'Run a read-only SQL query',
  description:
    'Runs one read-only SQLite SELECT over the website’s analytics tables (see get_sql_schema). Always filter `website_id = ?1`. Timestamps are integer milliseconds. Results are capped at 100 rows; use aggregates (COUNT, GROUP BY) rather than listing raw rows.',
  scope: 'read',
  websiteScoped: true,
  planFeature: 'warehouseEnabled',
  properties: { sql: { type: 'string', description: 'A single SELECT statement.' } },
  required: ['sql'],
  async run({ env, caller, website }, input) {
    const websiteId = website!.websiteId;
    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof runWarehouseQuery>>;
    try {
      result = await runWarehouseQuery(env, websiteId, input.sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordWarehouseQueryHistory(env, websiteId, caller.user.userId, {
        sql: input.sql,
        status: 'failed',
        rowCount: 0,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      throw new ToolError(message);
    }
    await recordWarehouseQueryHistory(env, websiteId, caller.user.userId, {
      sql: input.sql,
      status: 'success',
      rowCount: result.rowCount,
      error: null,
      durationMs: Date.now() - startedAt,
    });
    const rows = result.rows.slice(0, TOOL_LIMITS.sqlRows).map(compactRow);
    const truncated = result.rows.length > rows.length;
    return {
      data: { columns: result.columns, rows, rowCount: result.rowCount, truncated },
      display: { kind: 'table', title: 'SQL', columns: result.columns, rows, truncated },
    };
  },
});

const searchPeopleTool = defineTool({
  name: 'search_people',
  title: 'Search people',
  description: 'Finds people (identified users or anonymous visitors) active in a date range, most recent first. Optionally matches the id, email or name.',
  scope: 'read',
  websiteScoped: true,
  properties: {
    search: { type: 'string', description: 'Text to match against the distinct id, email or name.' },
    limit: { type: 'integer', minimum: 1, maximum: TOOL_LIMITS.people, description: `Default 10, at most ${TOOL_LIMITS.people}.` },
    ...RANGE_PROPERTIES,
  },
  async run({ env, website }, input) {
    const { startAt, endAt } = resolveToolRange(input, website);
    const people = await listPeople(env, website!.websiteId, startAt, endAt, input.limit ?? 10, {
      search: input.search || undefined,
    });
    const rows = people.map((person) => ({
      id: person.personId,
      email: person.latestEmail,
      name: person.latestName,
      lastSeenAt: isoOrNull(person.lastSeenAt),
      sessions: person.sessions,
      pageviews: person.pageviews,
      events: person.events,
      country: person.country,
    }));
    return {
      data: { people: rows },
      display: {
        kind: 'table',
        title: 'People',
        columns: ['id', 'email', 'name', 'lastSeenAt', 'sessions', 'events'],
        rows,
        truncated: false,
      },
    };
  },
});

const listErrorIssuesTool = defineTool({
  name: 'list_error_issues',
  title: 'List error issues',
  description: 'Returns error totals and the top error issues (grouped exceptions) in a date range, most frequent first.',
  scope: 'read',
  websiteScoped: true,
  properties: {
    status: { type: 'string', enum: ['open', 'resolved', 'ignored', 'regressed'] },
    limit: { type: 'integer', minimum: 1, maximum: TOOL_LIMITS.errorIssues },
    ...RANGE_PROPERTIES,
  },
  async run({ env, website }, input) {
    const { startAt, endAt } = resolveToolRange(input, website, '7d');
    const overview = await getErrorOverview(env, website!.websiteId, startAt, endAt, { status: input.status });
    const issues = overview.issues.slice(0, input.limit ?? 10).map((issue) => ({
      fingerprint: issue.fingerprint,
      name: issue.name,
      message: issue.message ? trimString(issue.message, 200) : null,
      status: issue.status,
      events: issue.events,
      users: issue.users,
      sessions: issue.sessions,
      firstSeenAt: isoOrNull(issue.firstSeenAt),
      lastSeenAt: isoOrNull(issue.lastSeenAt),
    }));
    return {
      data: {
        totals: {
          errors: overview.stats.errors,
          sessions: overview.stats.sessions,
          users: overview.stats.users,
        },
        issues,
      },
      display: {
        kind: 'table',
        title: 'Errors',
        columns: ['name', 'message', 'status', 'events', 'users', 'lastSeenAt'],
        rows: issues,
        truncated: false,
      },
    };
  },
});

const listFeatureFlagsTool = defineTool({
  name: 'list_feature_flags',
  title: 'List feature flags',
  description: 'Lists the website’s feature flags with their key, state, rollout and variants.',
  scope: 'read',
  websiteScoped: true,
  planFeature: 'experimentationEnabled',
  properties: {},
  async run({ env, website }) {
    const rows = await loadWebsiteFlagRows(env, website!.websiteId);
    return {
      data: {
        flags: rows.slice(0, TOOL_LIMITS.flags).map((row) => {
          const flag = serializeFeatureFlag(row);
          return {
            key: flag.key,
            name: flag.name,
            enabled: flag.enabled,
            rolloutPercent: flag.rollout,
            conditionGroups: flag.conditionGroups.length,
            variants: flag.variants.map((variant) => ({ key: variant.key, weight: variant.weight })),
            updatedAt: isoOrNull(flag.updatedAt),
          };
        }),
      },
    };
  },
});

const evaluateFlagTool = defineTool({
  name: 'evaluate_feature_flag',
  title: 'Evaluate a feature flag',
  description: 'Evaluates one feature flag for a distinct id, using stored person properties (plus any given), and explains the result. Records no exposure.',
  scope: 'read',
  websiteScoped: true,
  planFeature: 'experimentationEnabled',
  properties: {
    key: { type: 'string', description: 'Flag key.' },
    distinctId: { type: 'string' },
    personProperties: { type: 'object', description: 'Extra person properties, merged over the stored ones.' },
  },
  required: ['key', 'distinctId'],
  async run({ env, website }, input) {
    const [row] = await loadWebsiteFlagRows(env, website!.websiteId, [input.key]);
    if (!row) throw new ToolError(`No feature flag with key "${input.key}".`);
    const decision = await evaluateAllFeatureFlags(env, website!.websiteId, {
      distinctId: input.distinctId,
      keys: [input.key],
      personProperties: input.personProperties,
    });
    return { data: { key: input.key, distinctId: input.distinctId, value: decision.featureFlags[input.key], result: decision.flags[input.key] } };
  },
});

const listExperimentsTool = defineTool({
  name: 'list_experiments',
  title: 'List experiments',
  description: 'Lists experiments (newest first) with their status, metrics and current results: decision, leading variant, lift and significance.',
  scope: 'read',
  websiteScoped: true,
  planFeature: 'experimentationEnabled',
  properties: { status: { type: 'string', enum: ['draft', 'running', 'completed'] } },
  async run({ env, website }, input) {
    const websiteId = website!.websiteId;
    const rows = await env.DB.prepare(
      `SELECT ${EXPERIMENT_COLUMNS}
       FROM experiment e
       INNER JOIN feature_flag f ON f.flag_id = e.feature_flag_id
       WHERE e.website_id = ?1 AND (?2 IS NULL OR e.status = ?2)
       ORDER BY e.created_at DESC
       LIMIT ${TOOL_LIMITS.experiments}`,
    )
      .bind(websiteId, input.status ?? null)
      .all<ExperimentRow>();
    const experiments = [];
    for (const row of rows.results ?? []) {
      const experiment = serializeExperiment(row);
      const base = {
        name: experiment.name,
        status: experiment.status,
        featureFlagKey: experiment.featureFlagKey ?? null,
        primaryMetric: experiment.primaryMetric,
        startedAt: isoOrNull(experiment.startedAt),
        endedAt: isoOrNull(experiment.endedAt),
      };
      if (experiment.status === 'draft' || !row.flagKey) {
        experiments.push(base);
        continue;
      }
      const results = await computeExperimentResults(env, websiteId, row);
      experiments.push({
        ...base,
        summary: {
          decision: results.summary.decision,
          totalUnits: results.summary.totalUnits,
          leaderVariant: results.summary.leaderVariant,
          leaderLift: results.summary.leaderLift,
          significantVariant: results.summary.significantVariant,
          bayesianLeader: results.summary.bayesianLeader,
          bayesianLeaderProbability: results.summary.bayesianLeaderProbability,
          minimumSampleReached: results.summary.minimumSampleReached,
        },
        metrics: results.metrics.map((metric) => ({
          role: metric.role,
          metric: metric.metric,
          variants: metric.variants.map((variant) => ({
            variant: variant.variant,
            baseline: variant.baseline,
            sampleSize: variant.sampleSize,
            value: variant.value,
            lift: variant.comparison?.lift ?? null,
            pValue: variant.comparison?.frequentist.pValue ?? null,
            probabilityToBeatControl: variant.comparison?.bayesian.probabilityToBeatControl ?? null,
          })),
        })),
      });
    }
    return { data: { experiments } };
  },
});

const createAnnotationTool = defineTool({
  name: 'create_annotation',
  title: 'Create an annotation',
  description: 'Adds an annotation (a dated note shown on charts), e.g. a release or campaign. Needs the write scope.',
  scope: 'write',
  websiteScoped: true,
  mcpOnly: true,
  properties: {
    title: { type: 'string', maxLength: 160 },
    description: { type: 'string', maxLength: 1000 },
    category: { type: 'string', enum: [...AI_ANNOTATION_CATEGORIES] },
    happenedAt: { type: 'string', description: 'When it happened, ISO 8601. Default now.' },
  },
  required: ['title'],
  async run({ env, caller, website }, input) {
    const happenedAt = input.happenedAt ? parseDate(input.happenedAt, false) : Date.now();
    const annotationId = uuid();
    const now = new Date();
    await createDb(env.DB).insert(schema.annotation).values({
      annotationId,
      websiteId: website!.websiteId,
      userId: caller.user.userId,
      title: input.title,
      description: input.description ?? '',
      category: input.category ?? 'note',
      happenedAt: new Date(happenedAt),
      createdAt: now,
      updatedAt: now,
    });
    await logAdminAction(env, caller.user.userId, 'create', 'annotation', annotationId, {
      websiteId: website!.websiteId,
      title: input.title,
      via: caller.channel,
    });
    return { data: { id: annotationId, title: input.title, category: input.category ?? 'note', happenedAt: isoOrNull(happenedAt) } };
  },
});

const toggleFeatureFlagTool = defineTool({
  name: 'toggle_feature_flag',
  title: 'Turn a feature flag on or off',
  description: 'Enables or disables a feature flag by key. The change is recorded in the flag history. Needs the write scope.',
  scope: 'write',
  websiteScoped: true,
  mcpOnly: true,
  planFeature: 'experimentationEnabled',
  properties: { key: { type: 'string' }, enabled: { type: 'boolean' } },
  required: ['key', 'enabled'],
  async run({ env, caller, website }, input) {
    const websiteId = website!.websiteId;
    const [before] = await loadWebsiteFlagRows(env, websiteId, [input.key]);
    if (!before) throw new ToolError(`No feature flag with key "${input.key}".`);
    if (before.enabled === input.enabled) {
      return { data: { key: input.key, enabled: input.enabled, changed: false } };
    }
    const db = createDb(env.DB);
    await db
      .update(schema.featureFlag)
      .set({ enabled: input.enabled, updatedAt: new Date() })
      .where(and(eq(schema.featureFlag.flagId, before.flagId), eq(schema.featureFlag.websiteId, websiteId)));
    const [after] = await loadWebsiteFlagRows(env, websiteId, [input.key]);
    await recordFeatureFlagChange(env, caller.user.userId, 'update', before, after ?? null, { via: caller.channel });
    await invalidateFeatureFlagCaches(env, websiteId);
    return { data: { key: input.key, enabled: input.enabled, changed: true } };
  },
});

// The order is part of the prompt-cache prefix: keep it stable.
const TOOLS: ReadonlyArray<ToolSpec<AiToolName>> = [
  listWebsitesTool,
  runInsightTool,
  listEventNamesTool,
  listPropertyKeysTool,
  listPropertyValuesTool,
  getSqlSchemaTool,
  runSqlTool,
  searchPeopleTool,
  listErrorIssuesTool,
  listFeatureFlagsTool,
  evaluateFlagTool,
  listExperimentsTool,
  createAnnotationTool,
  toggleFeatureFlagTool,
];

// ---------------------------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------------------------

export type ToolDescriptor = {
  name: string;
  title: string;
  description: string;
  scope: ToolScope;
  inputSchema: JsonSchema;
};

function inputSchema(tool: ToolSpec<AiToolName>, withWebsiteId: boolean): JsonSchema {
  const properties = withWebsiteId && tool.websiteScoped ? { websiteId: WEBSITE_ID_PROPERTY, ...tool.properties } : tool.properties;
  const required = [...(withWebsiteId && tool.websiteScoped ? ['websiteId'] : []), ...(tool.required ?? [])];
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/**
 * Tools the caller may use: write tools only with the write scope. The assistant (bound to one
 * website) gets read tools without the `websiteId` parameter.
 */
export function listTools(caller: Pick<ToolCaller, 'scopes' | 'channel' | 'websiteId'>): ToolDescriptor[] {
  return TOOLS.filter((tool) => caller.scopes.includes(tool.scope))
    .filter((tool) => !(caller.channel === 'assistant' && tool.mcpOnly))
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      scope: tool.scope,
      inputSchema: inputSchema(tool, !caller.websiteId),
    }));
}

export function hasTool(name: string) {
  return TOOLS.some((tool) => tool.name === name);
}

async function planAllows(env: Env, website: Website, userId: string, feature: NonNullable<ToolSpec<AiToolName>['planFeature']>) {
  if (!isHostedMode(env)) return true;
  return Boolean(getPlan(await getWebsitePlanId(env, website, userId))[feature]);
}

/**
 * Runs a tool for a caller. Unknown tools throw UnknownToolError (a protocol error in MCP);
 * everything else, including invalid input and denied access, comes back as `{ ok: false }`.
 */
export async function callTool(env: Env, caller: ToolCaller, name: string, rawInput: unknown): Promise<ToolOutcome> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool || (caller.channel === 'assistant' && tool.mcpOnly)) throw new UnknownToolError(`Unknown tool: ${name}`);
  if (!caller.scopes.includes(tool.scope)) {
    return { ok: false, error: `${name} needs an API key with the ${tool.scope} scope.` };
  }

  const record = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? { ...(rawInput as Record<string, unknown>) } : {};
  let website: Website | null = null;
  if (tool.websiteScoped) {
    const requested = typeof record.websiteId === 'string' ? record.websiteId.trim() : '';
    if (caller.websiteId && requested && requested !== caller.websiteId) {
      return { ok: false, error: 'This conversation can only query its own website.' };
    }
    const websiteId = caller.websiteId ?? requested;
    if (!websiteId) return { ok: false, error: 'websiteId is required. Call list_websites to find it.' };
    website = await getWebsiteById(env, websiteId);
    if (!website || !(await canAccessWebsite(env, website, caller.user))) {
      return { ok: false, error: 'Website not found or not accessible with this key.' };
    }
    if (tool.scope === 'write' && !(await canMutateWebsite(env, website, caller.user))) {
      return { ok: false, error: 'You have read-only access to this website.' };
    }
    if (tool.planFeature && !(await planAllows(env, website, caller.user.userId, tool.planFeature))) {
      return { ok: false, error: `${name} needs a paid plan for this website.` };
    }
  }
  delete record.websiteId;

  const parsed = aiToolInputSchemas[tool.name].safeParse(record);
  if (!parsed.success) return { ok: false, error: `Invalid input. ${aiToolInputError(parsed.error)}` };

  try {
    // parsed.data comes from this tool's own schema; TypeScript cannot correlate the two.
    const result = await tool.run({ env, caller, website }, parsed.data as never);
    return { ok: true, data: result.data, ...(result.display ? { display: result.display } : {}) };
  } catch (error) {
    if (error instanceof ToolError || error instanceof InsightQueryError) return { ok: false, error: error.message };
    // Tool inputs and results may hold customer data: log only which tool failed.
    console.error(
      JSON.stringify({ event: 'ai_tool_failed', tool: name, channel: caller.channel, error: error instanceof Error ? error.name : 'unknown' }),
    );
    return { ok: false, error: 'The tool failed unexpectedly. Try a simpler request.' };
  }
}
