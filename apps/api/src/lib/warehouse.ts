import type { Env } from '../env';

const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|pragma|vacuum|reindex)\b/i;
const UNSAFE_SCOPE_SQL = [
  /\bUNION\b/i,
  /\bINTERSECT\b/i,
  /\bEXCEPT\b/i,
  /website_id\s*(?:!=|<>)/i,
  /website_id\s*=\s*['"]/i,
  /\bOR\s+(?:1\s*=\s*1|'1'\s*=\s*'1'|TRUE|0\s*=\s*0)\b/i,
];
const DEFAULT_LIMIT = 100;
const MAX_USER_LIMIT = 1000;
const MAX_ROWS_READ = 100_000;
const QUERY_TIMEOUT_MS = 10_000;
const MAX_IMPORT_ROWS = 10_000;
const IMPORT_BATCH_SIZE = 100;
const MAX_IMPORT_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_SYNC_WEBSITES_PER_TICK = 50;
const MIN_SCHEDULE_INTERVAL_MINUTES = 1;

export type WarehouseQueryCost = {
  rowsRead: number;
  durationMs: number;
};

export const WAREHOUSE_QUERY_LIMITS = {
  defaultLimit: DEFAULT_LIMIT,
  maxUserLimit: MAX_USER_LIMIT,
  maxRowsRead: MAX_ROWS_READ,
  timeoutMs: QUERY_TIMEOUT_MS,
} as const;

export type WarehouseQueryDiagnostic = {
  code:
    | 'empty_sql'
    | 'not_read_only'
    | 'multiple_statements'
    | 'forbidden_keyword'
    | 'forbidden_table'
    | 'missing_website_scope'
    | 'missing_limit'
    | 'ready';
  level: 'error' | 'warning' | 'success';
  message: string;
};

export type WarehouseQueryAnalysis = {
  valid: boolean;
  normalizedSql: string;
  executableSql: string | null;
  hasLimit: boolean;
  autoLimit: number | null;
  diagnostics: WarehouseQueryDiagnostic[];
};

export type WarehouseSavedQueryInput = {
  name: string;
  description: string;
  sql: string;
};

export type WarehouseSavedQueryPatch = Partial<WarehouseSavedQueryInput>;

export type WarehouseSavedQueryRow = {
  id: string;
  websiteId: string;
  userId: string | null;
  name: string;
  description: string;
  sql: string;
  createdAt: number | null;
  updatedAt: number | null;
  analysis: WarehouseQueryAnalysis;
};

export type WarehouseQueryHistoryRow = {
  id: string;
  websiteId: string;
  userId: string | null;
  sql: string;
  status: 'success' | 'failed';
  rowCount: number;
  error: string | null;
  durationMs: number;
  createdAt: number | null;
};

export type WarehouseQueryHistoryInput = Pick<
  WarehouseQueryHistoryRow,
  'sql' | 'status' | 'rowCount' | 'error' | 'durationMs'
>;

export type WarehouseScheduledQueryInput = {
  name: string;
  description: string;
  sql: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt?: number;
};

export type WarehouseScheduledQueryPatch = Partial<WarehouseScheduledQueryInput>;

export type WarehouseScheduledQueryRow = {
  id: string;
  websiteId: string;
  userId: string | null;
  name: string;
  description: string;
  sql: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: 'success' | 'failed' | null;
  lastError: string | null;
  lastRowCount: number;
  createdAt: number | null;
  updatedAt: number | null;
  analysis: WarehouseQueryAnalysis;
};

export type WarehouseDataSourceInput = {
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

export type WarehouseDataSourcePatch = Partial<
  WarehouseDataSourceInput & {
    lastSyncAt: number | null;
    lastStatus: 'connected' | 'failed' | 'syncing' | null;
    lastError: string | null;
  }
>;

export type WarehouseDataSourceRow = {
  id: string;
  websiteId: string;
  userId: string | null;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  lastSyncAt: number | null;
  lastStatus: 'connected' | 'failed' | 'syncing' | null;
  lastError: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export const WAREHOUSE_SCHEMA = {
  tables: [
    {
      name: 'website_event',
      description: 'Raw pageviews, custom events, feature flag calls, logs, errors, AI calls, and revenue events.',
      columns: [
        'event_id',
        'website_id',
        'session_id',
        'visit_id',
        'created_at',
        'url_path',
        'event_type',
        'event_name',
        'revenue',
        'currency',
      ],
    },
    {
      name: 'event_data',
      description: 'Key/value properties attached to website events.',
      columns: [
        'event_data_id',
        'website_id',
        'website_event_id',
        'data_key',
        'string_value',
        'number_value',
        'data_type',
        'created_at',
      ],
    },
    {
      name: 'session',
      description: 'Visitor session metadata such as browser, device, geography, and language.',
      columns: [
        'session_id',
        'website_id',
        'browser',
        'os',
        'device',
        'country',
        'region',
        'city',
        'language',
        'created_at',
      ],
    },
    {
      name: 'survey_response',
      description: 'In-product survey answers connected to sessions and pages.',
      columns: [
        'response_id',
        'survey_id',
        'website_id',
        'session_id',
        'visit_id',
        'answer',
        'url_path',
        'created_at',
      ],
    },
    {
      name: 'workflow_execution',
      description: 'Workflow executions triggered by product events.',
      columns: [
        'execution_id',
        'workflow_id',
        'website_id',
        'session_id',
        'event_id',
        'event_name',
        'status',
        'error',
        'created_at',
      ],
    },
    {
      name: 'warehouse_import',
      description: 'Rows imported from external HTTP JSON warehouse data sources.',
      columns: [
        'import_row_id',
        'website_id',
        'data_source_id',
        'primary_key',
        'payload_json',
        'imported_at',
      ],
    },
  ],
  examples: [
    {
      name: 'Recent events',
      category: 'Events',
      sql: `SELECT event_name as eventName, url_path as urlPath, created_at as createdAt
FROM website_event
WHERE website_id = ?1
ORDER BY created_at DESC
LIMIT 50`,
    },
    {
      name: 'Top custom events',
      category: 'Events',
      sql: `SELECT event_name as eventName, COUNT(*) as events
FROM website_event
WHERE website_id = ?1 AND event_name IS NOT NULL
GROUP BY event_name
ORDER BY events DESC
LIMIT 20`,
    },
    {
      name: 'Sessions by country',
      category: 'Audience',
      sql: `SELECT COALESCE(country, 'unknown') as country, COUNT(*) as sessions
FROM session
WHERE website_id = ?1
GROUP BY COALESCE(country, 'unknown')
ORDER BY sessions DESC
LIMIT 20`,
    },
    {
      name: 'Feature flag exposures',
      category: 'Experiments',
      sql: `SELECT response.string_value as variant, COUNT(*) as exposures
FROM website_event e
JOIN event_data flag ON flag.website_event_id = e.event_id AND flag.data_key = '$feature_flag'
JOIN event_data response ON response.website_event_id = e.event_id AND response.data_key = '$feature_flag_response'
WHERE e.website_id = ?1
GROUP BY response.string_value
ORDER BY exposures DESC
LIMIT 20`,
    },
    {
      name: 'Survey answers',
      category: 'Feedback',
      sql: `SELECT answer, COUNT(*) as responses
FROM survey_response
WHERE website_id = ?1
GROUP BY answer
ORDER BY responses DESC
LIMIT 20`,
    },
    {
      name: 'Workflow failures',
      category: 'Automation',
      sql: `SELECT event_name as eventName, error, created_at as createdAt
FROM workflow_execution
WHERE website_id = ?1 AND status = 'failed'
ORDER BY created_at DESC
LIMIT 50`,
    },
    {
      name: 'Error events',
      category: 'Quality',
      sql: `SELECT e.event_name as eventName, message.string_value as message, e.url_path as urlPath, e.created_at as createdAt
FROM website_event e
LEFT JOIN event_data message ON message.website_event_id = e.event_id AND message.data_key = 'message'
WHERE e.website_id = ?1 AND e.event_name = '$exception'
ORDER BY e.created_at DESC
LIMIT 50`,
    },
    {
      name: 'AI cost by model',
      category: 'AI',
      sql: `SELECT model.string_value as model, COUNT(*) as calls, SUM(cost.number_value) as costUsd
FROM website_event e
LEFT JOIN event_data model ON model.website_event_id = e.event_id AND model.data_key = 'model'
LEFT JOIN event_data cost ON cost.website_event_id = e.event_id AND cost.data_key = 'costUsd'
WHERE e.website_id = ?1 AND e.event_name = '$ai_call'
GROUP BY model.string_value
ORDER BY costUsd DESC
LIMIT 20`,
    },
  ],
};

function normalizeSql(sql: string) {
  return sql.trim().replace(/\s+/g, ' ');
}

const ALLOWED_TABLES = new Set(WAREHOUSE_SCHEMA.tables.map((table) => table.name));

function stripStringLiterals(sql: string) {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

function collectCteNames(stripped: string) {
  const names = new Set<string>();
  const cteRe = /(?:\bwith\b|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = cteRe.exec(stripped))) {
    names.add(match[1]!.toLowerCase());
  }
  return names;
}

/**
 * Extracts every table referenced via FROM/JOIN, including comma joins
 * (`FROM a x, b y`). String literals are stripped first so quoted text
 * cannot spoof or hide references.
 */
function collectTableReferences(stripped: string) {
  const refs = new Set<string>();
  const fromJoinRe = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi;
  const commaRe = /^(?:\s+(?:as\s+)?(?!on\b|where\b|group\b|order\b|limit\b|having\b|join\b|left\b|right\b|inner\b|outer\b|cross\b|full\b|natural\b|using\b)[a-z_][a-z0-9_]*)?\s*,\s*([a-z_][a-z0-9_]*)/i;
  let match: RegExpExecArray | null;
  while ((match = fromJoinRe.exec(stripped))) {
    refs.add(match[1]!.toLowerCase());
    // Follow comma-separated table lists after the first FROM target.
    let rest = stripped.slice(fromJoinRe.lastIndex);
    let commaMatch = commaRe.exec(rest);
    while (commaMatch) {
      refs.add(commaMatch[1]!.toLowerCase());
      rest = rest.slice(commaMatch[0].length);
      commaMatch = commaRe.exec(rest);
    }
  }
  return refs;
}

function findForbiddenTables(normalized: string): string[] {
  const stripped = stripStringLiterals(normalized);
  const cteNames = collectCteNames(stripped);
  const refs = collectTableReferences(stripped);
  const forbidden: string[] = [];
  for (const ref of refs) {
    if (!ALLOWED_TABLES.has(ref) && !cteNames.has(ref)) forbidden.push(ref);
  }
  return forbidden;
}

export function analyzeWarehouseQuery(sql: string): WarehouseQueryAnalysis {
  const normalized = normalizeSql(sql);
  const diagnostics: WarehouseQueryDiagnostic[] = [];
  if (!normalized) {
    diagnostics.push({ code: 'empty_sql', level: 'error', message: 'SQL is required' });
  }
  if (!/^(select|with)\b/i.test(normalized)) {
    diagnostics.push({
      code: 'not_read_only',
      level: 'error',
      message: 'Only read-only SELECT queries are allowed',
    });
  }
  if (normalized.includes(';') || /--|\/\*/.test(normalized)) {
    diagnostics.push({
      code: 'multiple_statements',
      level: 'error',
      message: 'Only a single read-only query is allowed',
    });
  }
  if (FORBIDDEN_SQL.test(normalized)) {
    diagnostics.push({
      code: 'forbidden_keyword',
      level: 'error',
      message: 'Only read-only SELECT queries are allowed',
    });
  }
  const forbiddenTables = normalized ? findForbiddenTables(normalized) : [];
  if (forbiddenTables.length) {
    diagnostics.push({
      code: 'forbidden_table',
      level: 'error',
      message: `Table not allowed in warehouse queries: ${forbiddenTables.join(', ')}`,
    });
  }
  if (!/\bwebsite_id\s*=\s*\?1\b/i.test(normalized)) {
    diagnostics.push({
      code: 'missing_website_scope',
      level: 'error',
      message: 'Warehouse queries must scope reads with website_id = ?1',
    });
  }
  for (const pattern of UNSAFE_SCOPE_SQL) {
    if (pattern.test(normalized)) {
      diagnostics.push({
        code: 'missing_website_scope',
        level: 'error',
        message: 'Warehouse query must keep website_id = ?1 as the only tenant filter',
      });
      break;
    }
  }

  const hasLimit = /\blimit\s+\d+\b/i.test(normalized);
  if (normalized && !hasLimit) {
    diagnostics.push({
      code: 'missing_limit',
      level: 'warning',
      message: `No LIMIT detected; results will be capped at ${DEFAULT_LIMIT} rows`,
    });
  }
  if (!diagnostics.some((item) => item.level === 'error')) {
    diagnostics.push({ code: 'ready', level: 'success', message: 'Query is ready to run' });
  }

  const valid = !diagnostics.some((item) => item.level === 'error');
  return {
    valid,
    normalizedSql: normalized,
    executableSql: valid ? withLimit(normalized, hasLimit) : null,
    hasLimit,
    autoLimit: hasLimit ? null : DEFAULT_LIMIT,
    diagnostics,
  };
}

function assertReadOnlyScoped(sql: string) {
  const analysis = analyzeWarehouseQuery(sql);
  const error = analysis.diagnostics.find((item) => item.level === 'error');
  if (error) throw new Error(error.message);
  return analysis;
}

function withLimit(sql: string, hasLimit = /\blimit\s+\d+\b/i.test(sql)) {
  if (!hasLimit) return `SELECT * FROM (${sql}) LIMIT ${DEFAULT_LIMIT}`;
  // A user-supplied LIMIT is honored but hard-capped so a huge value cannot
  // produce unbounded result sets; the outer LIMIT keeps smaller ones intact.
  const declared = sql.match(/\blimit\s+(\d+)\b/gi)?.map((part) => Number(part.replace(/\D+/g, '')));
  const maxDeclared = declared?.length ? Math.max(...declared) : 0;
  if (maxDeclared <= MAX_USER_LIMIT) return sql;
  return `SELECT * FROM (${sql}) LIMIT ${MAX_USER_LIMIT}`;
}

function queryDurationMs(meta: D1Meta | undefined, wallMs: number) {
  const sqlMs = meta?.timings?.sql_duration_ms;
  if (typeof sqlMs === 'number' && Number.isFinite(sqlMs)) return sqlMs;
  const duration = meta?.duration;
  if (typeof duration === 'number' && Number.isFinite(duration)) return duration * 1000;
  return wallMs;
}

export function enforceWarehouseQueryCost(
  meta: Pick<D1Meta, 'rows_read'> | undefined,
  durationMs: number,
  limits: Pick<typeof WAREHOUSE_QUERY_LIMITS, 'maxRowsRead' | 'timeoutMs'> = WAREHOUSE_QUERY_LIMITS,
) {
  const rowsRead = meta?.rows_read ?? 0;
  if (rowsRead > limits.maxRowsRead) {
    throw new Error(
      `Query scanned ${rowsRead.toLocaleString()} rows; maximum allowed is ${limits.maxRowsRead.toLocaleString()}`,
    );
  }
  if (durationMs > limits.timeoutMs) {
    throw new Error(`Query exceeded ${limits.timeoutMs}ms timeout`);
  }
  return { rowsRead, durationMs };
}

async function withQueryTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Query exceeded ${timeoutMs}ms timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runWarehouseQuery(env: Env, websiteId: string, sql: string) {
  const analysis = assertReadOnlyScoped(sql);
  const startedAt = Date.now();
  const rows = await withQueryTimeout(
    env.DB.prepare(analysis.executableSql!).bind(websiteId).all<Record<string, unknown>>(),
    QUERY_TIMEOUT_MS,
  );
  const wallMs = Date.now() - startedAt;
  const cost = enforceWarehouseQueryCost(rows.meta, queryDurationMs(rows.meta, wallMs));
  const resultRows = rows.results ?? [];
  const columns = resultRows.length ? Object.keys(resultRows[0]!) : [];
  return {
    columns,
    rows: resultRows,
    rowCount: resultRows.length,
    cost,
    analysis,
  };
}

export function getWarehouseSchema() {
  return WAREHOUSE_SCHEMA;
}

function serializeSavedQuery(row: Omit<WarehouseSavedQueryRow, 'analysis'>) {
  return {
    ...row,
    analysis: analyzeWarehouseQuery(row.sql),
  };
}

function serializeScheduledQuery(row: Omit<WarehouseScheduledQueryRow, 'analysis'>) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    analysis: analyzeWarehouseQuery(row.sql),
  };
}

function parseConfigJson(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

type WarehouseDataSourceDbRow = Omit<WarehouseDataSourceRow, 'config'> & { configJson: string };

function serializeDataSource(row: WarehouseDataSourceDbRow): WarehouseDataSourceRow {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    config: parseConfigJson(row.configJson),
  };
}

export async function listWarehouseSavedQueries(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT saved_query_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            description,
            sql,
            created_at as createdAt,
            updated_at as updatedAt
     FROM warehouse_saved_query
     WHERE website_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(websiteId)
    .all<Omit<WarehouseSavedQueryRow, 'analysis'>>();

  return (rows.results ?? []).map(serializeSavedQuery);
}

export async function getWarehouseSavedQuery(env: Env, websiteId: string, savedQueryId: string) {
  const row = await env.DB.prepare(
    `SELECT saved_query_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            description,
            sql,
            created_at as createdAt,
            updated_at as updatedAt
     FROM warehouse_saved_query
     WHERE website_id = ?1 AND saved_query_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, savedQueryId)
    .first<Omit<WarehouseSavedQueryRow, 'analysis'>>();

  return row ? serializeSavedQuery(row) : null;
}

export async function createWarehouseSavedQuery(
  env: Env,
  websiteId: string,
  userId: string | null,
  input: WarehouseSavedQueryInput,
) {
  assertReadOnlyScoped(input.sql);
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO warehouse_saved_query
       (saved_query_id, website_id, user_id, name, description, sql, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
  )
    .bind(id, websiteId, userId, input.name.trim(), input.description.trim(), input.sql.trim(), now)
    .run();
  const saved = await getWarehouseSavedQuery(env, websiteId, id);
  if (!saved) throw new Error('Warehouse saved query creation failed');
  return saved;
}

export async function updateWarehouseSavedQuery(
  env: Env,
  websiteId: string,
  savedQueryId: string,
  patch: WarehouseSavedQueryPatch,
) {
  const existing = await getWarehouseSavedQuery(env, websiteId, savedQueryId);
  if (!existing) return null;
  const nextSql = patch.sql?.trim() ?? existing.sql;
  assertReadOnlyScoped(nextSql);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE warehouse_saved_query
     SET name = ?3,
         description = ?4,
         sql = ?5,
         updated_at = ?6
     WHERE website_id = ?1 AND saved_query_id = ?2`,
  )
    .bind(
      websiteId,
      savedQueryId,
      patch.name?.trim() ?? existing.name,
      patch.description?.trim() ?? existing.description,
      nextSql,
      now,
    )
    .run();
  return getWarehouseSavedQuery(env, websiteId, savedQueryId);
}

export async function deleteWarehouseSavedQuery(env: Env, websiteId: string, savedQueryId: string) {
  const existing = await getWarehouseSavedQuery(env, websiteId, savedQueryId);
  if (!existing) return false;
  await env.DB.prepare(`DELETE FROM warehouse_saved_query WHERE website_id = ?1 AND saved_query_id = ?2`)
    .bind(websiteId, savedQueryId)
    .run();
  return true;
}

export async function recordWarehouseQueryHistory(
  env: Env,
  websiteId: string,
  userId: string | null,
  input: WarehouseQueryHistoryInput,
) {
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO warehouse_query_history
       (history_id, website_id, user_id, sql, status, row_count, error, duration_ms, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      id,
      websiteId,
      userId,
      input.sql.trim(),
      input.status,
      input.rowCount,
      input.error,
      Math.max(0, Math.round(input.durationMs)),
      now,
    )
    .run();

  return id;
}

export async function listWarehouseQueryHistory(env: Env, websiteId: string, limit = 100) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const rows = await env.DB.prepare(
    `SELECT history_id as id,
            website_id as websiteId,
            user_id as userId,
            sql,
            status,
            row_count as rowCount,
            error,
            duration_ms as durationMs,
            created_at as createdAt
     FROM warehouse_query_history
     WHERE website_id = ?1
     ORDER BY created_at DESC
     LIMIT ?2`,
  )
    .bind(websiteId, safeLimit)
    .all<WarehouseQueryHistoryRow>();

  return rows.results ?? [];
}

export async function listWarehouseScheduledQueries(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT scheduled_query_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            description,
            sql,
            enabled,
            interval_minutes as intervalMinutes,
            next_run_at as nextRunAt,
            last_run_at as lastRunAt,
            last_status as lastStatus,
            last_error as lastError,
            last_row_count as lastRowCount,
            created_at as createdAt,
            updated_at as updatedAt
     FROM warehouse_scheduled_query
     WHERE website_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(websiteId)
    .all<Omit<WarehouseScheduledQueryRow, 'analysis'>>();

  return (rows.results ?? []).map(serializeScheduledQuery);
}

export async function getWarehouseScheduledQuery(env: Env, websiteId: string, scheduledQueryId: string) {
  const row = await env.DB.prepare(
    `SELECT scheduled_query_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            description,
            sql,
            enabled,
            interval_minutes as intervalMinutes,
            next_run_at as nextRunAt,
            last_run_at as lastRunAt,
            last_status as lastStatus,
            last_error as lastError,
            last_row_count as lastRowCount,
            created_at as createdAt,
            updated_at as updatedAt
     FROM warehouse_scheduled_query
     WHERE website_id = ?1 AND scheduled_query_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, scheduledQueryId)
    .first<Omit<WarehouseScheduledQueryRow, 'analysis'>>();

  return row ? serializeScheduledQuery(row) : null;
}

export async function createWarehouseScheduledQuery(
  env: Env,
  websiteId: string,
  userId: string | null,
  input: WarehouseScheduledQueryInput,
) {
  assertReadOnlyScoped(input.sql);
  assertScheduleInterval(input.intervalMinutes);
  const now = Date.now();
  const id = crypto.randomUUID();
  const nextRunAt = input.nextRunAt ?? now + input.intervalMinutes * 60_000;
  await env.DB.prepare(
    `INSERT INTO warehouse_scheduled_query
       (scheduled_query_id, website_id, user_id, name, description, sql, enabled, interval_minutes, next_run_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
  )
    .bind(
      id,
      websiteId,
      userId,
      input.name.trim(),
      input.description.trim(),
      input.sql.trim(),
      input.enabled ? 1 : 0,
      input.intervalMinutes,
      nextRunAt,
      now,
    )
    .run();
  const schedule = await getWarehouseScheduledQuery(env, websiteId, id);
  if (!schedule) throw new Error('Warehouse scheduled query creation failed');
  return schedule;
}

export async function updateWarehouseScheduledQuery(
  env: Env,
  websiteId: string,
  scheduledQueryId: string,
  patch: WarehouseScheduledQueryPatch,
) {
  const existing = await getWarehouseScheduledQuery(env, websiteId, scheduledQueryId);
  if (!existing) return null;
  const nextSql = patch.sql?.trim() ?? existing.sql;
  assertReadOnlyScoped(nextSql);
  assertScheduleInterval(patch.intervalMinutes ?? existing.intervalMinutes);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE warehouse_scheduled_query
     SET name = ?3,
         description = ?4,
         sql = ?5,
         enabled = ?6,
         interval_minutes = ?7,
         next_run_at = ?8,
         updated_at = ?9
     WHERE website_id = ?1 AND scheduled_query_id = ?2`,
  )
    .bind(
      websiteId,
      scheduledQueryId,
      patch.name?.trim() ?? existing.name,
      patch.description?.trim() ?? existing.description,
      nextSql,
      (patch.enabled ?? existing.enabled) ? 1 : 0,
      patch.intervalMinutes ?? existing.intervalMinutes,
      patch.nextRunAt ?? existing.nextRunAt,
      now,
    )
    .run();
  return getWarehouseScheduledQuery(env, websiteId, scheduledQueryId);
}

export async function deleteWarehouseScheduledQuery(env: Env, websiteId: string, scheduledQueryId: string) {
  const existing = await getWarehouseScheduledQuery(env, websiteId, scheduledQueryId);
  if (!existing) return false;
  await env.DB.prepare(`DELETE FROM warehouse_scheduled_query WHERE website_id = ?1 AND scheduled_query_id = ?2`)
    .bind(websiteId, scheduledQueryId)
    .run();
  return true;
}

export async function runDueWarehouseScheduledQueries(env: Env, websiteId: string, now = Date.now()) {
  const due = await env.DB.prepare(
    `SELECT scheduled_query_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            description,
            sql,
            enabled,
            interval_minutes as intervalMinutes,
            next_run_at as nextRunAt,
            last_run_at as lastRunAt,
            last_status as lastStatus,
            last_error as lastError,
            last_row_count as lastRowCount,
            created_at as createdAt,
            updated_at as updatedAt
     FROM warehouse_scheduled_query
     WHERE website_id = ?1 AND enabled = 1 AND next_run_at <= ?2
     ORDER BY next_run_at ASC
     LIMIT 25`,
  )
    .bind(websiteId, now)
    .all<Omit<WarehouseScheduledQueryRow, 'analysis'>>();

  const schedules: WarehouseScheduledQueryRow[] = [];
  for (const row of due.results ?? []) {
    const startedAt = Date.now();
    const nextRunAt = Math.max(now, row.nextRunAt) + row.intervalMinutes * 60_000;
    let lastStatus: 'success' | 'failed';
    let lastError: string | null;
    let lastRowCount: number;
    try {
      const result = await runWarehouseQuery(env, websiteId, row.sql);
      lastStatus = 'success';
      lastError = null;
      lastRowCount = result.rowCount;
    } catch (error) {
      lastStatus = 'failed';
      lastError = error instanceof Error ? error.message : String(error);
      lastRowCount = 0;
    }
    const finishedAt = Date.now();
    await recordWarehouseQueryHistory(env, websiteId, row.userId, {
      sql: row.sql,
      status: lastStatus,
      rowCount: lastRowCount,
      error: lastError,
      durationMs: finishedAt - startedAt,
    });
    await env.DB.prepare(
      `UPDATE warehouse_scheduled_query
       SET next_run_at = ?3,
           last_run_at = ?4,
           last_status = ?5,
           last_error = ?6,
           last_row_count = ?7,
           updated_at = ?4
       WHERE website_id = ?1 AND scheduled_query_id = ?2`,
    )
      .bind(websiteId, row.id, nextRunAt, finishedAt, lastStatus, lastError, lastRowCount)
      .run();
    schedules.push(
      serializeScheduledQuery({
        ...row,
        nextRunAt,
        lastRunAt: finishedAt,
        lastStatus,
        lastError,
        lastRowCount,
        updatedAt: finishedAt,
      }),
    );
  }

  return { executedCount: schedules.length, schedules };
}

export async function listWarehouseDataSources(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT data_source_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            type,
            enabled,
            config_json as configJson,
            last_sync_at as lastSyncAt,
            last_status as lastStatus,
            last_error as lastError,
            created_at as createdAt,
            updated_at as updatedAt
     FROM warehouse_data_source
     WHERE website_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(websiteId)
    .all<WarehouseDataSourceDbRow>();

  return (rows.results ?? []).map(serializeDataSource);
}

export async function getWarehouseDataSource(env: Env, websiteId: string, dataSourceId: string) {
  const row = await env.DB.prepare(
    `SELECT data_source_id as id,
            website_id as websiteId,
            user_id as userId,
            name,
            type,
            enabled,
            config_json as configJson,
            last_sync_at as lastSyncAt,
            last_status as lastStatus,
            last_error as lastError,
            created_at as createdAt,
            updated_at as updatedAt
     FROM warehouse_data_source
     WHERE website_id = ?1 AND data_source_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, dataSourceId)
    .first<WarehouseDataSourceDbRow>();

  return row ? serializeDataSource(row) : null;
}

function assertDataSourceConfig(type: string, config: Record<string, unknown>) {
  if (type !== 'http_json' && type !== 'http_csv') return;
  const url = typeof config.url === 'string' ? config.url.trim() : '';
  if (!url) throw new Error('Missing config.url');
  assertHttpImportUrl(url);
}

export async function createWarehouseDataSource(
  env: Env,
  websiteId: string,
  userId: string | null,
  input: WarehouseDataSourceInput,
) {
  assertDataSourceConfig(input.type, input.config);
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO warehouse_data_source
       (data_source_id, website_id, user_id, name, type, enabled, config_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
  )
    .bind(
      id,
      websiteId,
      userId,
      input.name.trim(),
      input.type,
      input.enabled ? 1 : 0,
      JSON.stringify(input.config),
      now,
    )
    .run();
  const dataSource = await getWarehouseDataSource(env, websiteId, id);
  if (!dataSource) throw new Error('Warehouse data source creation failed');
  return dataSource;
}

export async function updateWarehouseDataSource(
  env: Env,
  websiteId: string,
  dataSourceId: string,
  patch: WarehouseDataSourcePatch,
) {
  const existing = await getWarehouseDataSource(env, websiteId, dataSourceId);
  if (!existing) return null;
  const nextType = patch.type ?? existing.type;
  const nextConfig = patch.config ?? existing.config;
  assertDataSourceConfig(nextType, nextConfig);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE warehouse_data_source
     SET name = ?3,
         type = ?4,
         enabled = ?5,
         config_json = ?6,
         last_sync_at = ?7,
         last_status = ?8,
         last_error = ?9,
         updated_at = ?10
     WHERE website_id = ?1 AND data_source_id = ?2`,
  )
    .bind(
      websiteId,
      dataSourceId,
      patch.name?.trim() ?? existing.name,
      patch.type ?? existing.type,
      (patch.enabled ?? existing.enabled) ? 1 : 0,
      JSON.stringify(patch.config ?? existing.config),
      patch.lastSyncAt === undefined ? existing.lastSyncAt : patch.lastSyncAt,
      patch.lastStatus === undefined ? existing.lastStatus : patch.lastStatus,
      patch.lastError === undefined ? existing.lastError : patch.lastError,
      now,
    )
    .run();
  return getWarehouseDataSource(env, websiteId, dataSourceId);
}

export async function deleteWarehouseDataSource(env: Env, websiteId: string, dataSourceId: string) {
  const existing = await getWarehouseDataSource(env, websiteId, dataSourceId);
  if (!existing) return false;
  await env.DB.prepare(`DELETE FROM warehouse_data_source WHERE website_id = ?1 AND data_source_id = ?2`)
    .bind(websiteId, dataSourceId)
    .run();
  return true;
}

function syncIntervalMs(config: Record<string, unknown>): number | null {
  const minutes = config.syncIntervalMinutes;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(minutes, 24 * 60) * 60 * 1000;
}

function isPrivateIpv4(host: string) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIpv6(host: string) {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('::ffff:')
  );
}

function assertHttpImportUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid import URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Import URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Import URL must not include credentials');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    !host.includes('.') ||
    isPrivateIpv4(host) ||
    host.includes(':') ||
    isPrivateIpv6(host)
  ) {
    throw new Error('Import URL host is not allowed');
  }
}

async function fetchImportResponse(url: string) {
  // Imports are read-only pulls; the request method is intentionally not
  // user-configurable so this cannot be used to send state-changing requests.
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_IMPORT_RESPONSE_BYTES) {
    throw new Error('Import response too large');
  }
  const text = await response.text();
  if (text.length > MAX_IMPORT_RESPONSE_BYTES) {
    throw new Error('Import response too large');
  }
  return text;
}

function assertScheduleInterval(intervalMinutes: number) {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < MIN_SCHEDULE_INTERVAL_MINUTES) {
    throw new Error(`intervalMinutes must be at least ${MIN_SCHEDULE_INTERVAL_MINUTES}`);
  }
}

async function probeHttpJsonSource(config: Record<string, unknown>) {
  const url = typeof config.url === 'string' ? config.url.trim() : '';
  if (!url) throw new Error('Missing config.url');
  assertHttpImportUrl(url);
  await fetchImportResponse(url);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsvRows(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!);
  const rows: Array<Record<string, string>> = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = values[index] ?? '';
    });
    rows.push(record);
  }

  return rows;
}

async function importHttpRows(
  env: Env,
  websiteId: string,
  dataSourceId: string,
  rows: Array<Record<string, unknown>>,
  primaryKeyField: string,
  now: number,
) {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import exceeds ${MAX_IMPORT_ROWS} rows`);
  }

  const statements = [];
  for (const row of rows) {
    const primaryKey = String(row[primaryKeyField] ?? '').trim();
    if (!primaryKey) continue;

    statements.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO warehouse_import
         (import_row_id, website_id, data_source_id, primary_key, payload_json, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(`${dataSourceId}:${primaryKey}`, websiteId, dataSourceId, primaryKey, JSON.stringify(row), now),
    );
  }

  for (let offset = 0; offset < statements.length; offset += IMPORT_BATCH_SIZE) {
    await env.DB.batch(statements.slice(offset, offset + IMPORT_BATCH_SIZE));
  }

  return statements.length;
}

async function importHttpJsonSource(
  env: Env,
  websiteId: string,
  dataSourceId: string,
  config: Record<string, unknown>,
  now: number,
) {
  const url = typeof config.url === 'string' ? config.url.trim() : '';
  if (!url) throw new Error('Missing config.url');
  assertHttpImportUrl(url);
  const primaryKeyField = typeof config.primaryKey === 'string' && config.primaryKey.trim()
    ? config.primaryKey.trim()
    : 'id';

  const text = await fetchImportResponse(url);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('Expected JSON array response');
  }
  if (!Array.isArray(body)) throw new Error('Expected JSON array response');

  const rows = body
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => row as Record<string, unknown>);

  return importHttpRows(env, websiteId, dataSourceId, rows, primaryKeyField, now);
}

async function importHttpCsvSource(
  env: Env,
  websiteId: string,
  dataSourceId: string,
  config: Record<string, unknown>,
  now: number,
) {
  const url = typeof config.url === 'string' ? config.url.trim() : '';
  if (!url) throw new Error('Missing config.url');
  assertHttpImportUrl(url);
  const primaryKeyField = typeof config.primaryKey === 'string' && config.primaryKey.trim()
    ? config.primaryKey.trim()
    : 'id';

  const rows = parseCsvRows(await fetchImportResponse(url)).map((row) => ({ ...row }));
  return importHttpRows(env, websiteId, dataSourceId, rows, primaryKeyField, now);
}

export async function syncWarehouseDataSource(
  env: Env,
  websiteId: string,
  dataSourceId: string,
  now = Date.now(),
) {
  const source = await getWarehouseDataSource(env, websiteId, dataSourceId);
  if (!source?.enabled) return { ok: false as const, skipped: true };

  const intervalMs = syncIntervalMs(source.config);
  if (intervalMs && source.lastSyncAt && now - source.lastSyncAt < intervalMs) {
    return { ok: true as const, skipped: true };
  }

  await updateWarehouseDataSource(env, websiteId, dataSourceId, { lastStatus: 'syncing', lastError: null });

  try {
    if (source.type === 'http_json') {
      const imported = await importHttpJsonSource(env, websiteId, dataSourceId, source.config, now);
      await updateWarehouseDataSource(env, websiteId, dataSourceId, {
        lastStatus: 'connected',
        lastError: null,
        lastSyncAt: now,
      });
      return { ok: true as const, skipped: false, imported };
    }
    if (source.type === 'http_csv') {
      const imported = await importHttpCsvSource(env, websiteId, dataSourceId, source.config, now);
      await updateWarehouseDataSource(env, websiteId, dataSourceId, {
        lastStatus: 'connected',
        lastError: null,
        lastSyncAt: now,
      });
      return { ok: true as const, skipped: false, imported };
    }
    await updateWarehouseDataSource(env, websiteId, dataSourceId, {
      lastStatus: 'connected',
      lastError: null,
      lastSyncAt: now,
    });
    return { ok: true as const, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    await updateWarehouseDataSource(env, websiteId, dataSourceId, {
      lastStatus: 'failed',
      lastError: message,
      lastSyncAt: now,
    });
    return { ok: false as const, skipped: false, error: message };
  }
}

export async function runDueWarehouseDataSourceSyncs(env: Env, now = Date.now()) {
  // Cap per-tick work so one cron invocation cannot exceed Worker limits;
  // remaining websites are picked up on the next tick.
  const rows = await env.DB.prepare(
    `SELECT website_id as websiteId, MIN(COALESCE(last_sync_at, 0)) as oldestSync
     FROM warehouse_data_source
     WHERE enabled = 1
     GROUP BY website_id
     ORDER BY oldestSync ASC
     LIMIT ${MAX_SYNC_WEBSITES_PER_TICK}`,
  ).all<{ websiteId: string }>();

  let websites = 0;
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows.results ?? []) {
    websites++;
    const sources = await listWarehouseDataSources(env, row.websiteId);
    for (const source of sources) {
      const result = await syncWarehouseDataSource(env, row.websiteId, source.id, now);
      if (result.skipped) skipped++;
      else if (result.ok) synced++;
      else failed++;
    }
  }

  console.log(
    JSON.stringify({
      event: 'warehouse_data_source_sync_complete',
      websites,
      synced,
      failed,
      skipped,
    }),
  );

  return { websites, synced, failed, skipped };
}
