import {
  AI_PROPS,
  EVENT_TYPE,
  inputIncludesCache,
  isTruncatedAiContent,
  lookupModelPrice,
  usageCostUsd,
  type ModelPrice,
  type PriceSource,
} from '@flareboard/shared';
import type { Env } from '../env';
import { buildTraceTree, type TraceTreeEvent, type TraceTreeNode } from './ai-trace-tree';
import { loadPriceOverrides } from './llm-settings';
import { siteDb } from './site-db';
import { siteLocalMsSql } from './site-time';

/**
 * LLM analytics queries over AI events (EVENT_TYPE.ai) in the website store.
 *
 * Cost is computed at query time: an event's own reported cost (`costUsd`, PostHog's
 * `$ai_*_cost_usd`) wins; otherwise its tokens are priced with the website's overrides, then the
 * built-in table (packages/shared/src/llm.ts). Pricing at read time means a corrected table or a
 * new override applies to past events at once, and ingest needs no per-website price lookups on
 * the hot path. SQL sums the unpriced tokens per model, so the math in code stays small.
 * Models with no known price are counted as "unpriced", never guessed.
 */

export type AiFilters = {
  model?: string;
  status?: string;
  provider?: string;
  quality?: string;
  release?: string;
  environment?: string;
  distinctId?: string;
};

export type AiQueryOptions = {
  timezone?: string;
  /** Price overrides keyed by normalized model id; loaded from D1 when omitted. */
  overrides?: ReadonlyMap<string, ModelPrice>;
};

const STRING_KEYS = [
  AI_PROPS.kind,
  AI_PROPS.provider,
  AI_PROPS.model,
  AI_PROPS.status,
  AI_PROPS.quality,
  AI_PROPS.release,
  AI_PROPS.environment,
  AI_PROPS.traceId,
  AI_PROPS.spanId,
  AI_PROPS.parentId,
  AI_PROPS.spanName,
  AI_PROPS.error,
] as const;

const NUMBER_KEYS = [
  AI_PROPS.inputTokens,
  AI_PROPS.outputTokens,
  AI_PROPS.totalTokens,
  AI_PROPS.cacheReadTokens,
  AI_PROPS.cacheWriteTokens,
  AI_PROPS.costUsd,
  AI_PROPS.latencyMs,
  AI_PROPS.httpStatus,
] as const;

const PROP_KEYS = [...STRING_KEYS, ...NUMBER_KEYS];

// Binds: ?1 websiteId, ?2 startAt, ?3 endAt, ?4 event type. Property keys are constants.
// `props` pivots the properties of AI events inside the window only; `ai` is one row per event.
const AI_CTE = `
  WITH props AS (
    SELECT
      d.website_event_id,
      ${STRING_KEYS.map((key) => `MAX(CASE WHEN d.data_key = '${key}' THEN d.string_value END) AS ${key}`).join(',\n      ')},
      ${NUMBER_KEYS.map((key) => `MAX(CASE WHEN d.data_key = '${key}' THEN d.number_value END) AS ${key}`).join(',\n      ')}
    FROM event_data d
    JOIN website_event ev
      ON ev.event_id = d.website_event_id
     AND ev.website_id = ?1
     AND ev.event_type = ?4
     AND ev.created_at >= ?2
     AND ev.created_at <= ?3
    WHERE d.website_id = ?1
      AND d.data_key IN (${PROP_KEYS.map((key) => `'${key}'`).join(', ')})
    GROUP BY d.website_event_id
  ),
  ai AS (
    SELECT
      e.event_id AS eventId,
      e.session_id AS sessionId,
      e.created_at AS createdAt,
      e.event_name AS eventName,
      e.url_path AS urlPath,
      s.distinct_id AS distinctId,
      COALESCE(p.aiKind, 'generation') AS kind,
      CASE WHEN COALESCE(p.aiKind, 'generation') IN ('generation', 'embedding') THEN 1 ELSE 0 END AS isCall,
      COALESCE(p.traceId, e.event_id) AS traceKey,
      p.traceId, p.spanId, p.parentSpanId, p.spanName, p.aiError,
      p.provider, p.model, COALESCE(p.status, 'success') AS status,
      CASE WHEN p.status = 'error' THEN 1 ELSE 0 END AS isError,
      p.quality, p.release, p.environment,
      p.inputTokens, p.outputTokens, p.cacheReadTokens, p.cacheWriteTokens,
      COALESCE(p.totalTokens, COALESCE(p.inputTokens, 0) + COALESCE(p.outputTokens, 0)) AS tokens,
      p.costUsd, p.latencyMs, p.httpStatus
    FROM website_event e
    LEFT JOIN props p ON p.website_event_id = e.event_id
    LEFT JOIN session s ON s.session_id = e.session_id
    WHERE e.website_id = ?1
      AND e.event_type = ?4
      AND e.created_at >= ?2
      AND e.created_at <= ?3
  )
`;

// Binds ?5 … ?11 (see filterBinds).
const FILTER_SQL = `
  AND (?5 IS NULL OR model = ?5)
  AND (?6 IS NULL OR status = ?6)
  AND (?7 IS NULL OR provider = ?7)
  AND (?8 IS NULL OR quality = ?8)
  AND (?9 IS NULL OR release = ?9)
  AND (?10 IS NULL OR environment = ?10)
  AND (?11 IS NULL OR distinctId = ?11)
`;

/** Token sums of calls without a reported cost (priced in code) and the reported cost. */
const USAGE_SUMS_SQL = `
  SUM(CASE WHEN isCall = 1 AND costUsd IS NULL THEN COALESCE(inputTokens, 0) ELSE 0 END) AS pIn,
  SUM(CASE WHEN isCall = 1 AND costUsd IS NULL THEN COALESCE(outputTokens, 0) ELSE 0 END) AS pOut,
  SUM(CASE WHEN isCall = 1 AND costUsd IS NULL THEN COALESCE(cacheReadTokens, 0) ELSE 0 END) AS pCacheRead,
  SUM(CASE WHEN isCall = 1 AND costUsd IS NULL THEN COALESCE(cacheWriteTokens, 0) ELSE 0 END) AS pCacheWrite,
  SUM(CASE WHEN isCall = 1 THEN costUsd END) AS reportedCost,
  SUM(CASE WHEN isCall = 1 AND costUsd IS NULL
            AND COALESCE(inputTokens, 0) + COALESCE(outputTokens, 0) + COALESCE(cacheReadTokens, 0) + COALESCE(cacheWriteTokens, 0) > 0
      THEN 1 ELSE 0 END) AS needPricing
`;

/** Rows grouped in SQL are capped; the response says when the cap was hit. */
const MAX_GROUP_ROWS = 20_000;

function filterBinds(websiteId: string, startAt: number, endAt: number, filters: AiFilters) {
  return [
    websiteId,
    startAt,
    endAt,
    EVENT_TYPE.ai,
    filters.model || null,
    filters.status || null,
    filters.provider || null,
    filters.quality || null,
    filters.release || null,
    filters.environment || null,
    filters.distinctId || null,
  ];
}

type UsageSums = {
  pIn: number | null;
  pOut: number | null;
  pCacheRead: number | null;
  pCacheWrite: number | null;
  reportedCost: number | null;
  needPricing: number | null;
};

export type CostSource = 'reported' | PriceSource;

/** Prices usage sums of one model; memoizes the table lookup per model. */
export class AiPricer {
  private cache = new Map<string, ReturnType<typeof lookupModelPrice>>();
  constructor(private overrides?: ReadonlyMap<string, ModelPrice>) {}

  price(model: string | null) {
    const key = model ?? '';
    if (!this.cache.has(key)) this.cache.set(key, lookupModelPrice(model, this.overrides));
    return this.cache.get(key)!;
  }

  /** Cost of a group; `unpriced` counts calls that needed a price and had none. */
  cost(model: string | null, provider: string | null, sums: UsageSums): { costUsd: number; unpriced: number; source: CostSource | null } {
    let costUsd = sums.reportedCost ?? 0;
    let source: CostSource | null = sums.reportedCost != null ? 'reported' : null;
    const need = sums.needPricing ?? 0;
    if (!need) return { costUsd, unpriced: 0, source };
    const found = this.price(model);
    if (!found) return { costUsd, unpriced: need, source };
    const usage = {
      inputTokens: sums.pIn ?? 0,
      outputTokens: sums.pOut ?? 0,
      cacheReadTokens: sums.pCacheRead ?? 0,
      cacheWriteTokens: sums.pCacheWrite ?? 0,
    };
    costUsd += usageCostUsd(usage, found.price, inputIncludesCache(provider, model));
    return { costUsd, unpriced: 0, source: source ?? found.source };
  }
}

async function pricerFor(env: Env, websiteId: string, options: AiQueryOptions) {
  return new AiPricer(options.overrides ?? (await loadPriceOverrides(env, websiteId)));
}

function rate(part: number, total: number) {
  return total ? Math.round((part / total) * 10000) / 100 : 0;
}

function roundMs(value: number | null | undefined) {
  return value != null ? Math.round(value) : null;
}

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

/** Hourly buckets (UTC, ISO) for windows up to two days, else site-local calendar days. */
function bucketSql(startAt: number, endAt: number, timezone: string | undefined) {
  if (endAt - startAt <= TWO_DAYS) {
    return { unit: 'hour' as const, sql: `strftime('%Y-%m-%dT%H:00:00Z', createdAt / 1000, 'unixepoch')` };
  }
  return {
    unit: 'day' as const,
    sql: `strftime('%Y-%m-%d', ${siteLocalMsSql('createdAt', startAt, endAt, timezone)} / 1000, 'unixepoch')`,
  };
}

// ─── Overview ───────────────────────────────────────────────────────────────────────────

type StatsGroupRow = UsageSums & {
  bucket: string;
  model: string | null;
  provider: string | null;
  quality: string | null;
  release: string | null;
  environment: string | null;
  isError: number;
  calls: number;
  tokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencySum: number | null;
  latencyCount: number;
};

type Tally = {
  calls: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpricedCalls: number;
  errors: number;
  latencySum: number;
  latencyCount: number;
};

function emptyTally(): Tally {
  return { calls: 0, tokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0, errors: 0, latencySum: 0, latencyCount: 0 };
}

function addTo(tally: Tally, row: StatsGroupRow, cost: { costUsd: number; unpriced: number }) {
  tally.calls += row.calls;
  tally.tokens += row.tokens ?? 0;
  tally.inputTokens += row.inputTokens ?? 0;
  tally.outputTokens += row.outputTokens ?? 0;
  tally.costUsd += cost.costUsd;
  tally.unpricedCalls += cost.unpriced;
  tally.errors += row.isError ? row.calls : 0;
  tally.latencySum += row.latencySum ?? 0;
  tally.latencyCount += row.latencyCount;
}

function tallyOut(tally: Tally) {
  return {
    calls: tally.calls,
    tokens: tally.tokens,
    inputTokens: tally.inputTokens,
    outputTokens: tally.outputTokens,
    costUsd: tally.costUsd,
    unpricedCalls: tally.unpricedCalls,
    errors: tally.errors,
    errorRate: rate(tally.errors, tally.calls),
    avgLatencyMs: roundMs(tally.latencyCount ? tally.latencySum / tally.latencyCount : null),
  };
}

function tallyBy<K extends string>(
  rows: StatsGroupRow[],
  costs: Array<{ costUsd: number; unpriced: number }>,
  keyOf: (row: StatsGroupRow) => K,
) {
  const map = new Map<K, Tally>();
  rows.forEach((row, index) => {
    const key = keyOf(row);
    const tally = map.get(key) ?? emptyTally();
    addTo(tally, row, costs[index]!);
    map.set(key, tally);
  });
  return map;
}

function topBy<T extends { calls: number }>(rows: T[], limit: number, name: (row: T) => string) {
  return [...rows].sort((a, b) => b.calls - a.calls || name(a).localeCompare(name(b))).slice(0, limit);
}

/** Generations and embeddings in the window: totals, trend, latency percentiles and breakdowns. */
export async function getAiStats(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: AiFilters = {},
  options: AiQueryOptions = {},
) {
  const db = siteDb(env, websiteId);
  const binds = filterBinds(websiteId, startAt, endAt, filters);
  const bucket = bucketSql(startAt, endAt, options.timezone);
  const where = `WHERE isCall = 1 ${FILTER_SQL}`;
  const [groupsResult, countsResult, latencyResult, pricer] = await Promise.all([
    db
      .prepare(
        `${AI_CTE}
         SELECT ${bucket.sql} AS bucket, model, provider, quality, release, environment, isError,
                COUNT(*) AS calls, SUM(tokens) AS tokens, SUM(inputTokens) AS inputTokens, SUM(outputTokens) AS outputTokens,
                SUM(latencyMs) AS latencySum, COUNT(latencyMs) AS latencyCount,
                ${USAGE_SUMS_SQL}
         FROM ai ${where}
         GROUP BY bucket, model, provider, quality, release, environment, isError
         LIMIT ${MAX_GROUP_ROWS}`,
      )
      .bind(...binds)
      .all<StatsGroupRow>(),
    db
      .prepare(
        `${AI_CTE}
         SELECT ${bucket.sql} AS bucket, COUNT(DISTINCT sessionId) AS sessions, NULL AS users, NULL AS traces
         FROM ai ${where} GROUP BY bucket
         UNION ALL
         SELECT '*' AS bucket, COUNT(DISTINCT sessionId), COUNT(DISTINCT COALESCE(distinctId, sessionId)), COUNT(DISTINCT traceKey)
         FROM ai ${where}`,
      )
      .bind(...binds)
      .all<{ bucket: string; sessions: number; users: number | null; traces: number | null }>(),
    db
      .prepare(
        `${AI_CTE},
         lat AS (
           SELECT ${bucket.sql} AS bucket, latencyMs FROM ai ${where} AND latencyMs IS NOT NULL
           UNION ALL
           SELECT '*' AS bucket, latencyMs FROM ai ${where} AND latencyMs IS NOT NULL
         ),
         ranked AS (
           SELECT bucket, latencyMs,
                  ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY latencyMs) AS rn,
                  COUNT(*) OVER (PARTITION BY bucket) AS cnt
           FROM lat
         )
         SELECT bucket,
                MAX(CASE WHEN rn = (cnt * 50 + 99) / 100 THEN latencyMs END) AS p50,
                MAX(CASE WHEN rn = (cnt * 95 + 99) / 100 THEN latencyMs END) AS p95
         FROM ranked GROUP BY bucket`,
      )
      .bind(...binds)
      .all<{ bucket: string; p50: number | null; p95: number | null }>(),
    pricerFor(env, websiteId, options),
  ]);

  const rows = groupsResult.results ?? [];
  const costs = rows.map((row) => pricer.cost(row.model, row.provider, row));
  const total = emptyTally();
  rows.forEach((row, index) => addTo(total, row, costs[index]!));

  const counts = new Map((countsResult.results ?? []).map((row) => [row.bucket, row]));
  const latency = new Map((latencyResult.results ?? []).map((row) => [row.bucket, row]));

  const modelProviders = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const model = row.model ?? 'unknown';
    const providers = modelProviders.get(model) ?? new Map<string, number>();
    if (row.provider) providers.set(row.provider, (providers.get(row.provider) ?? 0) + row.calls);
    modelProviders.set(model, providers);
  }
  const models = topBy(
    [...tallyBy(rows, costs, (row) => row.model ?? 'unknown')].map(([model, tally]) => {
      const providers = [...(modelProviders.get(model) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
      const price = model === 'unknown' ? null : pricer.price(model);
      return {
        model,
        provider: providers[0]?.[0] ?? null,
        priceSource: price?.source ?? null,
        ...tallyOut(tally),
      };
    }),
    20,
    (row) => row.model,
  );

  const breakdown = (keyOf: (row: StatsGroupRow) => string | null) =>
    [...tallyBy(rows, costs, (row) => keyOf(row) ?? 'unknown')].map(([key, tally]) => ({ key, ...tallyOut(tally) }));

  const providers = topBy(
    breakdown((row) => row.provider).map(({ key, ...rest }) => ({ provider: key, ...rest })),
    20,
    (row) => row.provider,
  );
  const statuses = [...tallyBy(rows, costs, (row) => (row.isError ? 'error' : 'success'))]
    .map(([status, tally]) => ({ status, calls: tally.calls }))
    .sort((a, b) => b.calls - a.calls || a.status.localeCompare(b.status));
  const qualities = breakdown((row) => row.quality)
    .map(({ key, calls }) => ({ quality: key, calls }))
    .sort((a, b) => b.calls - a.calls || a.quality.localeCompare(b.quality));
  const releases = topBy(
    breakdown((row) => row.release).map(({ key, calls, costUsd, errors }) => ({ release: key, calls, costUsd, errors })),
    10,
    (row) => row.release,
  );
  const environments = topBy(
    breakdown((row) => row.environment).map(({ key, calls, costUsd, errors }) => ({ environment: key, calls, costUsd, errors })),
    10,
    (row) => row.environment,
  );

  const trend = [...tallyBy(rows, costs, (row) => row.bucket)]
    .map(([date, tally]) => ({
      date,
      sessions: counts.get(date)?.sessions ?? 0,
      ...tallyOut(tally),
      p50LatencyMs: roundMs(latency.get(date)?.p50),
      p95LatencyMs: roundMs(latency.get(date)?.p95),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const overall = counts.get('*');
  return {
    unit: bucket.unit,
    ...tallyOut(total),
    sessions: overall?.sessions ?? 0,
    users: overall?.users ?? 0,
    traces: overall?.traces ?? 0,
    p50LatencyMs: roundMs(latency.get('*')?.p50),
    p95LatencyMs: roundMs(latency.get('*')?.p95),
    truncated: rows.length >= MAX_GROUP_ROWS,
    models,
    statuses,
    providers,
    qualities,
    releases,
    environments,
    trend,
  };
}

// ─── Recent calls ───────────────────────────────────────────────────────────────────────

type AiRow = {
  eventId: string;
  sessionId: string;
  createdAt: number;
  eventName: string | null;
  urlPath: string;
  distinctId: string | null;
  kind: string;
  traceKey: string;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  spanName: string | null;
  aiError: string | null;
  provider: string | null;
  model: string | null;
  status: string;
  isError: number;
  quality: string | null;
  release: string | null;
  environment: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  tokens: number;
  costUsd: number | null;
  latencyMs: number | null;
  httpStatus: number | null;
};

function rowUsage(row: Pick<AiRow, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'costUsd'>): UsageSums {
  const tokens =
    (row.inputTokens ?? 0) + (row.outputTokens ?? 0) + (row.cacheReadTokens ?? 0) + (row.cacheWriteTokens ?? 0);
  return {
    pIn: row.costUsd == null ? row.inputTokens : 0,
    pOut: row.costUsd == null ? row.outputTokens : 0,
    pCacheRead: row.costUsd == null ? row.cacheReadTokens : 0,
    pCacheWrite: row.costUsd == null ? row.cacheWriteTokens : 0,
    reportedCost: row.costUsd,
    needPricing: row.costUsd == null && tokens > 0 ? 1 : 0,
  };
}

/** One AI call with its cost priced (reported, override, built-in or unpriced = null). */
function callOut(row: AiRow, pricer: AiPricer) {
  const cost = pricer.cost(row.model, row.provider, rowUsage(row));
  return {
    id: row.eventId,
    sessionId: row.sessionId,
    distinctId: row.distinctId,
    urlPath: row.urlPath,
    createdAt: row.createdAt,
    kind: row.kind,
    traceId: row.traceKey,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    totalTokens: row.tokens,
    costUsd: cost.unpriced ? null : cost.costUsd,
    costSource: cost.unpriced ? null : cost.source,
    latencyMs: row.latencyMs,
    status: row.status,
    quality: row.quality,
    release: row.release,
    environment: row.environment,
  };
}

export async function getAiEvents(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: AiFilters = {},
  limit = 100,
  options: AiQueryOptions = {},
) {
  const [rows, pricer] = await Promise.all([
    siteDb(env, websiteId)
      .prepare(
        `${AI_CTE}
         SELECT * FROM ai WHERE isCall = 1 ${FILTER_SQL}
         ORDER BY createdAt DESC LIMIT ?12`,
      )
      .bind(...filterBinds(websiteId, startAt, endAt, filters), Math.min(Math.max(limit, 1), 500))
      .all<AiRow>(),
    pricerFor(env, websiteId, options),
  ]);
  return (rows.results ?? []).map((row) => callOut(row, pricer));
}

// ─── Traces ─────────────────────────────────────────────────────────────────────────────

export type AiTraceFilters = AiFilters & {
  /** Only traces with (true) or without (false) an error. */
  error?: boolean;
  minCostUsd?: number;
  maxCostUsd?: number;
};

type TraceGroupRow = UsageSums & {
  traceKey: string;
  model: string | null;
  provider: string | null;
  firstAt: number;
  lastAt: number;
  startedAt: number;
  generations: number;
  spans: number;
  errors: number;
  tokens: number | null;
  traceName: string | null;
  spanName: string | null;
  traceLatency: number | null;
  distinctId: string | null;
  sessionId: string;
};

export type AiTraceSummary = {
  traceId: string;
  name: string | null;
  startedAt: number;
  lastAt: number;
  latencyMs: number;
  generations: number;
  spans: number;
  errors: number;
  tokens: number;
  costUsd: number;
  unpricedCalls: number;
  models: string[];
  providers: string[];
  distinctId: string | null;
  sessionId: string;
};

function mergeTraceRows(rows: TraceGroupRow[], pricer: AiPricer): AiTraceSummary[] {
  const traces = new Map<string, AiTraceSummary & { names: string[] }>();
  for (const row of rows) {
    const cost = pricer.cost(row.model, row.provider, row);
    const trace =
      traces.get(row.traceKey) ??
      ({
        traceId: row.traceKey,
        name: null,
        names: [],
        startedAt: row.startedAt,
        lastAt: row.lastAt,
        latencyMs: 0,
        generations: 0,
        spans: 0,
        errors: 0,
        tokens: 0,
        costUsd: 0,
        unpricedCalls: 0,
        models: [],
        providers: [],
        distinctId: row.distinctId,
        sessionId: row.sessionId,
      } satisfies AiTraceSummary & { names: string[] });
    trace.startedAt = Math.min(trace.startedAt, row.startedAt);
    trace.lastAt = Math.max(trace.lastAt, row.lastAt);
    trace.generations += row.generations;
    trace.spans += row.spans;
    trace.errors += row.errors;
    trace.tokens += row.tokens ?? 0;
    trace.costUsd += cost.costUsd;
    trace.unpricedCalls += cost.unpriced;
    trace.distinctId ??= row.distinctId;
    if (row.traceName) trace.name = row.traceName;
    if (row.traceLatency != null) trace.latencyMs = Math.max(trace.latencyMs, row.traceLatency);
    if (row.spanName) trace.names.push(row.spanName);
    if (row.model && row.generations && !trace.models.includes(row.model)) trace.models.push(row.model);
    if (row.provider && row.generations && !trace.providers.includes(row.provider)) trace.providers.push(row.provider);
    traces.set(row.traceKey, trace);
  }
  return [...traces.values()].map(({ names, ...trace }) => ({
    ...trace,
    name: trace.name ?? names.sort()[0] ?? trace.models[0] ?? null,
    latencyMs: Math.max(trace.latencyMs, trace.lastAt - trace.startedAt),
  }));
}

/** Traces (a single call without a trace id is its own trace) with totals, newest first. */
export async function getAiTraces(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: AiTraceFilters = {},
  limit = 100,
  options: AiQueryOptions = {},
) {
  const [result, pricer] = await Promise.all([
    siteDb(env, websiteId)
      .prepare(
        `${AI_CTE}
         SELECT traceKey, model, provider,
                MIN(createdAt) AS firstAt, MAX(createdAt) AS lastAt,
                MIN(createdAt - COALESCE(latencyMs, 0)) AS startedAt,
                SUM(isCall) AS generations,
                SUM(CASE WHEN kind = 'span' THEN 1 ELSE 0 END) AS spans,
                SUM(isError) AS errors,
                SUM(CASE WHEN isCall = 1 THEN tokens ELSE 0 END) AS tokens,
                MAX(CASE WHEN kind = 'trace' THEN spanName END) AS traceName,
                MIN(CASE WHEN kind <> 'trace' THEN spanName END) AS spanName,
                MAX(CASE WHEN kind = 'trace' THEN latencyMs END) AS traceLatency,
                MAX(distinctId) AS distinctId,
                MAX(sessionId) AS sessionId,
                ${USAGE_SUMS_SQL}
         FROM ai
         WHERE traceKey IN (SELECT traceKey FROM ai WHERE 1 = 1 ${FILTER_SQL})
         GROUP BY traceKey, model, provider
         LIMIT ${MAX_GROUP_ROWS}`,
      )
      .bind(...filterBinds(websiteId, startAt, endAt, filters))
      .all<TraceGroupRow>(),
    pricerFor(env, websiteId, options),
  ]);
  const rows = result.results ?? [];
  const traces = mergeTraceRows(rows, pricer)
    .filter((trace) => filters.error === undefined || (trace.errors > 0) === filters.error)
    .filter((trace) => filters.minCostUsd === undefined || trace.costUsd >= filters.minCostUsd)
    .filter((trace) => filters.maxCostUsd === undefined || trace.costUsd <= filters.maxCostUsd)
    .sort((a, b) => b.lastAt - a.lastAt || a.traceId.localeCompare(b.traceId));
  const capped = Math.min(Math.max(limit, 1), 500);
  return { traces: traces.slice(0, capped), total: traces.length, truncated: rows.length >= MAX_GROUP_ROWS };
}

/** Events of one trace kept for the tree; larger traces are cut (the response says so). */
const MAX_TRACE_EVENTS = 1000;

export type AiTraceEvent = TraceTreeEvent & {
  eventName: string | null;
  createdAt: number;
  name: string | null;
  model: string | null;
  provider: string | null;
  status: string;
  error: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costSource: CostSource | null;
  input: string | null;
  output: string | null;
  inputTruncated: boolean;
  outputTruncated: boolean;
  contentOmitted: boolean;
  /** Every other property of the event (custom properties, `$ai_*` extras, model parameters). */
  properties: Record<string, string | number | null>;
};

const TREE_KEYS = new Set<string>([...PROP_KEYS, AI_PROPS.input, AI_PROPS.output, AI_PROPS.contentOmitted]);

/**
 * One trace: every AI event whose trace id (or, for a lone call, event id) is `traceId`, as a
 * tree with timings, costs and content. Searched within [startAt, endAt].
 */
export async function getAiTrace(
  env: Env,
  websiteId: string,
  traceId: string,
  startAt: number,
  endAt: number,
  options: AiQueryOptions = {},
) {
  const [result, pricer] = await Promise.all([
    siteDb(env, websiteId)
      .prepare(
        `SELECT e.event_id AS eventId, e.session_id AS sessionId, e.created_at AS createdAt, e.event_name AS eventName,
                s.distinct_id AS distinctId, d.data_key AS dataKey, d.string_value AS stringValue,
                d.number_value AS numberValue, d.data_type AS dataType
         FROM website_event e
         LEFT JOIN session s ON s.session_id = e.session_id
         LEFT JOIN event_data d ON d.website_event_id = e.event_id
         WHERE e.website_id = ?1
           AND e.event_type = ?4
           AND e.created_at >= ?2
           AND e.created_at <= ?3
           AND (e.event_id = ?5 OR EXISTS (
             SELECT 1 FROM event_data t
             WHERE t.website_event_id = e.event_id AND t.data_key = '${AI_PROPS.traceId}' AND t.string_value = ?5
           ))
         ORDER BY e.created_at, e.event_id
         LIMIT ${MAX_TRACE_EVENTS * 120}`,
      )
      .bind(websiteId, startAt, endAt, EVENT_TYPE.ai, traceId)
      .all<{
        eventId: string;
        sessionId: string;
        createdAt: number;
        eventName: string | null;
        distinctId: string | null;
        dataKey: string | null;
        stringValue: string | null;
        numberValue: number | null;
        dataType: number | null;
      }>(),
    pricerFor(env, websiteId, options),
  ]);

  const rows = result.results ?? [];
  const grouped = new Map<string, { base: (typeof rows)[number]; props: Map<string, string | number | null> }>();
  for (const row of rows) {
    const entry = grouped.get(row.eventId) ?? { base: row, props: new Map() };
    if (row.dataKey) entry.props.set(row.dataKey, row.dataType === 2 ? row.numberValue : row.stringValue);
    grouped.set(row.eventId, entry);
  }
  if (!grouped.size) return null;

  const str = (props: Map<string, string | number | null>, key: string) => {
    const value = props.get(key);
    return value == null ? null : String(value);
  };
  const num = (props: Map<string, string | number | null>, key: string) => {
    const value = props.get(key);
    return typeof value === 'number' ? value : value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  };

  const truncated = grouped.size > MAX_TRACE_EVENTS;
  const events: AiTraceEvent[] = [...grouped.values()].slice(0, MAX_TRACE_EVENTS).map(({ base, props }) => {
    const kind = str(props, AI_PROPS.kind) ?? 'generation';
    const latencyMs = num(props, AI_PROPS.latencyMs);
    const inputTokens = num(props, AI_PROPS.inputTokens);
    const outputTokens = num(props, AI_PROPS.outputTokens);
    const cacheReadTokens = num(props, AI_PROPS.cacheReadTokens);
    const cacheWriteTokens = num(props, AI_PROPS.cacheWriteTokens);
    const reported = num(props, AI_PROPS.costUsd);
    const model = str(props, AI_PROPS.model);
    const provider = str(props, AI_PROPS.provider);
    const call = kind === 'generation' || kind === 'embedding';
    const cost = call
      ? pricer.cost(model, provider, rowUsage({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd: reported }))
      : { costUsd: 0, unpriced: 0, source: null };
    const input = str(props, AI_PROPS.input);
    const output = str(props, AI_PROPS.output);
    const properties: Record<string, string | number | null> = {};
    for (const [key, value] of props) if (!TREE_KEYS.has(key)) properties[key] = value;
    const status = str(props, AI_PROPS.status) ?? 'success';
    return {
      id: base.eventId,
      kind,
      eventName: base.eventName,
      createdAt: base.createdAt,
      startMs: base.createdAt - (latencyMs ?? 0),
      endMs: base.createdAt,
      spanId: kind === 'trace' ? (str(props, AI_PROPS.spanId) ?? traceId) : str(props, AI_PROPS.spanId),
      parentId: str(props, AI_PROPS.parentId),
      name: str(props, AI_PROPS.spanName) ?? (call ? model : null) ?? base.eventName,
      model,
      provider,
      status,
      isError: status === 'error',
      error: str(props, AI_PROPS.error),
      httpStatus: num(props, AI_PROPS.httpStatus),
      latencyMs,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      tokens: num(props, AI_PROPS.totalTokens) ?? (inputTokens ?? 0) + (outputTokens ?? 0),
      costUsd: call && !cost.unpriced ? cost.costUsd : null,
      costSource: call && !cost.unpriced ? cost.source : null,
      input,
      output,
      inputTruncated: input != null && isTruncatedAiContent(input),
      outputTruncated: output != null && isTruncatedAiContent(output),
      contentOmitted: str(props, AI_PROPS.contentOmitted) === 'true',
      properties,
    };
  });

  const first = [...grouped.values()][0]!.base;
  const tree: TraceTreeNode<AiTraceEvent> = buildTraceTree(traceId, events);
  const unpricedCalls = events.filter(
    (event) => (event.kind === 'generation' || event.kind === 'embedding') && event.costUsd == null && event.tokens > 0,
  ).length;
  return {
    traceId,
    name: tree.event?.name ?? events.find((event) => event.name)?.name ?? null,
    distinctId: [...grouped.values()].find(({ base }) => base.distinctId)?.base.distinctId ?? null,
    sessionId: first.sessionId,
    startedAt: tree.startMs,
    endedAt: tree.endMs,
    latencyMs: Math.max(tree.event?.latencyMs ?? 0, tree.endMs - tree.startMs),
    costUsd: tree.totals.costUsd,
    tokens: tree.totals.tokens,
    errors: tree.totals.errors,
    generations: tree.totals.generations,
    unpricedCalls,
    truncated,
    tree,
  };
}

// ─── Users ──────────────────────────────────────────────────────────────────────────────

type UserGroupRow = UsageSums & {
  userKey: string;
  distinctId: string | null;
  sessionId: string;
  model: string | null;
  provider: string | null;
  calls: number;
  errors: number;
  tokens: number | null;
  firstAt: number;
  lastAt: number;
};

/** Cost and usage per user (distinct id, or the anonymous visitor), most expensive first. */
export async function getAiUsers(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: AiFilters = {},
  limit = 100,
  options: AiQueryOptions = {},
) {
  const db = siteDb(env, websiteId);
  const binds = filterBinds(websiteId, startAt, endAt, filters);
  const [groups, traces, pricer] = await Promise.all([
    db
      .prepare(
        `${AI_CTE}
         SELECT COALESCE(distinctId, sessionId) AS userKey, MAX(distinctId) AS distinctId, MAX(sessionId) AS sessionId,
                model, provider, COUNT(*) AS calls, SUM(isError) AS errors, SUM(tokens) AS tokens,
                MIN(createdAt) AS firstAt, MAX(createdAt) AS lastAt,
                ${USAGE_SUMS_SQL}
         FROM ai WHERE isCall = 1 ${FILTER_SQL}
         GROUP BY userKey, model, provider
         LIMIT ${MAX_GROUP_ROWS}`,
      )
      .bind(...binds)
      .all<UserGroupRow>(),
    db
      .prepare(
        `${AI_CTE}
         SELECT COALESCE(distinctId, sessionId) AS userKey, COUNT(DISTINCT traceKey) AS traces
         FROM ai WHERE isCall = 1 ${FILTER_SQL}
         GROUP BY userKey`,
      )
      .bind(...binds)
      .all<{ userKey: string; traces: number }>(),
    pricerFor(env, websiteId, options),
  ]);

  const traceCounts = new Map((traces.results ?? []).map((row) => [row.userKey, row.traces]));
  const users = new Map<
    string,
    {
      distinctId: string | null;
      sessionId: string;
      calls: number;
      traces: number;
      errors: number;
      tokens: number;
      costUsd: number;
      unpricedCalls: number;
      firstAt: number;
      lastAt: number;
      models: string[];
    }
  >();
  const rows = groups.results ?? [];
  for (const row of rows) {
    const cost = pricer.cost(row.model, row.provider, row);
    const user = users.get(row.userKey) ?? {
      distinctId: row.distinctId,
      sessionId: row.sessionId,
      calls: 0,
      traces: traceCounts.get(row.userKey) ?? 0,
      errors: 0,
      tokens: 0,
      costUsd: 0,
      unpricedCalls: 0,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      models: [],
    };
    user.calls += row.calls;
    user.errors += row.errors;
    user.tokens += row.tokens ?? 0;
    user.costUsd += cost.costUsd;
    user.unpricedCalls += cost.unpriced;
    user.firstAt = Math.min(user.firstAt, row.firstAt);
    user.lastAt = Math.max(user.lastAt, row.lastAt);
    if (row.model && !user.models.includes(row.model)) user.models.push(row.model);
    users.set(row.userKey, user);
  }
  const sorted = [...users.values()].sort(
    (a, b) => b.costUsd - a.costUsd || b.calls - a.calls || (a.distinctId ?? a.sessionId).localeCompare(b.distinctId ?? b.sessionId),
  );
  return {
    users: sorted.slice(0, Math.min(Math.max(limit, 1), 500)),
    total: sorted.length,
    truncated: rows.length >= MAX_GROUP_ROWS,
  };
}
