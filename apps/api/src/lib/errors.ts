import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
import { deliverAlertNotification, hasRecentAlertEvent } from './alert-delivery';
import { resolveErrorStack } from './source-maps';

export type ErrorIssueCommentRow = {
  id: string;
  userId: string | null;
  body: string;
  createdAt: number;
};

export type ErrorSourceMapRow = {
  id: string;
  websiteId: string;
  release: string;
  file: string;
  size: number;
  createdAt: number | null;
  updatedAt: number | null;
};

export type ErrorAlertRuleRow = {
  id: string;
  websiteId: string;
  name: string;
  enabled: boolean;
  threshold: number;
  windowMinutes: number;
  severity: string | null;
  release: string | null;
  environment: string | null;
  channel: string;
  target: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type ErrorAlertRuleInput = {
  name: string;
  enabled: boolean;
  threshold: number;
  windowMinutes: number;
  severity?: string | null;
  release?: string | null;
  environment?: string | null;
  channel: string;
  target?: string | null;
};

export type ErrorAlertRulePatch = Partial<ErrorAlertRuleInput>;

export type TriggeredErrorAlertRow = {
  id: string;
  alertRuleId: string;
  websiteId: string;
  count: number;
  threshold: number;
  windowStartAt: number;
  windowEndAt: number;
  createdAt: number;
};

export type ErrorEventRow = {
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
  name: string | null;
  severity: string | null;
  handled: string | null;
  release: string | null;
  environment: string | null;
};

export type ErrorIssueRow = {
  fingerprint: string;
  message: string | null;
  name: string | null;
  severity: string | null;
  events: number;
  sessions: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  latestEventId: string | null;
  status: 'open' | 'resolved' | 'ignored';
  note: string | null;
  assigneeUserId: string | null;
  stateUpdatedAt: number | null;
  comments: ErrorIssueCommentRow[];
  samples: ErrorEventRow[];
};

export type ErrorFilters = {
  release?: string;
  environment?: string;
  status?: 'open' | 'resolved' | 'ignored';
};

const ERROR_PROP_SELECT = `
    MAX(CASE WHEN d.data_key = 'message' THEN d.string_value END) as message,
    MAX(CASE WHEN d.data_key IN ('name', 'errorName') THEN d.string_value END) as name,
    MAX(CASE WHEN d.data_key = 'severity' THEN d.string_value END) as severity,
    MAX(CASE WHEN d.data_key = 'handled' THEN d.string_value END) as handled,
    MAX(CASE WHEN d.data_key = 'release' THEN d.string_value END) as release,
    MAX(CASE WHEN d.data_key = 'environment' THEN d.string_value END) as environment`;

const ERROR_PROP_KEYS = `('message', 'name', 'errorName', 'severity', 'handled', 'release', 'environment')`;

// Scoped to error events inside the queried time window (binds: ?1 websiteId,
// ?2 startAt, ?3 endAt, ?4 event type) so it never scans a website's full
// event_data set.
const errorPropsCte = `WITH props AS (
  SELECT
    d.website_event_id,${ERROR_PROP_SELECT}
  FROM event_data d
  JOIN website_event ev
    ON ev.event_id = d.website_event_id
   AND ev.website_id = ?1
   AND ev.event_type = ?4
   AND ev.created_at >= ?2
   AND ev.created_at <= ?3
  WHERE d.website_id = ?1
    AND d.data_key IN ${ERROR_PROP_KEYS}
  GROUP BY d.website_event_id
)`;

// Single-event variant (binds: ?1 websiteId, ?2 eventId).
const errorEventPropsCte = `WITH props AS (
  SELECT
    d.website_event_id,${ERROR_PROP_SELECT}
  FROM event_data d
  WHERE d.website_id = ?1
    AND d.website_event_id = ?2
    AND d.data_key IN ${ERROR_PROP_KEYS}
  GROUP BY d.website_event_id
)`;

function bindErrorFilters(filters: ErrorFilters) {
  return [filters.release ?? null, filters.environment ?? null, filters.status ?? null] as const;
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeErrorAlertRule(row: Omit<ErrorAlertRuleRow, 'enabled'> & { enabled: boolean | number }) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
  };
}

export async function getErrorEvents(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
  limit = 100,
) {
  const [releaseFilter, environmentFilter, statusFilter] = bindErrorFilters(filters);
  const rows = await env.DB.prepare(
    `${errorPropsCte}
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
       props.name,
       props.severity,
       props.handled,
       props.release,
       props.environment
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN error_issue_state state
       ON state.website_id = e.website_id
      AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
     LEFT JOIN session s ON s.session_id = e.session_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.release = ?5)
       AND (?6 IS NULL OR props.environment = ?6)
       AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)
     ORDER BY e.created_at DESC
     LIMIT ?8`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.error,
      releaseFilter,
      environmentFilter,
      statusFilter,
      Math.min(Math.max(limit, 1), 500),
    )
    .all<ErrorEventRow>();

  return rows.results ?? [];
}

export async function getErrorIssues(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
  limit = 25,
) {
  const [releaseFilter, environmentFilter, statusFilter] = bindErrorFilters(filters);
  const rows = await env.DB.prepare(
    `${errorPropsCte}
     SELECT
       COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error') as fingerprint,
       COALESCE(props.message, e.event_name, 'Unknown error') as message,
       COALESCE(props.name, 'Error') as name,
       COALESCE(props.severity, 'error') as severity,
       COUNT(*) as events,
       COUNT(DISTINCT e.session_id) as sessions,
       MIN(e.created_at) as firstSeenAt,
       MAX(e.created_at) as lastSeenAt,
       COALESCE(state.status, 'open') as status,
       state.note as note,
       state.assignee_user_id as assigneeUserId,
       state.updated_at as stateUpdatedAt
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN error_issue_state state
       ON state.website_id = e.website_id
      AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.release = ?5)
       AND (?6 IS NULL OR props.environment = ?6)
       AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)
     GROUP BY
       COALESCE(props.name, 'Error'),
       COALESCE(props.message, e.event_name, 'Unknown error'),
       COALESCE(state.status, 'open'),
       state.note,
       state.assignee_user_id,
       state.updated_at
     ORDER BY events DESC, lastSeenAt DESC
     LIMIT ?8`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.error,
      releaseFilter,
      environmentFilter,
      statusFilter,
      Math.min(Math.max(limit, 1), 100),
    )
    .all<Omit<ErrorIssueRow, 'samples' | 'latestEventId'>>();

  const grouped = rows.results ?? [];
  if (!grouped.length) return [];

  // Samples and comments are batched (one window-function query + chunked IN
  // queries) instead of two D1 round-trips per issue.
  const [samplesByFingerprint, commentsByFingerprint] = await Promise.all([
    getErrorIssueSamplesBatch(env, websiteId, startAt, endAt, filters),
    getErrorIssueCommentsBatch(env, websiteId, grouped.map((row) => row.fingerprint)),
  ]);

  return grouped.map((row) => {
    const samples = samplesByFingerprint.get(row.fingerprint) ?? [];
    return {
      ...row,
      latestEventId: samples[0]?.id ?? null,
      comments: commentsByFingerprint.get(row.fingerprint) ?? [],
      samples,
    };
  });
}

const IN_CHUNK_SIZE = 50;

async function getErrorIssueCommentsBatch(env: Env, websiteId: string, fingerprints: string[]) {
  const byFingerprint = new Map<string, ErrorIssueCommentRow[]>();
  const unique = [...new Set(fingerprints)];
  for (let offset = 0; offset < unique.length; offset += IN_CHUNK_SIZE) {
    const chunk = unique.slice(offset, offset + IN_CHUNK_SIZE);
    const placeholders = chunk.map((_, index) => `?${index + 2}`).join(', ');
    const rows = await env.DB.prepare(
      `SELECT fingerprint,
              comment_id as id,
              user_id as userId,
              body,
              created_at as createdAt
       FROM error_issue_comment
       WHERE website_id = ?1 AND fingerprint IN (${placeholders})
       ORDER BY created_at ASC`,
    )
      .bind(websiteId, ...chunk)
      .all<ErrorIssueCommentRow & { fingerprint: string }>();
    for (const { fingerprint, ...comment } of rows.results ?? []) {
      const list = byFingerprint.get(fingerprint) ?? [];
      if (list.length < 20) list.push(comment);
      byFingerprint.set(fingerprint, list);
    }
  }
  return byFingerprint;
}

async function getErrorIssueSamplesBatch(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters,
  samplesPerIssue = 3,
) {
  const [releaseFilter, environmentFilter, statusFilter] = bindErrorFilters(filters);
  const rows = await env.DB.prepare(
    `${errorPropsCte},
     ranked AS (
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
         props.name,
         props.severity,
         props.handled,
         props.release,
         props.environment,
         COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error') as fingerprint,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(props.name, 'Error'), COALESCE(props.message, e.event_name, 'Unknown error')
           ORDER BY e.created_at DESC
         ) as rowNumber
       FROM website_event e
       LEFT JOIN props ON props.website_event_id = e.event_id
       LEFT JOIN error_issue_state state
         ON state.website_id = e.website_id
        AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
       LEFT JOIN session s ON s.session_id = e.session_id
       WHERE e.website_id = ?1
         AND e.created_at >= ?2
         AND e.created_at <= ?3
         AND e.event_type = ?4
         AND (?5 IS NULL OR props.release = ?5)
         AND (?6 IS NULL OR props.environment = ?6)
         AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)
     )
     SELECT * FROM ranked WHERE rowNumber <= ?8 ORDER BY fingerprint, createdAt DESC`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.error,
      releaseFilter,
      environmentFilter,
      statusFilter,
      samplesPerIssue,
    )
    .all<ErrorEventRow & { fingerprint: string; rowNumber: number }>();

  const byFingerprint = new Map<string, ErrorEventRow[]>();
  for (const { fingerprint, rowNumber: _rowNumber, ...sample } of rows.results ?? []) {
    const list = byFingerprint.get(fingerprint) ?? [];
    list.push(sample);
    byFingerprint.set(fingerprint, list);
  }
  return byFingerprint;
}

export async function getErrorIssueComments(env: Env, websiteId: string, fingerprint: string, limit = 20) {
  const rows = await env.DB.prepare(
    `SELECT comment_id as id,
            user_id as userId,
            body,
            created_at as createdAt
     FROM error_issue_comment
     WHERE website_id = ?1 AND fingerprint = ?2
     ORDER BY created_at ASC
     LIMIT ?3`,
  )
    .bind(websiteId, fingerprint, Math.min(Math.max(limit, 1), 100))
    .all<ErrorIssueCommentRow>();
  return rows.results ?? [];
}

export async function addErrorIssueComment(
  env: Env,
  websiteId: string,
  fingerprint: string,
  userId: string | null,
  body: string,
) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Comment body is required');
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO error_issue_comment (comment_id, website_id, fingerprint, user_id, body, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, websiteId, fingerprint, userId, trimmed, now)
    .run();
  return { id, websiteId, fingerprint, userId, body: trimmed, createdAt: now };
}

export async function upsertErrorSourceMap(
  env: Env,
  websiteId: string,
  release: string,
  file: string,
  content: string,
) {
  const normalizedRelease = release.trim();
  const normalizedFile = file.trim();
  if (!normalizedRelease) throw new Error('Release is required');
  if (!normalizedFile) throw new Error('File is required');
  if (!content) throw new Error('Source map content is required');

  const now = Date.now();
  const id = crypto.randomUUID();
  const size = new TextEncoder().encode(content).length;

  await env.DB.prepare(
    `INSERT INTO error_source_map (source_map_id, website_id, release, file, content, size, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(website_id, release, file)
     DO UPDATE SET content = excluded.content,
                   size = excluded.size,
                   updated_at = excluded.updated_at`,
  )
    .bind(id, websiteId, normalizedRelease, normalizedFile, content, size, now)
    .run();

  const row = await env.DB.prepare(
    `SELECT source_map_id as id,
            website_id as websiteId,
            release,
            file,
            size,
            created_at as createdAt,
            updated_at as updatedAt
     FROM error_source_map
     WHERE website_id = ?1 AND release = ?2 AND file = ?3
     LIMIT 1`,
  )
    .bind(websiteId, normalizedRelease, normalizedFile)
    .first<ErrorSourceMapRow>();

  if (!row) throw new Error('Source map upload failed');
  return row;
}

export async function listErrorSourceMaps(env: Env, websiteId: string, release?: string) {
  const normalizedRelease = release?.trim() || null;
  const rows = await env.DB.prepare(
    `SELECT source_map_id as id,
            website_id as websiteId,
            release,
            file,
            size,
            created_at as createdAt,
            updated_at as updatedAt
     FROM error_source_map
     WHERE website_id = ?1
       AND (?2 IS NULL OR release = ?2)
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 200`,
  )
    .bind(websiteId, normalizedRelease)
    .all<ErrorSourceMapRow>();

  return rows.results ?? [];
}

export async function listErrorAlertRules(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT alert_rule_id as id,
            website_id as websiteId,
            name,
            enabled,
            threshold,
            window_minutes as windowMinutes,
            severity,
            release,
            environment,
            channel,
            target,
            created_at as createdAt,
            updated_at as updatedAt
     FROM error_alert_rule
     WHERE website_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(websiteId)
    .all<Omit<ErrorAlertRuleRow, 'enabled'> & { enabled: number }>();

  return (rows.results ?? []).map(normalizeErrorAlertRule);
}

export async function getErrorAlertRule(env: Env, websiteId: string, alertRuleId: string) {
  const row = await env.DB.prepare(
    `SELECT alert_rule_id as id,
            website_id as websiteId,
            name,
            enabled,
            threshold,
            window_minutes as windowMinutes,
            severity,
            release,
            environment,
            channel,
            target,
            created_at as createdAt,
            updated_at as updatedAt
     FROM error_alert_rule
     WHERE website_id = ?1 AND alert_rule_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, alertRuleId)
    .first<Omit<ErrorAlertRuleRow, 'enabled'> & { enabled: number }>();

  return row ? normalizeErrorAlertRule(row) : null;
}

export async function createErrorAlertRule(env: Env, websiteId: string, input: ErrorAlertRuleInput) {
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO error_alert_rule
       (alert_rule_id, website_id, name, enabled, threshold, window_minutes, severity, release, environment, channel, target, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
  )
    .bind(
      id,
      websiteId,
      input.name.trim(),
      input.enabled ? 1 : 0,
      input.threshold,
      input.windowMinutes,
      normalizeNullableText(input.severity),
      normalizeNullableText(input.release),
      normalizeNullableText(input.environment),
      input.channel,
      normalizeNullableText(input.target),
      now,
    )
    .run();

  const rule = await getErrorAlertRule(env, websiteId, id);
  if (!rule) throw new Error('Error alert rule creation failed');
  return rule;
}

export async function updateErrorAlertRule(
  env: Env,
  websiteId: string,
  alertRuleId: string,
  patch: ErrorAlertRulePatch,
) {
  const existing = await getErrorAlertRule(env, websiteId, alertRuleId);
  if (!existing) return null;

  const now = Date.now();
  const enabled = patch.enabled ?? existing.enabled;
  await env.DB.prepare(
    `UPDATE error_alert_rule
     SET name = ?3,
         enabled = ?4,
         threshold = ?5,
         window_minutes = ?6,
         severity = ?7,
         release = ?8,
         environment = ?9,
         channel = ?10,
         target = ?11,
         updated_at = ?12
     WHERE website_id = ?1 AND alert_rule_id = ?2`,
  )
    .bind(
      websiteId,
      alertRuleId,
      patch.name?.trim() ?? existing.name,
      enabled ? 1 : 0,
      patch.threshold ?? existing.threshold,
      patch.windowMinutes ?? existing.windowMinutes,
      patch.severity === undefined ? existing.severity : normalizeNullableText(patch.severity),
      patch.release === undefined ? existing.release : normalizeNullableText(patch.release),
      patch.environment === undefined ? existing.environment : normalizeNullableText(patch.environment),
      patch.channel ?? existing.channel,
      patch.target === undefined ? existing.target : normalizeNullableText(patch.target),
      now,
    )
    .run();

  return getErrorAlertRule(env, websiteId, alertRuleId);
}

export async function deleteErrorAlertRule(env: Env, websiteId: string, alertRuleId: string) {
  const existing = await getErrorAlertRule(env, websiteId, alertRuleId);
  if (!existing) return false;
  await env.DB.prepare(`DELETE FROM error_alert_rule WHERE website_id = ?1 AND alert_rule_id = ?2`)
    .bind(websiteId, alertRuleId)
    .run();
  return true;
}

export async function evaluateErrorAlertRules(env: Env, websiteId: string, now = Date.now()) {
  const rules = (await listErrorAlertRules(env, websiteId)).filter((rule) => rule.enabled);
  const triggered: TriggeredErrorAlertRow[] = [];

  for (const rule of rules) {
    const windowStartAt = now - rule.windowMinutes * 60 * 1000;
    const recentlyTriggered = await hasRecentAlertEvent(
      env,
      'error_alert_event',
      rule.id,
      websiteId,
      windowStartAt,
    );
    if (recentlyTriggered) continue;

    const row = await env.DB.prepare(
      `${errorPropsCte}
       SELECT COUNT(*) as count
       FROM website_event e
       LEFT JOIN props ON props.website_event_id = e.event_id
       WHERE e.website_id = ?1
         AND e.created_at >= ?2
         AND e.created_at <= ?3
         AND e.event_type = ?4
         AND (?5 IS NULL OR COALESCE(props.severity, 'error') = ?5)
         AND (?6 IS NULL OR props.release = ?6)
         AND (?7 IS NULL OR props.environment = ?7)`,
    )
      .bind(
        websiteId,
        windowStartAt,
        now,
        EVENT_TYPE.error,
        rule.severity,
        rule.release,
        rule.environment,
      )
      .first<{ count: number }>();

    const count = row?.count ?? 0;
    if (count < rule.threshold) continue;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO error_alert_event
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
      kind: 'error',
    });
  }

  return triggered;
}

export async function updateErrorIssueState(
  env: Env,
  websiteId: string,
  fingerprint: string,
  status: 'open' | 'resolved' | 'ignored',
  note?: string | null,
  assigneeUserId?: string | null,
) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO error_issue_state (website_id, fingerprint, status, note, assignee_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT(website_id, fingerprint)
     DO UPDATE SET status = excluded.status,
                   note = excluded.note,
                   assignee_user_id = excluded.assignee_user_id,
                   updated_at = excluded.updated_at`,
  )
    .bind(websiteId, fingerprint, status, note?.trim() || null, assigneeUserId?.trim() || null, now)
    .run();

  return {
    websiteId,
    fingerprint,
    status,
    note: note?.trim() || null,
    assigneeUserId: assigneeUserId?.trim() || null,
    updatedAt: now,
  };
}

export async function getErrorStats(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
) {
  const [releaseFilter, environmentFilter, statusFilter] = bindErrorFilters(filters);
  const row = await env.DB.prepare(
    `${errorPropsCte}
     SELECT
       COUNT(*) as errors,
       COUNT(DISTINCT e.session_id) as sessions,
       MIN(e.created_at) as firstSeenAt,
       MAX(e.created_at) as lastSeenAt
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN error_issue_state state
       ON state.website_id = e.website_id
      AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.release = ?5)
       AND (?6 IS NULL OR props.environment = ?6)
       AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.error, releaseFilter, environmentFilter, statusFilter)
    .first<{ errors: number; sessions: number; firstSeenAt: number | null; lastSeenAt: number | null }>();

  const releaseRows = await env.DB.prepare(
    `${errorPropsCte}
     SELECT props.release as release, COUNT(*) as errors
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN error_issue_state state
       ON state.website_id = e.website_id
      AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND props.release IS NOT NULL
       AND (?5 IS NULL OR props.release = ?5)
       AND (?6 IS NULL OR props.environment = ?6)
       AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)
     GROUP BY props.release
     ORDER BY errors DESC
     LIMIT 5`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.error, releaseFilter, environmentFilter, statusFilter)
    .all<{ release: string; errors: number }>();

  const trendRows = await env.DB.prepare(
    `${errorPropsCte}
     SELECT
       date(e.created_at / 1000, 'unixepoch') as date,
       COUNT(*) as errors,
       COUNT(DISTINCT e.session_id) as sessions
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN error_issue_state state
       ON state.website_id = e.website_id
      AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.release = ?5)
       AND (?6 IS NULL OR props.environment = ?6)
       AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)
     GROUP BY date(e.created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.error, releaseFilter, environmentFilter, statusFilter)
    .all<{ date: string; errors: number; sessions: number }>();

  const severityRows = await env.DB.prepare(
    `${errorPropsCte}
     SELECT
       COALESCE(props.severity, 'error') as severity,
       COUNT(*) as errors
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN error_issue_state state
       ON state.website_id = e.website_id
      AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.release = ?5)
       AND (?6 IS NULL OR props.environment = ?6)
       AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)
     GROUP BY COALESCE(props.severity, 'error')
     ORDER BY errors DESC, severity ASC`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.error, releaseFilter, environmentFilter, statusFilter)
    .all<{ severity: string; errors: number }>();

  const environmentRows = await env.DB.prepare(
    `${errorPropsCte}
     SELECT props.environment as environment, COUNT(*) as errors
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN error_issue_state state
       ON state.website_id = e.website_id
      AND state.fingerprint = COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error')
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND props.environment IS NOT NULL
       AND (?5 IS NULL OR props.release = ?5)
       AND (?6 IS NULL OR props.environment = ?6)
       AND (?7 IS NULL OR COALESCE(state.status, 'open') = ?7)
     GROUP BY props.environment
     ORDER BY errors DESC
     LIMIT 5`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.error, releaseFilter, environmentFilter, statusFilter)
    .all<{ environment: string; errors: number }>();

  return {
    errors: row?.errors ?? 0,
    sessions: row?.sessions ?? 0,
    firstSeenAt: row?.firstSeenAt ?? null,
    lastSeenAt: row?.lastSeenAt ?? null,
    releases: releaseRows.results ?? [],
    environments: environmentRows.results ?? [],
    trend: trendRows.results ?? [],
    severities: severityRows.results ?? [],
  };
}

export async function getErrorEvent(env: Env, websiteId: string, eventId: string) {
  const event = await env.DB.prepare(
    `${errorEventPropsCte}
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
       props.name,
       props.severity,
       props.handled,
       props.release,
       props.environment
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     LEFT JOIN session s ON s.session_id = e.session_id
     WHERE e.website_id = ?1 AND e.event_id = ?2 AND e.event_type = ?3
     LIMIT 1`,
  )
    .bind(websiteId, eventId, EVENT_TYPE.error)
    .first<ErrorEventRow>();

  if (!event) return null;

  const props = await env.DB.prepare(
    `SELECT data_key as key,
            COALESCE(string_value, CAST(number_value AS TEXT)) as value
     FROM event_data
     WHERE website_id = ?1 AND website_event_id = ?2
     ORDER BY data_key ASC`,
  )
    .bind(websiteId, eventId)
    .all<{ key: string; value: string | null }>();

  const properties = props.results ?? [];
  const stack = properties.find((row) => row.key === 'stack')?.value ?? '';
  const resolvedStack = stack
    ? await resolveErrorStack(env, websiteId, event.release, stack)
    : [];

  return {
    ...event,
    properties,
    resolvedStack,
  };
}
