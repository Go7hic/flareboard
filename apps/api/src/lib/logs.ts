import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
import { deliverAlertNotification, hasRecentAlertEvent } from './alert-delivery';

export type LogEventRow = {
  id: string;
  sessionId: string;
  visitId: string;
  urlPath: string;
  eventName: string | null;
  createdAt: number;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  message: string | null;
  level: string | null;
  release: string | null;
  environment: string | null;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  service: string | null;
  operation: string | null;
  durationMs: number | null;
  status: string | null;
};

export type TraceSummaryRow = {
  traceId: string;
  spans: number;
  services: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  maxSpanDurationMs: number;
  hasError: boolean;
};

export type TraceSpanRow = LogEventRow & {
  traceId: string;
};

export type TraceDetailRow = {
  traceId: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  services: string[];
  spans: TraceSpanRow[];
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

export type LogSavedFilterValue = {
  level?: string;
  search?: string;
  release?: string;
  environment?: string;
  service?: string;
  traceId?: string;
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

export type LogFilters = {
  level?: string;
  search?: string;
  release?: string;
  environment?: string;
};

const logPropsCte = `WITH props AS (
  SELECT
    website_event_id,
    MAX(CASE WHEN data_key = 'message' THEN string_value END) as message,
    MAX(CASE WHEN data_key = 'level' THEN string_value END) as level,
    MAX(CASE WHEN data_key = 'release' THEN string_value END) as release,
    MAX(CASE WHEN data_key = 'environment' THEN string_value END) as environment,
    MAX(CASE WHEN data_key = 'traceId' THEN string_value END) as traceId,
    MAX(CASE WHEN data_key = 'spanId' THEN string_value END) as spanId,
    MAX(CASE WHEN data_key = 'parentSpanId' THEN string_value END) as parentSpanId,
    MAX(CASE WHEN data_key = 'service' THEN string_value END) as service,
    MAX(CASE WHEN data_key = 'operation' THEN string_value END) as operation,
    MAX(CASE WHEN data_key = 'durationMs' THEN number_value END) as durationMs,
    MAX(CASE WHEN data_key = 'status' THEN string_value END) as status
  FROM event_data
  WHERE website_id = ?1
  GROUP BY website_event_id
)`;

function normalizeSavedFilter(row: Omit<LogSavedFilterRow, 'filters' | 'isDefault'> & { filters: string; isDefault: number }) {
  return {
    ...row,
    filters: JSON.parse(row.filters) as LogSavedFilterValue,
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

export async function getLogEvents(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
  limit = 100,
) {
  const searchPattern = filters.search?.trim() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const rows = await env.DB.prepare(
    `${logPropsCte}
     SELECT
       e.event_id as id,
       e.session_id as sessionId,
       e.visit_id as visitId,
       e.url_path as urlPath,
       e.event_name as eventName,
       e.created_at as createdAt,
       s.browser,
       s.os,
       s.device,
       s.country,
       props.message,
       props.level,
       props.release,
       props.environment,
       props.traceId,
       props.spanId,
       props.parentSpanId,
       props.service,
       props.operation,
       props.durationMs,
       props.status
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN session s ON s.session_id = e.session_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)
     ORDER BY e.created_at DESC
     LIMIT ?9`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
      Math.min(Math.max(limit, 1), 500),
    )
    .all<LogEventRow>();

  return rows.results ?? [];
}

export async function getLogTail(
  env: Env,
  websiteId: string,
  sinceAt: number,
  filters: LogFilters = {},
  limit = 100,
) {
  const searchPattern = filters.search?.trim() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const rows = await env.DB.prepare(
    `${logPropsCte}
     SELECT
       e.event_id as id,
       e.session_id as sessionId,
       e.visit_id as visitId,
       e.url_path as urlPath,
       e.event_name as eventName,
       e.created_at as createdAt,
       s.browser,
       s.os,
       s.device,
       s.country,
       props.message,
       props.level,
       props.release,
       props.environment,
       props.traceId,
       props.spanId,
       props.parentSpanId,
       props.service,
       props.operation,
       props.durationMs,
       props.status
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN session s ON s.session_id = e.session_id
     WHERE e.website_id = ?1
       AND e.created_at > ?2
       AND e.event_type = ?3
       AND (?4 IS NULL OR props.level = ?4)
       AND (?5 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?5)
       AND (?6 IS NULL OR props.release = ?6)
       AND (?7 IS NULL OR props.environment = ?7)
     ORDER BY e.created_at ASC
     LIMIT ?8`,
  )
    .bind(
      websiteId,
      sinceAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
      Math.min(Math.max(limit, 1), 500),
    )
    .all<LogEventRow>();

  return rows.results ?? [];
}

export async function getServiceSummaries(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
  limit = 100,
) {
  const searchPattern = filters.search?.trim() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const rows = await env.DB.prepare(
    `${logPropsCte}
     SELECT
       props.service as service,
       COUNT(*) as logs,
       SUM(CASE WHEN props.status = 'error' OR props.level IN ('error', 'fatal') THEN 1 ELSE 0 END) as errors,
       COUNT(DISTINCT props.traceId) as traces,
       COALESCE(AVG(props.durationMs), 0) as avgDurationMs,
       COALESCE(MAX(props.durationMs), 0) as maxDurationMs,
       MAX(e.created_at) as lastSeenAt
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND props.service IS NOT NULL
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)
     GROUP BY props.service
     ORDER BY errors DESC, logs DESC, lastSeenAt DESC
     LIMIT ?9`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
      Math.min(Math.max(limit, 1), 500),
    )
    .all<ServiceSummaryRow>();

  return (rows.results ?? []).map((row) => ({
    ...row,
    avgDurationMs: Math.round(row.avgDurationMs),
  }));
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
       (alert_rule_id, website_id, name, enabled, threshold, window_minutes, level, service, search, release, environment, channel, target, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
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
         updated_at = ?14
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

export async function evaluateLogAlertRules(env: Env, websiteId: string, now = Date.now()) {
  const rules = (await listLogAlertRules(env, websiteId)).filter((rule) => rule.enabled);
  const triggered: TriggeredLogAlertRow[] = [];

  for (const rule of rules) {
    const windowStartAt = now - rule.windowMinutes * 60 * 1000;
    const recentlyTriggered = await hasRecentAlertEvent(
      env,
      'log_alert_event',
      rule.id,
      websiteId,
      windowStartAt,
    );
    if (recentlyTriggered) continue;

    const searchPattern = rule.search ? `%${rule.search.toLowerCase()}%` : null;
    const row = await env.DB.prepare(
      `${logPropsCte}
       SELECT COUNT(*) as count
       FROM website_event e
       LEFT JOIN props ON props.website_event_id = e.event_id
       WHERE e.website_id = ?1
         AND e.created_at >= ?2
         AND e.created_at <= ?3
         AND e.event_type = ?4
         AND (?5 IS NULL OR props.level = ?5)
         AND (?6 IS NULL OR props.service = ?6)
         AND (?7 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?7)
         AND (?8 IS NULL OR props.release = ?8)
         AND (?9 IS NULL OR props.environment = ?9)`,
    )
      .bind(
        websiteId,
        windowStartAt,
        now,
        EVENT_TYPE.log,
        rule.level,
        rule.service,
        searchPattern,
        rule.release,
        rule.environment,
      )
      .first<{ count: number }>();

    const count = row?.count ?? 0;
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

export async function getTraceSummaries(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
  limit = 100,
) {
  const searchPattern = filters.search?.trim() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const rows = await env.DB.prepare(
    `${logPropsCte}
     SELECT
       props.traceId as traceId,
       COUNT(*) as spans,
       COUNT(DISTINCT COALESCE(props.service, 'unknown')) as services,
       MIN(e.created_at) as startedAt,
       MAX(e.created_at) as endedAt,
       MAX(e.created_at) - MIN(e.created_at) as durationMs,
       COALESCE(MAX(props.durationMs), 0) as maxSpanDurationMs,
       MAX(CASE WHEN props.status = 'error' OR props.level IN ('error', 'fatal') THEN 1 ELSE 0 END) as hasError
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND props.traceId IS NOT NULL
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)
     GROUP BY props.traceId
     ORDER BY endedAt DESC
     LIMIT ?9`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
      Math.min(Math.max(limit, 1), 500),
    )
    .all<Omit<TraceSummaryRow, 'hasError'> & { hasError: number }>();

  return (rows.results ?? []).map((row) => ({ ...row, hasError: Boolean(row.hasError) }));
}

export async function getTraceDetail(env: Env, websiteId: string, traceId: string) {
  const rows = await env.DB.prepare(
    `${logPropsCte}
     SELECT
       e.event_id as id,
       e.session_id as sessionId,
       e.visit_id as visitId,
       e.url_path as urlPath,
       e.event_name as eventName,
       e.created_at as createdAt,
       s.browser,
       s.os,
       s.device,
       s.country,
       props.message,
       props.level,
       props.release,
       props.environment,
       props.traceId,
       props.spanId,
       props.parentSpanId,
       props.service,
       props.operation,
       props.durationMs,
       props.status
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN session s ON s.session_id = e.session_id
     WHERE e.website_id = ?1
       AND e.event_type = ?2
       AND props.traceId = ?3
     ORDER BY e.created_at ASC
     LIMIT 500`,
  )
    .bind(websiteId, EVENT_TYPE.log, traceId)
    .all<TraceSpanRow>();

  const spans = rows.results ?? [];
  if (!spans.length) return null;
  const startedAt = spans[0]?.createdAt ?? null;
  const endedAt = spans[spans.length - 1]?.createdAt ?? null;
  const services = Array.from(new Set(spans.map((span) => span.service).filter((value): value is string => Boolean(value))));

  return {
    traceId,
    startedAt,
    endedAt,
    durationMs: startedAt != null && endedAt != null ? endedAt - startedAt : 0,
    services,
    spans,
  } satisfies TraceDetailRow;
}

export async function getLogStats(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: LogFilters = {},
) {
  const searchPattern = filters.search?.trim() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const row = await env.DB.prepare(
    `${logPropsCte}
     SELECT
       COUNT(*) as logs,
       COUNT(DISTINCT session_id) as sessions,
       MAX(created_at) as lastSeenAt
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
    )
    .first<{ logs: number; sessions: number; lastSeenAt: number | null }>();

  const levels = await env.DB.prepare(
    `${logPropsCte}
     SELECT COALESCE(props.level, 'info') as level, COUNT(*) as logs
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)
     GROUP BY COALESCE(props.level, 'info')
     ORDER BY logs DESC, level ASC`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ level: string; logs: number }>();

  const trend = await env.DB.prepare(
    `${logPropsCte}
     SELECT
       date(e.created_at / 1000, 'unixepoch') as date,
       COUNT(*) as logs,
       COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)
     GROUP BY date(e.created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ date: string; logs: number; sessions: number }>();

  const releases = await env.DB.prepare(
    `${logPropsCte}
     SELECT props.release as release, COUNT(*) as logs
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND props.release IS NOT NULL
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)
     GROUP BY props.release
     ORDER BY logs DESC
     LIMIT 10`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ release: string; logs: number }>();

  const environments = await env.DB.prepare(
    `${logPropsCte}
     SELECT props.environment as environment, COUNT(*) as logs
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND props.environment IS NOT NULL
       AND (?5 IS NULL OR props.level = ?5)
       AND (?6 IS NULL OR lower(COALESCE(props.message, e.event_name, '')) LIKE ?6)
       AND (?7 IS NULL OR props.release = ?7)
       AND (?8 IS NULL OR props.environment = ?8)
     GROUP BY props.environment
     ORDER BY logs DESC
     LIMIT 10`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.log,
      filters.level || null,
      searchPattern,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ environment: string; logs: number }>();

  return {
    logs: row?.logs ?? 0,
    sessions: row?.sessions ?? 0,
    levels: levels.results ?? [],
    trend: trend.results ?? [],
    releases: releases.results ?? [],
    environments: environments.results ?? [],
    lastSeenAt: row?.lastSeenAt ?? null,
  };
}
