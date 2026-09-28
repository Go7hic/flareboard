import { computeErrorFingerprint, ERROR_FINGERPRINT_PROPERTY, EVENT_TYPE, type NormalizedFrame } from '@flareboard/shared';
import type { Env } from '../env';
import { deliverAlertNotification, hasRecentAlertEvent } from './alert-delivery';
import {
  ensureErrorIssueKeysMigrated,
  EVENT_ISSUE_KEY_SQL,
  eventKeyFingerprint,
  isLegacyEventKey,
  isLegacyIssueKey,
  legacyIssueKeyFingerprint,
  listIssueMergesInto,
  loadIssueMerges,
  resolveIssueFingerprint,
  syncResolvedIssueIndex,
  type ErrorIssueStatus,
} from './error-issue-keys';
import {
  fingerprintOccurrences,
  listErrorIssueRegressions,
  occurrenceTitle,
  recordErrorIssueRegression,
  type ErrorIssueRegressionRow,
} from './error-regressions';
import { siteDb } from './site-db';
import { resolveErrorStack } from './source-maps';

export type { ErrorIssueStatus } from './error-issue-keys';

export type ErrorIssueCommentRow = {
  id: string;
  userId: string | null;
  body: string;
  createdAt: number;
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
  notifyRegressions: boolean;
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
  notifyRegressions?: boolean;
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
  /** Issue the event belongs to (after merges). */
  fingerprint: string;
};

export type ErrorIssueRow = {
  fingerprint: string;
  message: string | null;
  name: string | null;
  severity: string | null;
  events: number;
  sessions: number;
  users: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  latestEventId: string | null;
  status: ErrorIssueStatus;
  note: string | null;
  assigneeUserId: string | null;
  stateUpdatedAt: number | null;
  resolvedAt: number | null;
  regressedAt: number | null;
  mergedCount: number;
  /** Event counts in ISSUE_TREND_BUCKETS equal slices of the queried range. */
  trend: number[];
  comments: ErrorIssueCommentRow[];
  samples: ErrorEventRow[];
};

export type ErrorIssueStatusFilter = ErrorIssueStatus;

export type ErrorFilters = {
  release?: string;
  environment?: string;
  /** `open` also matches `regressed` (a regressed issue is open again). */
  status?: ErrorIssueStatusFilter;
};

type WaitUntil = (promise: Promise<unknown>) => void;

export class ErrorIssueInputError extends Error {}

export const ISSUE_TREND_BUCKETS = 24;

const ERROR_PROP_SELECT = `
    MAX(CASE WHEN d.data_key = 'message' THEN d.string_value END) as message,
    MAX(CASE WHEN d.data_key IN ('name', 'errorName') THEN d.string_value END) as name,
    MAX(CASE WHEN d.data_key = 'severity' THEN d.string_value END) as severity,
    MAX(CASE WHEN d.data_key = 'handled' THEN d.string_value END) as handled,
    MAX(CASE WHEN d.data_key = 'release' THEN d.string_value END) as release,
    MAX(CASE WHEN d.data_key = 'environment' THEN d.string_value END) as environment,
    MAX(CASE WHEN d.data_key = '${ERROR_FINGERPRINT_PROPERTY}' THEN d.string_value END) as fingerprint`;

const ERROR_PROP_KEYS = `('message', 'name', 'errorName', 'severity', 'handled', 'release', 'environment', '${ERROR_FINGERPRINT_PROPERTY}')`;

/**
 * Error events of the queried window with their properties and issue key (`scoped`).
 * Binds: ?1 websiteId, ?2 startAt, ?3 endAt, ?4 event type, ?5 release, ?6 environment,
 * ?7 JSON array of issue keys to keep (NULL keeps all). props is limited to error events in
 * the window so it never scans a website's full event_data set.
 */
const scopedErrorsCte = `WITH props AS (
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
),
errs AS (
  SELECT
    e.event_id,
    e.session_id,
    e.visit_id,
    e.url_path,
    e.event_name,
    e.created_at,
    props.message,
    props.name,
    props.severity,
    props.handled,
    props.release,
    props.environment,
    ${EVENT_ISSUE_KEY_SQL} AS issue_key
  FROM website_event e
  LEFT JOIN props ON props.website_event_id = e.event_id
  WHERE e.website_id = ?1
    AND e.created_at >= ?2
    AND e.created_at <= ?3
    AND e.event_type = ?4
    AND (?5 IS NULL OR props.release = ?5)
    AND (?6 IS NULL OR props.environment = ?6)
),
scoped AS (
  SELECT * FROM errs
  WHERE ?7 IS NULL OR issue_key IN (SELECT value FROM json_each(?7))
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

const SAMPLE_COLUMNS = `s.event_id as id,
       s.session_id as sessionId,
       s.visit_id as visitId,
       s.url_path as urlPath,
       s.event_name as eventName,
       s.created_at as createdAt,
       sess.browser,
       sess.os,
       sess.device,
       sess.country,
       s.message,
       s.name,
       s.severity,
       s.handled,
       s.release,
       s.environment,
       s.issue_key as issueKey`;

function scopeBinds(websiteId: string, startAt: number, endAt: number, filters: ErrorFilters, keys: string[] | null) {
  return [
    websiteId,
    startAt,
    endAt,
    EVENT_TYPE.error,
    filters.release ?? null,
    filters.environment ?? null,
    keys ? JSON.stringify(keys) : null,
  ] as const;
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function statusMatches(filter: ErrorIssueStatusFilter | undefined, status: ErrorIssueStatus) {
  if (!filter) return true;
  if (filter === 'open') return status === 'open' || status === 'regressed';
  return status === filter;
}

// ---------------------------------------------------------------------------------------------
// Grouping

type IssueStateRow = {
  fingerprint: string;
  status: ErrorIssueStatus;
  note: string | null;
  assigneeUserId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  resolvedAt: number | null;
  regressedAt: number | null;
};

type IssueKeyStats = {
  key: string;
  /** Raw fingerprint of the key (legacy keys converted). */
  fingerprint: string;
  events: number;
  sessions: number;
  users: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

type IssueAggregate = {
  fingerprint: string;
  keys: IssueKeyStats[];
  events: number;
  sessions: number;
  users: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Latest event that carries `$exception_fingerprint`: only those can signal a regression. */
  lastFingerprintedAt: number | null;
};

export type ErrorGrouping = {
  issues: Map<string, IssueAggregate>;
  states: Map<string, IssueStateRow>;
  merges: Map<string, string>;
};

async function loadIssueStates(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT fingerprint,
            status,
            note,
            assignee_user_id as assigneeUserId,
            created_at as createdAt,
            updated_at as updatedAt,
            resolved_at as resolvedAt,
            regressed_at as regressedAt
     FROM error_issue_state
     WHERE website_id = ?1`,
  )
    .bind(websiteId)
    .all<IssueStateRow>();
  return new Map((rows.results ?? []).map((row) => [row.fingerprint, row]));
}

function statusOf(grouping: ErrorGrouping, fingerprint: string): ErrorIssueStatus {
  return grouping.states.get(fingerprint)?.status ?? 'open';
}

/**
 * Groups the window's error events into issues: events with `$exception_fingerprint` by that
 * value, older events by the fingerprint of their normalized message, both mapped through merges.
 * One scan returns per-key totals; exact distinct sessions/users of issues made of several keys
 * need a second scan with the key -> issue mapping passed as JSON.
 */
export async function buildErrorGrouping(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
  preloaded: { merges?: Map<string, string> } = {},
): Promise<ErrorGrouping> {
  const [merges, states, keyRows] = await Promise.all([
    preloaded.merges ?? loadIssueMerges(env, websiteId),
    loadIssueStates(env, websiteId),
    siteDb(env, websiteId)
      .prepare(
        `${scopedErrorsCte}
         SELECT s.issue_key as key,
                COUNT(*) as events,
                COUNT(DISTINCT s.session_id) as sessions,
                COUNT(DISTINCT COALESCE(sess.distinct_id, s.session_id)) as users,
                MIN(s.created_at) as firstSeenAt,
                MAX(s.created_at) as lastSeenAt
         FROM scoped s
         LEFT JOIN session sess ON sess.session_id = s.session_id
         GROUP BY s.issue_key`,
      )
      .bind(...scopeBinds(websiteId, startAt, endAt, filters, null))
      .all<Omit<IssueKeyStats, 'fingerprint'>>(),
  ]);

  const issues = new Map<string, IssueAggregate>();
  for (const row of keyRows.results ?? []) {
    const fingerprint = eventKeyFingerprint(row.key);
    const canonical = merges.get(fingerprint) ?? fingerprint;
    const stats: IssueKeyStats = { ...row, fingerprint };
    const issue = issues.get(canonical);
    const fingerprinted = isLegacyEventKey(row.key) ? null : row.lastSeenAt;
    if (!issue) {
      issues.set(canonical, {
        fingerprint: canonical,
        keys: [stats],
        events: row.events,
        sessions: row.sessions,
        users: row.users,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        lastFingerprintedAt: fingerprinted,
      });
      continue;
    }
    issue.keys.push(stats);
    issue.events += row.events;
    issue.firstSeenAt = Math.min(issue.firstSeenAt, row.firstSeenAt);
    issue.lastSeenAt = Math.max(issue.lastSeenAt, row.lastSeenAt);
    if (fingerprinted != null) issue.lastFingerprintedAt = Math.max(issue.lastFingerprintedAt ?? 0, fingerprinted);
  }

  const multiKey = [...issues.values()].filter((issue) => issue.keys.length > 1);
  if (multiKey.length) {
    const mapping = multiKey.flatMap((issue) => issue.keys.map((key) => [key.key, issue.fingerprint]));
    const exact = await siteDb(env, websiteId)
      .prepare(
        `${scopedErrorsCte},
         keymap AS (
           SELECT json_extract(value, '$[0]') AS issue_key, json_extract(value, '$[1]') AS fingerprint
           FROM json_each(?8)
         )
         SELECT k.fingerprint,
                COUNT(DISTINCT s.session_id) as sessions,
                COUNT(DISTINCT COALESCE(sess.distinct_id, s.session_id)) as users
         FROM scoped s
         JOIN keymap k ON k.issue_key = s.issue_key
         LEFT JOIN session sess ON sess.session_id = s.session_id
         GROUP BY k.fingerprint`,
      )
      .bind(
        ...scopeBinds(websiteId, startAt, endAt, filters, mapping.map(([key]) => key!)),
        JSON.stringify(mapping),
      )
      .all<{ fingerprint: string; sessions: number; users: number }>();
    for (const row of exact.results ?? []) {
      const issue = issues.get(row.fingerprint);
      if (!issue) continue;
      issue.sessions = row.sessions;
      issue.users = row.users;
    }
  }

  return { issues, states, merges };
}

/** Issue keys whose issue has the requested status, or null when every key is kept. */
function keysForStatus(grouping: ErrorGrouping, status: ErrorIssueStatusFilter | undefined) {
  if (!status) return null;
  return [...grouping.issues.values()]
    .filter((issue) => statusMatches(status, statusOf(grouping, issue.fingerprint)))
    .flatMap((issue) => issue.keys.map((key) => key.key));
}

/**
 * The grouping already knows the latest fingerprinted event of each issue: a resolved issue with
 * a newer one has regressed. Nothing is queried unless that happens (the ingest fast path and the
 * cron usually get there first).
 */
async function applyReadTimeRegressions(
  env: Env,
  websiteId: string,
  grouping: ErrorGrouping,
  options: { waitUntil?: WaitUntil; only?: string } = {},
) {
  for (const issue of grouping.issues.values()) {
    if (options.only && issue.fingerprint !== options.only) continue;
    const state = grouping.states.get(issue.fingerprint);
    if (state?.status !== 'resolved' || issue.lastFingerprintedAt == null) continue;
    const resolvedAt = state.resolvedAt ?? 0;
    if (issue.lastFingerprintedAt <= resolvedAt) continue;

    const fingerprints = issue.keys.filter((key) => !isLegacyEventKey(key.key)).map((key) => key.fingerprint);
    const firsts = await fingerprintOccurrences(env, websiteId, fingerprints, resolvedAt, 'first');
    const first = [...firsts.values()].sort((a, b) => a.occurredAt - b.occurredAt)[0];
    if (!first) continue;
    const regression = await recordErrorIssueRegression(
      env,
      websiteId,
      issue.fingerprint,
      {
        occurredAt: first.occurredAt,
        eventId: first.eventId,
        release: first.release,
        environment: first.environment,
        severity: first.severity,
        title: occurrenceTitle(first),
      },
      { waitUntil: options.waitUntil },
    );
    if (regression) {
      grouping.states.set(issue.fingerprint, {
        ...state,
        status: 'regressed',
        regressedAt: regression.detectedAt,
        updatedAt: regression.detectedAt,
      });
    }
  }
}

async function loadIssueTrends(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters,
  keys: string[],
  buckets: number,
) {
  const rows = await siteDb(env, websiteId)
    .prepare(
      `${scopedErrorsCte}
       SELECT issue_key as key,
              CAST((created_at - ?2) * ?8 / (?3 - ?2 + 1) AS INTEGER) as bucket,
              COUNT(*) as events
       FROM scoped
       GROUP BY issue_key, bucket`,
    )
    .bind(...scopeBinds(websiteId, startAt, endAt, filters, keys), buckets)
    .all<{ key: string; bucket: number; events: number }>();
  const byKey = new Map<string, number[]>();
  for (const row of rows.results ?? []) {
    const series = byKey.get(row.key) ?? new Array<number>(buckets).fill(0);
    const index = Math.min(Math.max(row.bucket, 0), buckets - 1);
    series[index] = (series[index] ?? 0) + row.events;
    byKey.set(row.key, series);
  }
  return byKey;
}

async function loadIssueSamples(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters,
  keys: string[],
  perKey: number,
) {
  const rows = await siteDb(env, websiteId)
    .prepare(
      `${scopedErrorsCte},
       ranked AS (
         SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.issue_key ORDER BY s.created_at DESC) AS rn
         FROM scoped s
       )
       SELECT ${SAMPLE_COLUMNS}
       FROM ranked s
       LEFT JOIN session sess ON sess.session_id = s.session_id
       WHERE s.rn <= ?8
       ORDER BY s.created_at DESC`,
    )
    .bind(...scopeBinds(websiteId, startAt, endAt, filters, keys), perKey)
    .all<Omit<ErrorEventRow, 'fingerprint'> & { issueKey: string }>();
  return rows.results ?? [];
}

function toEventRow(row: Omit<ErrorEventRow, 'fingerprint'> & { issueKey: string }, merges: Map<string, string>): ErrorEventRow {
  const { issueKey, ...event } = row;
  const fingerprint = eventKeyFingerprint(issueKey);
  return { ...event, fingerprint: merges.get(fingerprint) ?? fingerprint };
}

function sumSeries(series: number[][], buckets: number) {
  const total = new Array<number>(buckets).fill(0);
  for (const values of series) values.forEach((value, index) => (total[index] = (total[index] ?? 0) + value));
  return total;
}

// ---------------------------------------------------------------------------------------------
// Queries

export async function getErrorEvents(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
  limit = 100,
  grouping?: ErrorGrouping,
) {
  const context = filters.status ? (grouping ?? (await buildErrorGrouping(env, websiteId, startAt, endAt, filters))) : grouping;
  const keys = context ? keysForStatus(context, filters.status) : null;
  if (keys && !keys.length) return [];
  const merges = context?.merges ?? (await loadIssueMerges(env, websiteId));
  const rows = await siteDb(env, websiteId)
    .prepare(
      `${scopedErrorsCte}
       SELECT ${SAMPLE_COLUMNS}
       FROM scoped s
       LEFT JOIN session sess ON sess.session_id = s.session_id
       ORDER BY s.created_at DESC
       LIMIT ?8`,
    )
    .bind(...scopeBinds(websiteId, startAt, endAt, filters, keys), Math.min(Math.max(limit, 1), 500))
    .all<Omit<ErrorEventRow, 'fingerprint'> & { issueKey: string }>();
  return (rows.results ?? []).map((row) => toEventRow(row, merges));
}

export async function getErrorIssues(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
  limit = 25,
  grouping?: ErrorGrouping,
): Promise<ErrorIssueRow[]> {
  const context = grouping ?? (await buildErrorGrouping(env, websiteId, startAt, endAt, filters));
  const selected = [...context.issues.values()]
    .filter((issue) => statusMatches(filters.status, statusOf(context, issue.fingerprint)))
    .sort(
      (a, b) => b.events - a.events || b.lastSeenAt - a.lastSeenAt || a.fingerprint.localeCompare(b.fingerprint),
    )
    .slice(0, Math.min(Math.max(limit, 1), 100));
  if (!selected.length) return [];

  const keys = selected.flatMap((issue) => issue.keys.map((key) => key.key));
  const [trends, sampleRows, comments] = await Promise.all([
    loadIssueTrends(env, websiteId, startAt, endAt, filters, keys, ISSUE_TREND_BUCKETS),
    loadIssueSamples(env, websiteId, startAt, endAt, filters, keys, 3),
    getErrorIssueCommentsBatch(env, websiteId, selected.map((issue) => issue.fingerprint)),
  ]);

  const samplesByIssue = new Map<string, ErrorEventRow[]>();
  for (const row of sampleRows) {
    const event = toEventRow(row, context.merges);
    const list = samplesByIssue.get(event.fingerprint) ?? [];
    if (list.length < 3) list.push(event);
    samplesByIssue.set(event.fingerprint, list);
  }
  const mergedCounts = new Map<string, number>();
  for (const target of context.merges.values()) mergedCounts.set(target, (mergedCounts.get(target) ?? 0) + 1);

  return selected.map((issue) => {
    const samples = samplesByIssue.get(issue.fingerprint) ?? [];
    const latest = samples[0];
    const state = context.states.get(issue.fingerprint);
    return {
      fingerprint: issue.fingerprint,
      message: latest ? (latest.message ?? latest.eventName ?? 'Unknown error') : null,
      name: latest ? (latest.name ?? 'Error') : null,
      severity: latest ? (latest.severity ?? 'error') : null,
      events: issue.events,
      sessions: issue.sessions,
      users: issue.users,
      firstSeenAt: issue.firstSeenAt,
      lastSeenAt: issue.lastSeenAt,
      latestEventId: latest?.id ?? null,
      status: state?.status ?? 'open',
      note: state?.note ?? null,
      assigneeUserId: state?.assigneeUserId ?? null,
      stateUpdatedAt: state?.updatedAt ?? null,
      resolvedAt: state?.resolvedAt ?? null,
      regressedAt: state?.regressedAt ?? null,
      mergedCount: mergedCounts.get(issue.fingerprint) ?? 0,
      trend: sumSeries(
        issue.keys.map((key) => trends.get(key.key) ?? []),
        ISSUE_TREND_BUCKETS,
      ),
      comments: comments.get(issue.fingerprint) ?? [],
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

export async function getErrorStats(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
  grouping?: ErrorGrouping,
) {
  const context = filters.status ? (grouping ?? (await buildErrorGrouping(env, websiteId, startAt, endAt, filters))) : grouping;
  const keys = context ? keysForStatus(context, filters.status) : null;
  const empty = {
    errors: 0,
    sessions: 0,
    users: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    releases: [],
    environments: [],
    trend: [],
    severities: [],
  };
  if (keys && !keys.length) return empty;

  const db = siteDb(env, websiteId);
  const binds = scopeBinds(websiteId, startAt, endAt, filters, keys);
  const [totals, releaseRows, trendRows, severityRows, environmentRows] = await Promise.all([
    db
      .prepare(
        `${scopedErrorsCte}
         SELECT COUNT(*) as errors,
                COUNT(DISTINCT s.session_id) as sessions,
                COUNT(DISTINCT COALESCE(sess.distinct_id, s.session_id)) as users,
                MIN(s.created_at) as firstSeenAt,
                MAX(s.created_at) as lastSeenAt
         FROM scoped s
         LEFT JOIN session sess ON sess.session_id = s.session_id`,
      )
      .bind(...binds)
      .first<{ errors: number; sessions: number; users: number; firstSeenAt: number | null; lastSeenAt: number | null }>(),
    db
      .prepare(
        `${scopedErrorsCte}
         SELECT release, COUNT(*) as errors
         FROM scoped
         WHERE release IS NOT NULL
         GROUP BY release
         ORDER BY errors DESC
         LIMIT 5`,
      )
      .bind(...binds)
      .all<{ release: string; errors: number }>(),
    db
      .prepare(
        `${scopedErrorsCte}
         SELECT date(created_at / 1000, 'unixepoch') as date,
                COUNT(*) as errors,
                COUNT(DISTINCT session_id) as sessions
         FROM scoped
         GROUP BY date(created_at / 1000, 'unixepoch')
         ORDER BY date ASC
         LIMIT 90`,
      )
      .bind(...binds)
      .all<{ date: string; errors: number; sessions: number }>(),
    db
      .prepare(
        `${scopedErrorsCte}
         SELECT COALESCE(severity, 'error') as severity, COUNT(*) as errors
         FROM scoped
         GROUP BY COALESCE(severity, 'error')
         ORDER BY errors DESC, severity ASC`,
      )
      .bind(...binds)
      .all<{ severity: string; errors: number }>(),
    db
      .prepare(
        `${scopedErrorsCte}
         SELECT environment, COUNT(*) as errors
         FROM scoped
         WHERE environment IS NOT NULL
         GROUP BY environment
         ORDER BY errors DESC
         LIMIT 5`,
      )
      .bind(...binds)
      .all<{ environment: string; errors: number }>(),
  ]);

  return {
    errors: totals?.errors ?? 0,
    sessions: totals?.sessions ?? 0,
    users: totals?.users ?? 0,
    firstSeenAt: totals?.firstSeenAt ?? null,
    lastSeenAt: totals?.lastSeenAt ?? null,
    releases: releaseRows.results ?? [],
    environments: environmentRows.results ?? [],
    trend: trendRows.results ?? [],
    severities: severityRows.results ?? [],
  };
}

/** Everything the Errors page needs, with one grouping pass shared by stats, issues and events. */
export async function getErrorOverview(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: ErrorFilters = {},
  options: { waitUntil?: WaitUntil } = {},
) {
  await ensureErrorIssueKeysMigrated(env, websiteId);
  const grouping = await buildErrorGrouping(env, websiteId, startAt, endAt, filters);
  await applyReadTimeRegressions(env, websiteId, grouping, options);
  const [stats, issues, errors] = await Promise.all([
    getErrorStats(env, websiteId, startAt, endAt, filters, grouping),
    getErrorIssues(env, websiteId, startAt, endAt, filters, 25, grouping),
    getErrorEvents(env, websiteId, startAt, endAt, filters, 100, grouping),
  ]);
  return { stats, issues, errors };
}

async function loadErrorEventRow(env: Env, websiteId: string, eventId: string) {
  return siteDb(env, websiteId)
    .prepare(
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
         props.environment,
         ${EVENT_ISSUE_KEY_SQL} as issueKey
       FROM website_event e
       LEFT JOIN props ON props.website_event_id = e.event_id
       LEFT JOIN session s ON s.session_id = e.session_id
       WHERE e.website_id = ?1 AND e.event_id = ?2 AND e.event_type = ?3
       LIMIT 1`,
    )
    .bind(websiteId, eventId, EVENT_TYPE.error)
    .first<Omit<ErrorEventRow, 'fingerprint'> & { issueKey: string }>();
}

export async function getErrorEvent(env: Env, websiteId: string, eventId: string, merges?: Map<string, string>) {
  const row = await loadErrorEventRow(env, websiteId, eventId);
  if (!row) return null;
  const event = toEventRow(row, merges ?? (await loadIssueMerges(env, websiteId)));

  const props = await siteDb(env, websiteId)
    .prepare(
      `SELECT data_key as key,
              COALESCE(string_value, CAST(number_value AS TEXT)) as value
       FROM event_data
       WHERE website_id = ?1 AND website_event_id = ?2
       ORDER BY data_key ASC`,
    )
    .bind(websiteId, eventId)
    .all<{ key: string; value: string | null }>();

  const properties = props.results ?? [];
  const stack = properties.find((property) => property.key === 'stack')?.value ?? '';
  const resolvedStack = stack ? await resolveErrorStack(env, websiteId, event.release, stack) : [];
  const grouping = computeErrorFingerprint({ type: event.name, message: event.message, stack });
  const legacy = !properties.some((property) => property.key === ERROR_FINGERPRINT_PROPERTY);

  return {
    ...event,
    properties,
    resolvedStack,
    grouping: {
      // Events stored before fingerprints are grouped by message whatever their stack.
      method: legacy ? ('message' as const) : grouping.method,
      frames: legacy ? ([] as NormalizedFrame[]) : grouping.frames,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Issue detail, merge, state, comments

export type ErrorIssueDetail = {
  fingerprint: string;
  name: string | null;
  message: string | null;
  severity: string | null;
  status: ErrorIssueStatus;
  note: string | null;
  assigneeUserId: string | null;
  stateUpdatedAt: number | null;
  resolvedAt: number | null;
  regressedAt: number | null;
  events: number;
  sessions: number;
  users: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  trend: number[];
  trendStartAt: number;
  trendEndAt: number;
  samples: ErrorEventRow[];
  latestEvent: Awaited<ReturnType<typeof getErrorEvent>>;
  comments: ErrorIssueCommentRow[];
  mergedIssues: Array<{
    fingerprint: string;
    name: string | null;
    message: string | null;
    mergedAt: number | null;
    mergedBy: string | null;
    events: number;
    lastSeenAt: number | null;
  }>;
  regressions: ErrorIssueRegressionRow[];
};

const DETAIL_TREND_BUCKETS = 30;
const LATEST_EVENT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * One issue with its window stats, trend, recent events (the latest with a resolved stack),
 * comments, merged issues and regression history. A fingerprint that was merged away answers
 * `{ mergedInto }` so clients can follow it.
 */
export async function getErrorIssue(
  env: Env,
  websiteId: string,
  requested: string,
  startAt: number,
  endAt: number,
  options: { waitUntil?: WaitUntil } = {},
): Promise<{ mergedInto: string } | { issue: ErrorIssueDetail } | null> {
  await ensureErrorIssueKeysMigrated(env, websiteId);
  const direct = isLegacyIssueKey(requested) ? legacyIssueKeyFingerprint(requested) : requested;
  const merges = await loadIssueMerges(env, websiteId);
  const mergedInto = merges.get(direct);
  if (mergedInto) return { mergedInto };
  const fingerprint = direct;

  const grouping = await buildErrorGrouping(env, websiteId, startAt, endAt, {}, { merges });
  await applyReadTimeRegressions(env, websiteId, grouping, { ...options, only: fingerprint });
  const aggregate = grouping.issues.get(fingerprint);
  const keys = aggregate?.keys.map((key) => key.key) ?? [];

  const [mergeRows, regressions, comments, trends, sampleRows] = await Promise.all([
    listIssueMergesInto(env, websiteId, fingerprint),
    listErrorIssueRegressions(env, websiteId, fingerprint),
    getErrorIssueComments(env, websiteId, fingerprint, 100),
    keys.length
      ? loadIssueTrends(env, websiteId, startAt, endAt, {}, keys, DETAIL_TREND_BUCKETS)
      : Promise.resolve(new Map<string, number[]>()),
    keys.length ? loadIssueSamples(env, websiteId, startAt, endAt, {}, keys, 10) : Promise.resolve([]),
  ]);
  const samples = sampleRows.map((row) => toEventRow(row, merges)).slice(0, 10);

  let latestEventId = samples[0]?.id ?? null;
  if (!latestEventId) {
    // Nothing in the window: fall back to the most recent fingerprinted event of the issue.
    const members = [fingerprint, ...mergeRows.map((row) => row.sourceFingerprint)];
    const latest = await fingerprintOccurrences(env, websiteId, members, endAt - LATEST_EVENT_LOOKBACK_MS, 'last');
    latestEventId = [...latest.values()].sort((a, b) => b.occurredAt - a.occurredAt)[0]?.eventId ?? null;
  }
  const state = grouping.states.get(fingerprint);
  if (!latestEventId && !state && !mergeRows.length && !regressions.length) return null;
  const latestEvent = latestEventId ? await getErrorEvent(env, websiteId, latestEventId, merges) : null;

  const keyStats = aggregate?.keys ?? [];
  return {
    issue: {
      fingerprint,
      name: latestEvent ? (latestEvent.name ?? 'Error') : null,
      message: latestEvent ? (latestEvent.message ?? latestEvent.eventName ?? 'Unknown error') : null,
      severity: latestEvent ? (latestEvent.severity ?? 'error') : null,
      status: state?.status ?? 'open',
      note: state?.note ?? null,
      assigneeUserId: state?.assigneeUserId ?? null,
      stateUpdatedAt: state?.updatedAt ?? null,
      resolvedAt: state?.resolvedAt ?? null,
      regressedAt: state?.regressedAt ?? null,
      events: aggregate?.events ?? 0,
      sessions: aggregate?.sessions ?? 0,
      users: aggregate?.users ?? 0,
      firstSeenAt: aggregate?.firstSeenAt ?? null,
      lastSeenAt: aggregate?.lastSeenAt ?? null,
      trend: sumSeries(
        keys.map((key) => trends.get(key) ?? []),
        DETAIL_TREND_BUCKETS,
      ),
      trendStartAt: startAt,
      trendEndAt: endAt,
      samples,
      latestEvent,
      comments,
      mergedIssues: mergeRows.map((row) => {
        const members = keyStats.filter((key) => key.fingerprint === row.sourceFingerprint);
        return {
          fingerprint: row.sourceFingerprint,
          name: row.sourceName,
          message: row.sourceMessage,
          mergedAt: row.createdAt,
          mergedBy: row.mergedBy,
          events: members.reduce((sum, key) => sum + key.events, 0),
          lastSeenAt: members.length ? Math.max(...members.map((key) => key.lastSeenAt)) : null,
        };
      }),
      regressions,
    },
  };
}

/**
 * Merges issues into `target`: their past and future events group under it. The target keeps
 * its own status, assignee, note and comments; the merged issues' rows stay in place (hidden)
 * so an unmerge restores them.
 */
export async function mergeErrorIssues(
  env: Env,
  websiteId: string,
  targetInput: string,
  sourceInputs: string[],
  userId: string | null,
) {
  await ensureErrorIssueKeysMigrated(env, websiteId);
  const target = await resolveIssueFingerprint(env, websiteId, targetInput);
  const resolvedSources = await Promise.all(sourceInputs.map((source) => resolveIssueFingerprint(env, websiteId, source)));
  const sources = [...new Set(resolvedSources)].filter((source) => source !== target);
  if (!sources.length) throw new ErrorIssueInputError('Choose at least one other issue to merge.');

  // Title snapshot for the merged list (the merged issue no longer shows on its own).
  const titles = await fingerprintOccurrences(env, websiteId, sources, Date.now() - LATEST_EVENT_LOOKBACK_MS, 'last');
  const now = Date.now();
  await env.DB.batch([
    ...sources.map((source) =>
      env.DB.prepare(
        `INSERT INTO error_issue_merge
           (website_id, source_fingerprint, target_fingerprint, source_name, source_message, merged_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(website_id, source_fingerprint)
         DO UPDATE SET target_fingerprint = excluded.target_fingerprint,
                       source_name = COALESCE(excluded.source_name, error_issue_merge.source_name),
                       source_message = COALESCE(excluded.source_message, error_issue_merge.source_message),
                       merged_by = excluded.merged_by,
                       created_at = excluded.created_at`,
      ).bind(
        websiteId,
        source,
        target,
        titles.get(source)?.name ?? null,
        titles.get(source)?.message?.slice(0, 1000) ?? null,
        userId,
        now,
      ),
    ),
    // Issues previously merged into a source now point straight at the target.
    env.DB.prepare(
      `UPDATE error_issue_merge
       SET target_fingerprint = ?2
       WHERE website_id = ?1 AND target_fingerprint IN (SELECT value FROM json_each(?3))`,
    ).bind(websiteId, target, JSON.stringify(sources)),
  ]);

  await syncResolvedIssueIndex(env, websiteId, [target]);
  return { fingerprint: target, merged: sources, mergedIssues: await listIssueMergesInto(env, websiteId, target) };
}

/** Splits a merged issue back out. Returns the issue it was merged into, or null if it was not merged. */
export async function unmergeErrorIssue(env: Env, websiteId: string, sourceInput: string) {
  const source = isLegacyIssueKey(sourceInput) ? legacyIssueKeyFingerprint(sourceInput) : sourceInput;
  const row = await env.DB.prepare(
    `DELETE FROM error_issue_merge WHERE website_id = ?1 AND source_fingerprint = ?2 RETURNING target_fingerprint AS target`,
  )
    .bind(websiteId, source)
    .first<{ target: string }>();
  if (!row) return null;
  await syncResolvedIssueIndex(env, websiteId, [source]);
  return { fingerprint: source, target: row.target };
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
  fingerprintInput: string,
  userId: string | null,
  body: string,
) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Comment body is required');
  await ensureErrorIssueKeysMigrated(env, websiteId);
  const fingerprint = await resolveIssueFingerprint(env, websiteId, fingerprintInput);
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

/**
 * Sets an issue's status. `note` / `assigneeUserId` are only changed when passed (null clears).
 * Resolving stamps resolved_at, which regression detection compares events against.
 */
export async function updateErrorIssueState(
  env: Env,
  websiteId: string,
  fingerprintInput: string,
  status: 'open' | 'resolved' | 'ignored',
  note?: string | null,
  assigneeUserId?: string | null,
) {
  await ensureErrorIssueKeysMigrated(env, websiteId);
  const fingerprint = await resolveIssueFingerprint(env, websiteId, fingerprintInput);
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO error_issue_state
       (website_id, fingerprint, status, note, assignee_user_id, resolved_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?3 = 'resolved' THEN ?6 END, ?6, ?6)
     ON CONFLICT(website_id, fingerprint)
     DO UPDATE SET status = excluded.status,
                   note = CASE WHEN ?7 THEN excluded.note ELSE error_issue_state.note END,
                   assignee_user_id = CASE WHEN ?8 THEN excluded.assignee_user_id ELSE error_issue_state.assignee_user_id END,
                   resolved_at = CASE
                     WHEN excluded.status = 'resolved' AND error_issue_state.status <> 'resolved' THEN ?6
                     ELSE error_issue_state.resolved_at
                   END,
                   updated_at = excluded.updated_at
     RETURNING status, note, assignee_user_id AS assigneeUserId, resolved_at AS resolvedAt, regressed_at AS regressedAt, updated_at AS updatedAt`,
  )
    .bind(
      websiteId,
      fingerprint,
      status,
      note?.trim() || null,
      assigneeUserId?.trim() || null,
      now,
      note !== undefined ? 1 : 0,
      assigneeUserId !== undefined ? 1 : 0,
    )
    .first<{
      status: ErrorIssueStatus;
      note: string | null;
      assigneeUserId: string | null;
      resolvedAt: number | null;
      regressedAt: number | null;
      updatedAt: number;
    }>();

  await syncResolvedIssueIndex(env, websiteId, [fingerprint]);
  return {
    websiteId,
    fingerprint,
    status: row?.status ?? status,
    note: row?.note ?? null,
    assigneeUserId: row?.assigneeUserId ?? null,
    resolvedAt: row?.resolvedAt ?? null,
    regressedAt: row?.regressedAt ?? null,
    updatedAt: row?.updatedAt ?? now,
  };
}

// ---------------------------------------------------------------------------------------------
// Alert rules

const ALERT_RULE_COLUMNS = `alert_rule_id as id,
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
            notify_regressions as notifyRegressions,
            created_at as createdAt,
            updated_at as updatedAt`;

type StoredAlertRule = Omit<ErrorAlertRuleRow, 'enabled' | 'notifyRegressions'> & {
  enabled: boolean | number;
  notifyRegressions: boolean | number;
};

function normalizeErrorAlertRule(row: StoredAlertRule): ErrorAlertRuleRow {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    notifyRegressions: Boolean(row.notifyRegressions),
  };
}

export async function listErrorAlertRules(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT ${ALERT_RULE_COLUMNS}
     FROM error_alert_rule
     WHERE website_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(websiteId)
    .all<StoredAlertRule>();

  return (rows.results ?? []).map(normalizeErrorAlertRule);
}

export async function getErrorAlertRule(env: Env, websiteId: string, alertRuleId: string) {
  const row = await env.DB.prepare(
    `SELECT ${ALERT_RULE_COLUMNS}
     FROM error_alert_rule
     WHERE website_id = ?1 AND alert_rule_id = ?2
     LIMIT 1`,
  )
    .bind(websiteId, alertRuleId)
    .first<StoredAlertRule>();

  return row ? normalizeErrorAlertRule(row) : null;
}

export async function createErrorAlertRule(env: Env, websiteId: string, input: ErrorAlertRuleInput) {
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO error_alert_rule
       (alert_rule_id, website_id, name, enabled, threshold, window_minutes, severity, release, environment, channel, target, notify_regressions, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
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
      input.notifyRegressions === false ? 0 : 1,
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
  const notifyRegressions = patch.notifyRegressions ?? existing.notifyRegressions;
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
         notify_regressions = ?12,
         updated_at = ?13
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
      notifyRegressions ? 1 : 0,
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

    const row = await siteDb(env, websiteId)
      .prepare(
        `${scopedErrorsCte}
         SELECT COUNT(*) as count
         FROM scoped
         WHERE ?8 IS NULL OR COALESCE(severity, 'error') = ?8`,
      )
      .bind(
        ...scopeBinds(
          websiteId,
          windowStartAt,
          now,
          { release: rule.release ?? undefined, environment: rule.environment ?? undefined },
          null,
        ),
        rule.severity,
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
