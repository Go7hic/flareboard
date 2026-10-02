import type { Env } from '../env';
import { deliverAlertNotification, hasRecentAlertEvent } from './alert-delivery';
import {
  fromArms,
  logConditions,
  logParams,
  logSources,
  SEVERITIES,
  whereClause,
  type LogFilters,
  type LogSourceName,
  type LogSources,
  type Severity,
  type SqlParams,
} from './log-sources';

export type { AttributeFilter, LogFilters, LogSourceName, Severity } from './log-sources';

/** One log line, from OpenTelemetry (`otlp`) or the tracker's `flareboard.log()` (`browser`). */
export type LogEventRow = {
  id: string;
  source: LogSourceName;
  createdAt: number;
  /** Microseconds, for ordering lines within a millisecond. */
  timeUs: number;
  level: Severity;
  severityText: string | null;
  message: string | null;
  service: string | null;
  release: string | null;
  environment: string | null;
  scope: string | null;
  traceId: string | null;
  spanId: string | null;
  sessionId: string | null;
  visitId: string | null;
  urlPath: string | null;
  attributes: Record<string, unknown> | null;
  resource: Record<string, unknown> | null;
};

export type TraceSummaryRow = {
  traceId: string;
  spans: number;
  services: number;
  rootName: string | null;
  rootService: string | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  maxSpanDurationMs: number;
  hasError: boolean;
  sessionId: string | null;
};

export type TraceSpanRow = {
  id: string;
  source: LogSourceName;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  service: string | null;
  release: string | null;
  environment: string | null;
  createdAt: number;
  startUs: number;
  durationUs: number;
  /** Milliseconds, rounded (kept for older clients). */
  durationMs: number;
  status: 'unset' | 'ok' | 'error';
  statusMessage: string | null;
  sessionId: string | null;
  attributes: Record<string, unknown> | null;
  resource: Record<string, unknown> | null;
  events: Array<{ name: string; timeUs: number; attributes: Record<string, unknown> }>;
  links: Array<{ traceId: string; spanId: string; attributes: Record<string, unknown> }>;
};

export type TraceDetailRow = {
  traceId: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  services: string[];
  sessionId: string | null;
  spans: TraceSpanRow[];
  logs: LogEventRow[];
};

export type ServiceSummaryRow = {
  service: string;
  logs: number;
  errors: number;
  traces: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastSeenAt: number;
};

export type LogHistogram = {
  bucketMs: number;
  buckets: Array<{ t: number; total: number } & Record<Severity, number>>;
};

export type LogSavedFilterValue = {
  level?: string;
  search?: string;
  release?: string;
  environment?: string;
  service?: string;
  traceId?: string;
  sessionId?: string;
  source?: LogSourceName;
  attributes?: Array<{ key: string; value?: string }>;
};

export type LogSavedFilterInput = {
  name: string;
  filters: LogSavedFilterValue;
  isDefault: boolean;
};

export type LogSavedFilterPatch = Partial<LogSavedFilterInput>;

export type LogSavedFilterRow = {
  id: string;
  websiteId: string;
  userId: string | null;
  name: string;
  filters: LogSavedFilterValue;
  isDefault: boolean;
  createdAt: number | null;
  updatedAt: number | null;
};

export type LogAlertRuleInput = {
  name: string;
  enabled: boolean;
  threshold: number;
  windowMinutes: number;
  level?: string | null;
  service?: string | null;
  search?: string | null;
  release?: string | null;
  environment?: string | null;
  attributeKey?: string | null;
  attributeValue?: string | null;
  channel: string;
  target?: string | null;
};

export type LogAlertRulePatch = Partial<LogAlertRuleInput>;

export type LogAlertRuleRow = {
  id: string;
  websiteId: string;
  name: string;
  enabled: boolean;
  threshold: number;
  windowMinutes: number;
  level: string | null;
  service: string | null;
  search: string | null;
  release: string | null;
  environment: string | null;
  attributeKey: string | null;
  attributeValue: string | null;
  channel: string;
  target: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type TriggeredLogAlertRow = {
  id: string;
  alertRuleId: string;
  websiteId: string;
  count: number;
  threshold: number;
  windowStartAt: number;
  windowEndAt: number;
  createdAt: number;
};

function normalizeSavedFilter(row: Omit<LogSavedFilterRow, 'filters' | 'isDefault'> & { filters: string; isDefault: number }) {
  let filters: LogSavedFilterValue;
  try {
    filters = JSON.parse(row.filters) as LogSavedFilterValue;
  } catch {
    filters = {} as LogSavedFilterValue;
  }
  return {
    ...row,
    filters,
    isDefault: Boolean(row.isDefault),
  };
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeLogAlertRule(row: Omit<LogAlertRuleRow, 'enabled'> & { enabled: number | boolean }) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
  };
}


export async function listLogSavedFilters(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT filter_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            filters,
            is_default as isDefault,
            created_at as createdAt,
            updated_at as updatedAt
     FROM log_saved_filter
     WHERE website_id = ?1
     ORDER BY is_default DESC, created_at DESC`,
  )
    .bind(websiteId)
    .all<Omit<LogSavedFilterRow, 'filters' | 'isDefault'> & { filters: string; isDefault: number }>();

  return (rows.results ?? []).map(normalizeSavedFilter);
}

export async function getLogSavedFilter(env: Env, websiteId: string, filterId: string) {
  const row = await env.DB.prepare(
    `SELECT filter_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            filters,
            is_default as isDefault,
            created_at as createdAt,
            updated_at as updatedAt
     FROM log_saved_filter
     WHERE website_id = ?1 AND filter_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, filterId)
    .first<Omit<LogSavedFilterRow, 'filters' | 'isDefault'> & { filters: string; isDefault: number }>();

  return row ? normalizeSavedFilter(row) : null;
}

export async function createLogSavedFilter(
  env: Env,
  websiteId: string,
  userId: string | null,
  input: LogSavedFilterInput,
) {
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO log_saved_filter (filter_id, website_id, user_id, name, filters, is_default, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
  )
    .bind(id, websiteId, userId, input.name.trim(), JSON.stringify(input.filters), input.isDefault ? 1 : 0, now)
    .run();

  const filter = await getLogSavedFilter(env, websiteId, id);
  if (!filter) throw new Error('Log saved filter creation failed');
  return filter;
}

export async function updateLogSavedFilter(
  env: Env,
  websiteId: string,
  filterId: string,
  patch: LogSavedFilterPatch,
) {
  const existing = await getLogSavedFilter(env, websiteId, filterId);
  if (!existing) return null;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE log_saved_filter
     SET name = ?3,
         filters = ?4,
         is_default = ?5,
         updated_at = ?6
     WHERE website_id = ?1 AND filter_id = ?2`,
  )
    .bind(
      websiteId,
      filterId,
      patch.name?.trim() ?? existing.name,
      JSON.stringify(patch.filters ?? existing.filters),
      (patch.isDefault ?? existing.isDefault) ? 1 : 0,
      now,
    )
    .run();
  return getLogSavedFilter(env, websiteId, filterId);
}

export async function deleteLogSavedFilter(env: Env, websiteId: string, filterId: string) {
  const existing = await getLogSavedFilter(env, websiteId, filterId);
  if (!existing) return false;
  await env.DB.prepare(`DELETE FROM log_saved_filter WHERE website_id = ?1 AND filter_id = ?2`)
    .bind(websiteId, filterId)
    .run();
  return true;
}

export async function listLogAlertRules(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT alert_rule_id as id,
            website_id as websiteId,
            name,
            enabled,
            threshold,
            window_minutes as windowMinutes,
            level,
            service,
            search,
            release,
            environment,
            attribute_key as attributeKey,
            attribute_value as attributeValue,
            channel,
            target,
            created_at as createdAt,
            updated_at as updatedAt
     FROM log_alert_rule
     WHERE website_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(websiteId)
    .all<Omit<LogAlertRuleRow, 'enabled'> & { enabled: number }>();
  return (rows.results ?? []).map(normalizeLogAlertRule);
}

export async function getLogAlertRule(env: Env, websiteId: string, alertRuleId: string) {
  const row = await env.DB.prepare(
    `SELECT alert_rule_id as id,
            website_id as websiteId,
            name,
            enabled,
            threshold,
            window_minutes as windowMinutes,
            level,
            service,
            search,
            release,
            environment,
            attribute_key as attributeKey,
            attribute_value as attributeValue,
            channel,
            target,
            created_at as createdAt,
            updated_at as updatedAt
     FROM log_alert_rule
     WHERE website_id = ?1 AND alert_rule_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, alertRuleId)
    .first<Omit<LogAlertRuleRow, 'enabled'> & { enabled: number }>();
  return row ? normalizeLogAlertRule(row) : null;
}

export async function createLogAlertRule(env: Env, websiteId: string, input: LogAlertRuleInput) {
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO log_alert_rule
       (alert_rule_id, website_id, name, enabled, threshold, window_minutes, level, service, search, release, environment, channel, target, created_at, updated_at, attribute_key, attribute_value)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15, ?16)`,
  )
    .bind(
      id,
      websiteId,
      input.name.trim(),
      input.enabled ? 1 : 0,
      input.threshold,
      input.windowMinutes,
      normalizeNullableText(input.level),
      normalizeNullableText(input.service),
      normalizeNullableText(input.search),
      normalizeNullableText(input.release),
      normalizeNullableText(input.environment),
      input.channel,
      normalizeNullableText(input.target),
      now,
      normalizeNullableText(input.attributeKey),
      normalizeNullableText(input.attributeValue),
    )
    .run();
  const rule = await getLogAlertRule(env, websiteId, id);
  if (!rule) throw new Error('Log alert rule creation failed');
  return rule;
}

export async function updateLogAlertRule(
  env: Env,
  websiteId: string,
  alertRuleId: string,
  patch: LogAlertRulePatch,
) {
  const existing = await getLogAlertRule(env, websiteId, alertRuleId);
  if (!existing) return null;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE log_alert_rule
     SET name = ?3,
         enabled = ?4,
         threshold = ?5,
         window_minutes = ?6,
         level = ?7,
         service = ?8,
         search = ?9,
         release = ?10,
         environment = ?11,
         channel = ?12,
         target = ?13,
         updated_at = ?14,
         attribute_key = ?15,
         attribute_value = ?16
     WHERE website_id = ?1 AND alert_rule_id = ?2`,
  )
    .bind(
      websiteId,
      alertRuleId,
      patch.name?.trim() ?? existing.name,
      (patch.enabled ?? existing.enabled) ? 1 : 0,
      patch.threshold ?? existing.threshold,
      patch.windowMinutes ?? existing.windowMinutes,
      patch.level === undefined ? existing.level : normalizeNullableText(patch.level),
      patch.service === undefined ? existing.service : normalizeNullableText(patch.service),
      patch.search === undefined ? existing.search : normalizeNullableText(patch.search),
      patch.release === undefined ? existing.release : normalizeNullableText(patch.release),
      patch.environment === undefined ? existing.environment : normalizeNullableText(patch.environment),
      patch.channel ?? existing.channel,
      patch.target === undefined ? existing.target : normalizeNullableText(patch.target),
      now,
      patch.attributeKey === undefined ? existing.attributeKey : normalizeNullableText(patch.attributeKey),
      patch.attributeValue === undefined ? existing.attributeValue : normalizeNullableText(patch.attributeValue),
    )
    .run();
  return getLogAlertRule(env, websiteId, alertRuleId);
}

export async function deleteLogAlertRule(env: Env, websiteId: string, alertRuleId: string) {
  const existing = await getLogAlertRule(env, websiteId, alertRuleId);
  if (!existing) return false;
  await env.DB.prepare(`DELETE FROM log_alert_rule WHERE website_id = ?1 AND alert_rule_id = ?2`)
    .bind(websiteId, alertRuleId)
    .run();
  return true;
}

// Query functions. Every query reads the sources described in log-sources.ts; list queries run
// one statement per source (each walks its own time index and stops at the limit) and merge in
// code, aggregates run over the UNION ALL of the sources.

const LOG_COLUMNS = `l.id AS id, l.source AS source, l.seq AS seq, l.created_at AS createdAt, l.time_us AS timeUs,
  l.severity AS level, l.severity_text AS severityText, l.body AS message, l.service AS service,
  l.release AS release, l.environment AS environment, l.scope AS scope, l.trace_id AS traceId,
  l.span_id AS spanId, l.session_id AS sessionId, l.visit_id AS visitId, l.url_path AS urlPath,
  l.attributes AS attributes, l.resource AS resource`;

type RawLogRow = Omit<LogEventRow, 'attributes' | 'resource'> & {
  seq: number;
  attributes: string | null;
  resource: string | null;
};

const MAX_LIMIT = 500;

function clampLimit(limit: number, max = MAX_LIMIT) {
  return Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 100, 1), max);
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toLogRow({ seq: _seq, ...row }: RawLogRow): LogEventRow {
  return {
    ...row,
    createdAt: Number(row.createdAt),
    timeUs: Number(row.timeUs),
    attributes: parseJsonObject(row.attributes),
    resource: parseJsonObject(row.resource),
  };
}

function newestFirst(a: { timeUs: number; id: string }, b: { timeUs: number; id: string }) {
  return b.timeUs - a.timeUs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Runs one statement per source arm in a single round trip and returns the rows per arm. */
async function perArm<T>(
  sources: LogSources,
  arms: Partial<Record<LogSourceName, string>>,
  only: LogSourceName | undefined,
  build: (from: string, params: SqlParams, source: LogSourceName) => string,
  websiteId: string,
): Promise<Array<{ source: LogSourceName; rows: T[] }>> {
  const names = (Object.keys(arms) as LogSourceName[]).filter((name) => !only || name === only);
  if (!names.length) return [];
  const statements = names.map((name) => {
    const params = logParams(websiteId);
    const sql = build(`(${arms[name]}) l`, params, name);
    return sources.db.prepare(sql).bind(...params.values);
  });
  const results = await sources.db.batch<T>(statements);
  return names.map((source, i) => ({ source, rows: results[i]?.results ?? [] }));
}

/** A position in the newest-first list: the last row shown. */
export type LogPageCursor = { timeUs: number; id: string };

function beforeCondition(params: SqlParams, before: LogPageCursor) {
  const ms = params.add(Math.floor(before.timeUs / 1000));
  const us = params.add(before.timeUs);
  const id = params.add(before.id);
  return `(l.created_at < ${ms} OR (l.created_at = ${ms} AND (l.time_us < ${us} OR (l.time_us = ${us} AND l.id < ${id}))))`;
}

/** Newest log lines in the range, newest first. */
export async function getLogEvents(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
  limit = 100,
  before?: LogPageCursor,
) {
  const sources = logSources(env, websiteId);
  const take = clampLimit(limit);
  const perSource = await perArm<RawLogRow>(sources, sources.logArms, filters.source, (from, params) => {
    const conditions = [
      `l.created_at >= ${params.add(startAt)}`,
      `l.created_at <= ${params.add(endAt)}`,
      ...(before ? [beforeCondition(params, before)] : []),
      ...logConditions(params, filters),
    ];
    return `SELECT ${LOG_COLUMNS} FROM ${from} ${whereClause(conditions)}
      ORDER BY l.created_at DESC, l.time_us DESC, l.id DESC LIMIT ${take}`;
  }, websiteId);
  return perSource
    .flatMap(({ rows }) => rows.map(toLogRow))
    .sort(newestFirst)
    .slice(0, take);
}

/** Every line of one trace, oldest first (the trace view's log panel). */
export async function getTraceLogs(env: Env, websiteId: string, traceId: string, limit = 200) {
  const sources = logSources(env, websiteId);
  const take = clampLimit(limit);
  const perSource = await perArm<RawLogRow>(sources, sources.logArms, undefined, (from, params) => {
    return `SELECT ${LOG_COLUMNS} FROM ${from} ${whereClause(logConditions(params, { traceId }))}
      ORDER BY l.time_us ASC LIMIT ${take}`;
  }, websiteId);
  return perSource
    .flatMap(({ rows }) => rows.map(toLogRow))
    .sort((a, b) => -newestFirst(a, b))
    .slice(0, take);
}

/** Tail position: the last row seen per source, in insertion order (`seq`). */
export type LogTailCursor = Partial<Record<LogSourceName, number>>;

export function encodeTailCursor(cursor: LogTailCursor) {
  return `${cursor.otlp ?? 0}.${cursor.browser ?? 0}`;
}

export function decodeTailCursor(value: string | undefined): LogTailCursor | null {
  const match = /^(\d+)\.(\d+)$/.exec(value ?? '');
  return match ? { otlp: Number(match[1]), browser: Number(match[2]) } : null;
}

async function currentTailCursor(sources: LogSources): Promise<LogTailCursor> {
  const tables: Array<[LogSourceName, string]> = [['browser', 'website_event']];
  if (sources.otlp) tables.push(['otlp', 'log_record']);
  const results = await sources.db.batch<{ seq: number | null }>(
    tables.map(([, table]) => sources.db.prepare(`SELECT MAX(rowid) AS seq FROM ${table}`)),
  );
  return Object.fromEntries(tables.map(([name], i) => [name, Number(results[i]?.results?.[0]?.seq ?? 0)]));
}

export type LogTailResult = {
  /** Newest `createdAt` returned (or the `sinceAt` passed), for time-based polling. */
  cursor: number;
  /** Insertion-order cursor: pass back as `seq` to get exactly the lines stored since. */
  seq: string;
  logs: LogEventRow[];
};

/**
 * Live tail, oldest first.
 * - With a `seq` cursor: lines stored since, in insertion order per source. Late records (an
 *   exporter's batch stamped seconds ago) still show up, and nothing is skipped or repeated.
 * - Without one: `sinceAt <= 0` opens on the newest lines; a time pages forward from it.
 */
export async function getLogTail(
  env: Env,
  websiteId: string,
  sinceAt: number,
  filters: LogFilters = {},
  limit = 100,
  seq?: LogTailCursor | null,
): Promise<LogEventRow[]> {
  return (await tailLogs(env, websiteId, sinceAt, filters, limit, seq)).logs;
}

export async function tailLogs(
  env: Env,
  websiteId: string,
  sinceAt: number,
  filters: LogFilters = {},
  limit = 100,
  seq?: LogTailCursor | null,
): Promise<LogTailResult> {
  const sources = logSources(env, websiteId);
  const take = clampLimit(limit);
  let rows: RawLogRow[];
  let next: LogTailCursor;

  if (seq) {
    const perSource = await perArm<RawLogRow>(sources, sources.logArms, filters.source, (from, params, source) => {
      const conditions = [`l.seq > ${params.add(seq[source] ?? 0)}`, ...logConditions(params, filters)];
      return `SELECT ${LOG_COLUMNS} FROM ${from} ${whereClause(conditions)} ORDER BY l.seq ASC LIMIT ${take}`;
    }, websiteId);
    next = { ...seq };
    for (const { source, rows: sourceRows } of perSource) {
      for (const row of sourceRows) next[source] = Math.max(next[source] ?? 0, Number(row.seq));
    }
    rows = perSource.flatMap((entry) => entry.rows);
  } else {
    const initial = sinceAt <= 0;
    const [perSource, current] = await Promise.all([
      perArm<RawLogRow>(sources, sources.logArms, filters.source, (from, params) => {
        const conditions = [`l.created_at > ${params.add(sinceAt)}`, ...logConditions(params, filters)];
        const order = initial ? 'DESC' : 'ASC';
        return `SELECT ${LOG_COLUMNS} FROM ${from} ${whereClause(conditions)}
          ORDER BY l.created_at ${order}, l.time_us ${order}, l.id ${order} LIMIT ${take}`;
      }, websiteId),
      currentTailCursor(sources),
    ]);
    rows = perSource.flatMap((entry) => entry.rows);
    next = current;
  }

  const ordered = rows.map(toLogRow).sort((a, b) => -newestFirst(a, b));
  // First load keeps the newest lines; later pages keep the oldest (the rest follows next poll).
  const logs = !seq && sinceAt <= 0 ? ordered.slice(-take) : ordered.slice(0, take);
  const cursor = logs.reduce((latest, row) => Math.max(latest, row.createdAt), Math.max(sinceAt, 0));
  return { cursor, seq: encodeTailCursor(next), logs };
}

const HISTOGRAM_STEPS_MS = [
  1_000, 5_000, 10_000, 30_000, 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000, 3_600_000, 3 * 3_600_000,
  6 * 3_600_000, 12 * 3_600_000, 86_400_000, 7 * 86_400_000,
];

/** Bucket size giving at most ~`target` bars over the range. */
export function histogramBucketMs(startAt: number, endAt: number, target = 60) {
  const span = Math.max(endAt - startAt, 1);
  return HISTOGRAM_STEPS_MS.find((step) => span / step <= target) ?? HISTOGRAM_STEPS_MS[HISTOGRAM_STEPS_MS.length - 1]!;
}

/** Log counts per time bucket and severity (bars aligned to UTC bucket boundaries). */
export async function getLogHistogram(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
): Promise<LogHistogram> {
  const sources = logSources(env, websiteId);
  const bucketMs = histogramBucketMs(startAt, endAt);
  const params = logParams(websiteId);
  const bucket = params.add(bucketMs);
  const conditions = [
    `l.created_at >= ${params.add(startAt)}`,
    `l.created_at <= ${params.add(endAt)}`,
    ...logConditions(params, filters),
  ];
  const rows = await sources.db
    .prepare(
      // CAST floors: numbers are bound as REAL, so a bare division would not truncate.
      `SELECT CAST(l.created_at / ${bucket} AS INTEGER) * ${bucket} AS t, l.severity AS severity, COUNT(*) AS n
       FROM ${fromArms(sources.logArms, filters.source)} ${whereClause(conditions)}
       GROUP BY t, l.severity`,
    )
    .bind(...params.values)
    .all<{ t: number; severity: Severity; n: number }>();

  const empty = () => Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  const byBucket = new Map<number, { t: number; total: number } & Record<Severity, number>>();
  const first = Math.floor(startAt / bucketMs) * bucketMs;
  for (let t = first; t <= endAt; t += bucketMs) byBucket.set(t, { t, total: 0, ...empty() });
  for (const row of rows.results ?? []) {
    const entry = byBucket.get(Number(row.t)) ?? { t: Number(row.t), total: 0, ...empty() };
    const severity = (SEVERITIES as readonly string[]).includes(row.severity) ? row.severity : 'info';
    entry[severity] += Number(row.n);
    entry.total += Number(row.n);
    byBucket.set(entry.t, entry);
  }
  return { bucketMs, buckets: [...byBucket.values()].sort((a, b) => a.t - b.t) };
}

/** Totals and facets for the range (the explorer's header and filter options). */
export async function getLogStats(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
) {
  const sources = logSources(env, websiteId);
  const params = logParams(websiteId);
  const conditions = [
    `l.created_at >= ${params.add(startAt)}`,
    `l.created_at <= ${params.add(endAt)}`,
    ...logConditions(params, filters),
  ];
  const from = `${fromArms(sources.logArms, filters.source)} ${whereClause(conditions)}`;
  const facet = (column: string, alias: string) =>
    `SELECT l.${column} AS ${alias}, COUNT(*) AS logs FROM ${from} AND l.${column} IS NOT NULL
     GROUP BY l.${column} ORDER BY logs DESC, ${alias} ASC LIMIT 10`;
  const statements = [
    `SELECT COUNT(*) AS logs, COUNT(DISTINCT l.session_id) AS sessions, MAX(l.created_at) AS lastSeenAt FROM ${from}`,
    `SELECT l.severity AS level, COUNT(*) AS logs FROM ${from} GROUP BY l.severity ORDER BY logs DESC, level ASC`,
    `SELECT date(l.created_at / 1000, 'unixepoch') AS date, COUNT(*) AS logs, COUNT(DISTINCT l.session_id) AS sessions
     FROM ${from} GROUP BY date ORDER BY date ASC LIMIT 90`,
    facet('release', 'release'),
    facet('environment', 'environment'),
    facet('service', 'service'),
  ].map((sql) => sources.db.prepare(sql).bind(...params.values));
  // `from` always has a WHERE (the time range), so facets can append with AND.
  const [totals, levels, trend, releases, environments, services] = await sources.db.batch<Record<string, unknown>>(statements);
  const total = totals?.results?.[0] as { logs: number; sessions: number; lastSeenAt: number | null } | undefined;
  return {
    logs: total?.logs ?? 0,
    sessions: total?.sessions ?? 0,
    levels: (levels?.results ?? []) as Array<{ level: Severity; logs: number }>,
    trend: (trend?.results ?? []) as Array<{ date: string; logs: number; sessions: number }>,
    releases: (releases?.results ?? []) as Array<{ release: string; logs: number }>,
    environments: (environments?.results ?? []) as Array<{ environment: string; logs: number }>,
    services: (services?.results ?? []) as Array<{ service: string; logs: number }>,
    lastSeenAt: total?.lastSeenAt ?? null,
  };
}

/** Number of lines matching the filters in the range (log alerts). */
export async function countLogs(env: Env, websiteId: string, startAt: number, endAt: number, filters: LogFilters = {}) {
  const sources = logSources(env, websiteId);
  const params = logParams(websiteId);
  const conditions = [
    `l.created_at >= ${params.add(startAt)}`,
    `l.created_at <= ${params.add(endAt)}`,
    ...logConditions(params, filters),
  ];
  const row = await sources.db
    .prepare(`SELECT COUNT(*) AS count FROM ${fromArms(sources.logArms, filters.source)} ${whereClause(conditions)}`)
    .bind(...params.values)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getServiceSummaries(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
  limit = 100,
) {
  const sources = logSources(env, websiteId);
  const params = logParams(websiteId);
  const range = [`l.created_at >= ${params.add(startAt)}`, `l.created_at <= ${params.add(endAt)}`];
  const logWhere = whereClause([...range, 'l.service IS NOT NULL', ...logConditions(params, filters)]);
  const spanWhere = whereClause([...range, 'l.service IS NOT NULL']);
  const [logs, spans] = await sources.db.batch<Record<string, unknown>>([
    sources.db
      .prepare(
        `SELECT l.service AS service, COUNT(*) AS logs,
           SUM(CASE WHEN l.severity IN ('error', 'fatal') THEN 1 ELSE 0 END) AS errors,
           COUNT(DISTINCT l.trace_id) AS traces, MAX(l.created_at) AS lastSeenAt
         FROM ${fromArms(sources.logArms, filters.source)} ${logWhere}
         GROUP BY l.service`,
      )
      .bind(...params.values),
    sources.db
      .prepare(
        `SELECT l.service AS service, COUNT(*) AS spans, AVG(l.duration_us) AS avgUs, MAX(l.duration_us) AS maxUs,
           SUM(CASE WHEN l.status = 'error' THEN 1 ELSE 0 END) AS errors,
           COUNT(DISTINCT l.trace_id) AS traces, MAX(l.created_at) AS lastSeenAt
         FROM ${fromArms(sources.spanArms, filters.source)} ${spanWhere}
         GROUP BY l.service`,
      )
      .bind(...params.values),
  ]);

  const byService = new Map<string, ServiceSummaryRow>();
  for (const row of (logs?.results ?? []) as Array<Record<string, number | string>>) {
    byService.set(String(row.service), {
      service: String(row.service),
      logs: Number(row.logs),
      errors: Number(row.errors),
      traces: Number(row.traces),
      avgDurationMs: 0,
      maxDurationMs: 0,
      lastSeenAt: Number(row.lastSeenAt),
    });
  }
  // Durations come from spans. A service seen only in spans is listed when no log filter is set.
  const logFiltered = Object.values(filters).some((value) => value !== undefined && value !== '');
  for (const row of (spans?.results ?? []) as Array<Record<string, number | string>>) {
    const service = String(row.service);
    const existing = byService.get(service);
    if (!existing && logFiltered) continue;
    const entry = existing ?? {
      service,
      logs: 0,
      errors: Number(row.errors),
      traces: Number(row.traces),
      avgDurationMs: 0,
      maxDurationMs: 0,
      lastSeenAt: Number(row.lastSeenAt),
    };
    entry.avgDurationMs = Math.round(Number(row.avgUs) / 1000);
    entry.maxDurationMs = Math.round(Number(row.maxUs) / 1000);
    entry.traces = Math.max(entry.traces, Number(row.traces));
    entry.lastSeenAt = Math.max(entry.lastSeenAt, Number(row.lastSeenAt));
    byService.set(service, entry);
  }
  return [...byService.values()]
    .sort((a, b) => b.errors - a.errors || b.logs - a.logs || b.lastSeenAt - a.lastSeenAt)
    .slice(0, clampLimit(limit));
}

export type TraceFilters = {
  service?: string;
  environment?: string;
  release?: string;
  /** Substring of any span name. */
  search?: string;
  sessionId?: string;
  traceId?: string;
  errorsOnly?: boolean;
  source?: LogSourceName;
};

export async function getTraceSummaries(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: TraceFilters = {},
  limit = 100,
): Promise<TraceSummaryRow[]> {
  const sources = logSources(env, websiteId);
  const params = logParams(websiteId);
  const range = [`l.created_at >= ${params.add(startAt)}`, `l.created_at <= ${params.add(endAt)}`];
  // A trace matches when any of its spans does; its totals still count all of its spans.
  const match = logConditions(
    params,
    {
      service: filters.service,
      environment: filters.environment,
      release: filters.release,
      search: filters.search,
      sessionId: filters.sessionId,
      traceId: filters.traceId,
    },
    'l.name',
  );
  const having = [
    ...(match.length ? [`MAX(CASE WHEN ${match.join(' AND ')} THEN 1 ELSE 0 END) = 1`] : []),
    ...(filters.errorsOnly ? ['hasError = 1'] : []),
  ];
  const rows = await sources.db
    .prepare(
      `SELECT l.trace_id AS traceId, COUNT(*) AS spans, COUNT(DISTINCT COALESCE(l.service, '')) AS services,
         MAX(CASE WHEN l.parent_span_id IS NULL THEN l.name END) AS rootName,
         MAX(CASE WHEN l.parent_span_id IS NULL THEN l.service END) AS rootService,
         MIN(l.start_us) AS startUs, MAX(l.start_us + l.duration_us) AS endUs,
         MAX(l.duration_us) AS maxSpanDurationUs,
         MAX(CASE WHEN l.status = 'error' THEN 1 ELSE 0 END) AS hasError,
         MAX(l.session_id) AS sessionId
       FROM ${fromArms(sources.spanArms, filters.source)} ${whereClause([...range, 'l.trace_id IS NOT NULL'])}
       GROUP BY l.trace_id
       ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
       ORDER BY startUs DESC
       LIMIT ${clampLimit(limit)}`,
    )
    .bind(...params.values)
    .all<Record<string, number | string | null>>();

  return (rows.results ?? []).map((row) => {
    const startedAt = Math.floor(Number(row.startUs) / 1000);
    const endedAt = Math.floor(Number(row.endUs) / 1000);
    return {
      traceId: String(row.traceId),
      spans: Number(row.spans),
      services: Number(row.services),
      rootName: (row.rootName as string | null) ?? null,
      rootService: (row.rootService as string | null) ?? null,
      startedAt,
      endedAt,
      durationMs: Math.max(0, Math.round((Number(row.endUs) - Number(row.startUs)) / 1000)),
      maxSpanDurationMs: Math.round(Number(row.maxSpanDurationUs) / 1000),
      hasError: Boolean(row.hasError),
      sessionId: (row.sessionId as string | null) ?? null,
    };
  });
}

type RawSpanRow = Record<string, unknown>;

function toSpanRow(row: RawSpanRow): TraceSpanRow {
  const durationUs = Number(row.durationUs) || 0;
  return {
    id: String(row.id),
    source: row.source as LogSourceName,
    traceId: String(row.traceId),
    spanId: String(row.spanId),
    parentSpanId: (row.parentSpanId as string | null) ?? null,
    name: String(row.name ?? ''),
    kind: String(row.kind ?? 'unspecified'),
    service: (row.service as string | null) ?? null,
    release: (row.release as string | null) ?? null,
    environment: (row.environment as string | null) ?? null,
    createdAt: Number(row.createdAt),
    startUs: Number(row.startUs),
    durationUs,
    durationMs: Math.round(durationUs / 1000),
    status: (row.status as TraceSpanRow['status']) ?? 'unset',
    statusMessage: (row.statusMessage as string | null) ?? null,
    sessionId: (row.sessionId as string | null) ?? null,
    attributes: parseJsonObject(row.attributes as string | null),
    resource: parseJsonObject(row.resource as string | null),
    events: parseJsonArray(row.events as string | null),
    links: parseJsonArray(row.links as string | null),
  };
}

/** All spans of a trace (waterfall order) and the log lines that carry its id. */
export async function getTraceDetail(env: Env, websiteId: string, traceId: string): Promise<TraceDetailRow | null> {
  const sources = logSources(env, websiteId);
  const params = logParams(websiteId);
  const where = whereClause(logConditions(params, { traceId }));
  const [spanRows, logs] = await Promise.all([
    sources.db
      .prepare(
        `SELECT l.id AS id, l.source AS source, l.trace_id AS traceId, l.span_id AS spanId,
           l.parent_span_id AS parentSpanId, l.name AS name, l.kind AS kind, l.service AS service,
           l.release AS release, l.environment AS environment, l.created_at AS createdAt,
           l.start_us AS startUs, l.duration_us AS durationUs, l.status AS status,
           l.status_message AS statusMessage, l.session_id AS sessionId, l.attributes AS attributes,
           l.resource AS resource, l.events AS events, l.links AS links
         FROM ${fromArms(sources.spanArms)} ${where}
         ORDER BY l.start_us ASC, l.id ASC
         LIMIT 2000`,
      )
      .bind(...params.values)
      .all<RawSpanRow>(),
    getTraceLogs(env, websiteId, traceId),
  ]);
  const spans = (spanRows.results ?? []).map(toSpanRow);
  if (!spans.length && !logs.length) return null;

  const starts = [...spans.map((span) => span.startUs / 1000), ...logs.map((log) => log.createdAt)];
  const ends = [...spans.map((span) => (span.startUs + span.durationUs) / 1000), ...logs.map((log) => log.createdAt)];
  const startedAt = Math.floor(Math.min(...starts));
  const endedAt = Math.ceil(Math.max(...ends));
  const services = Array.from(
    new Set([...spans, ...logs].map((item) => item.service).filter((value): value is string => Boolean(value))),
  );
  const sessionId = [...spans, ...logs].find((item) => item.sessionId)?.sessionId ?? null;
  return {
    traceId: spans[0]?.traceId ?? traceId,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    services,
    sessionId,
    spans,
    logs,
  };
}

/** Evaluates enabled log alert rules: a count of matching lines over the window at or above the threshold. */
export async function evaluateLogAlertRules(env: Env, websiteId: string, now = Date.now()) {
  const rules = (await listLogAlertRules(env, websiteId)).filter((rule) => rule.enabled);
  const triggered: TriggeredLogAlertRow[] = [];

  for (const rule of rules) {
    const windowStartAt = now - rule.windowMinutes * 60 * 1000;
    const recentlyTriggered = await hasRecentAlertEvent(env, 'log_alert_event', rule.id, websiteId, windowStartAt);
    if (recentlyTriggered) continue;

    const count = await countLogs(env, websiteId, windowStartAt, now, {
      levels: rule.level && (SEVERITIES as readonly string[]).includes(rule.level) ? [rule.level as Severity] : undefined,
      service: rule.service ?? undefined,
      search: rule.search ?? undefined,
      release: rule.release ?? undefined,
      environment: rule.environment ?? undefined,
      attributes: rule.attributeKey
        ? [{ key: rule.attributeKey, value: rule.attributeValue ?? undefined }]
        : undefined,
    });
    if (count < rule.threshold) continue;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO log_alert_event
         (alert_event_id, alert_rule_id, website_id, count, threshold, window_start_at, window_end_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
      .bind(id, rule.id, websiteId, count, rule.threshold, windowStartAt, now)
      .run();

    triggered.push({
      id,
      alertRuleId: rule.id,
      websiteId,
      count,
      threshold: rule.threshold,
      windowStartAt,
      windowEndAt: now,
      createdAt: now,
    });

    await deliverAlertNotification(env, {
      websiteId,
      ruleName: rule.name,
      channel: rule.channel,
      target: rule.target,
      count,
      threshold: rule.threshold,
      windowMinutes: rule.windowMinutes,
      kind: 'log',
    });
  }

  return triggered;
}
