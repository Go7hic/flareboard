import { ERROR_FINGERPRINT_PROPERTY } from '@flareboard/shared';
import type { Env } from '../env';
import { deliverRegressionNotification } from './alert-delivery';
import { syncResolvedIssueIndex } from './error-issue-keys';
import { siteDb } from './site-db';

/**
 * Regression detection: a resolved issue that occurs again becomes `regressed` and triggers the
 * website's error alert channels once. Three paths feed recordErrorIssueRegression, whose
 * conditional UPDATE makes sure only one of them wins per regression:
 *   1. ingest sees a resolved fingerprint in KV and calls POST /api/internal/errors/regressions,
 *   2. the issue list notices an event newer than the resolve time,
 *   3. the hourly cron sweeps resolved issues (catches anything the first two missed).
 */

export type ErrorIssueRegressionRow = {
  id: string;
  fingerprint: string;
  eventId: string | null;
  release: string | null;
  environment: string | null;
  resolvedAt: number | null;
  occurredAt: number;
  detectedAt: number;
  notifiedAt: number | null;
};

export type RegressionOccurrence = {
  occurredAt: number;
  eventId?: string | null;
  release?: string | null;
  environment?: string | null;
  severity?: string | null;
  title?: string | null;
};

type WaitUntil = (promise: Promise<unknown>) => void;

/** Late queue writes and clock skew: re-check this far behind the previous sweep. */
const SWEEP_OVERLAP_MS = 60 * 60 * 1000;
const MAX_REGRESSION_WEBSITES_PER_TICK = 100;
const REGRESSION_SCAN_CURSOR_KEY = 'cron:error-regression-cursor';

function issueUrl(env: Env, websiteId: string, fingerprint: string) {
  const base = env.DASHBOARD_URL?.trim().replace(/\/$/, '');
  return base ? `${base}/websites/${websiteId}/errors/issues/${encodeURIComponent(fingerprint)}` : null;
}

async function notifyRegression(
  env: Env,
  websiteId: string,
  regression: ErrorIssueRegressionRow,
  occurrence: RegressionOccurrence,
) {
  const rules = await env.DB.prepare(
    `SELECT name, channel, target, severity, release, environment
     FROM error_alert_rule
     WHERE website_id = ?1 AND enabled = 1 AND notify_regressions = 1 AND channel <> 'record'
     ORDER BY created_at ASC`,
  )
    .bind(websiteId)
    .all<{
      name: string;
      channel: string;
      target: string | null;
      severity: string | null;
      release: string | null;
      environment: string | null;
    }>();

  const severity = occurrence.severity ?? 'error';
  const seen = new Set<string>();
  let attempted = 0;
  for (const rule of rules.results ?? []) {
    if (rule.severity && rule.severity !== severity) continue;
    if (rule.release && rule.release !== (occurrence.release ?? null)) continue;
    if (rule.environment && rule.environment !== (occurrence.environment ?? null)) continue;
    // Several rules often share one inbox or webhook: one message per destination.
    const destination = `${rule.channel.trim().toLowerCase()}:${rule.target?.trim() ?? ''}`;
    if (seen.has(destination)) continue;
    seen.add(destination);
    attempted++;
    try {
      await deliverRegressionNotification(env, {
        websiteId,
        ruleName: rule.name,
        channel: rule.channel,
        target: rule.target,
        fingerprint: regression.fingerprint,
        title: occurrence.title?.trim() || regression.fingerprint,
        release: occurrence.release ?? null,
        environment: occurrence.environment ?? null,
        occurredAt: regression.occurredAt,
        resolvedAt: regression.resolvedAt,
        issueUrl: issueUrl(env, websiteId, regression.fingerprint),
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'error_regression_delivery_failed',
          websiteId,
          fingerprint: regression.fingerprint,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (attempted) {
    await env.DB.prepare(`UPDATE error_issue_regression SET notified_at = ?2 WHERE regression_id = ?1`)
      .bind(regression.id, Date.now())
      .run();
  }
}

/**
 * Marks a resolved issue as regressed. Returns the regression, or null when the issue is not
 * resolved (anymore), was resolved after this occurrence, or another caller already recorded it.
 */
export async function recordErrorIssueRegression(
  env: Env,
  websiteId: string,
  fingerprint: string,
  occurrence: RegressionOccurrence,
  options: { now?: number; waitUntil?: WaitUntil } = {},
): Promise<ErrorIssueRegressionRow | null> {
  const now = options.now ?? Date.now();
  // Single conditional write: D1 serializes statements, so exactly one caller claims it.
  const claimed = await env.DB.prepare(
    `UPDATE error_issue_state
     SET status = 'regressed', regressed_at = ?3, updated_at = ?3
     WHERE website_id = ?1 AND fingerprint = ?2 AND status = 'resolved'
       AND (resolved_at IS NULL OR resolved_at < ?4)
     RETURNING resolved_at AS resolvedAt`,
  )
    .bind(websiteId, fingerprint, now, occurrence.occurredAt)
    .first<{ resolvedAt: number | null }>();
  if (!claimed) return null;

  const regression: ErrorIssueRegressionRow = {
    id: crypto.randomUUID(),
    fingerprint,
    eventId: occurrence.eventId ?? null,
    release: occurrence.release ?? null,
    environment: occurrence.environment ?? null,
    resolvedAt: claimed.resolvedAt,
    occurredAt: occurrence.occurredAt,
    detectedAt: now,
    notifiedAt: null,
  };
  await env.DB.prepare(
    `INSERT INTO error_issue_regression
       (regression_id, website_id, fingerprint, event_id, release, environment, resolved_at, occurred_at, detected_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      regression.id,
      websiteId,
      fingerprint,
      regression.eventId,
      regression.release,
      regression.environment,
      regression.resolvedAt,
      regression.occurredAt,
      regression.detectedAt,
    )
    .run();

  const followUp = Promise.all([
    syncResolvedIssueIndex(env, websiteId, [fingerprint]),
    notifyRegression(env, websiteId, regression, occurrence),
  ]);
  if (options.waitUntil) options.waitUntil(followUp.catch((error) => console.error('regression follow-up failed', error)));
  else await followUp;
  return regression;
}

export async function listErrorIssueRegressions(env: Env, websiteId: string, fingerprint: string, limit = 50) {
  const rows = await env.DB.prepare(
    `SELECT regression_id as id,
            fingerprint,
            event_id as eventId,
            release,
            environment,
            resolved_at as resolvedAt,
            occurred_at as occurredAt,
            detected_at as detectedAt,
            notified_at as notifiedAt
     FROM error_issue_regression
     WHERE website_id = ?1 AND fingerprint = ?2
     ORDER BY detected_at DESC
     LIMIT ?3`,
  )
    .bind(websiteId, fingerprint, limit)
    .all<ErrorIssueRegressionRow>();
  return rows.results ?? [];
}

export type FingerprintOccurrence = {
  fingerprint: string;
  eventId: string;
  occurredAt: number;
  name: string | null;
  message: string | null;
  severity: string | null;
  release: string | null;
  environment: string | null;
};

/**
 * First (or latest) event after `since` for each raw fingerprint. Only events that carry
 * `$exception_fingerprint` (stored after grouping existed) are seen. SQLite returns the bare
 * website_event_id from the MIN/MAX(created_at) row.
 */
export async function fingerprintOccurrences(
  env: Env,
  websiteId: string,
  fingerprints: string[],
  since: number,
  which: 'first' | 'last',
) {
  if (!fingerprints.length) return new Map<string, FingerprintOccurrence>();
  const aggregate = which === 'first' ? 'MIN' : 'MAX';
  const rows = await siteDb(env, websiteId)
    .prepare(
      `WITH picked AS (
         SELECT d.string_value AS fingerprint, d.website_event_id AS eventId, ${aggregate}(d.created_at) AS occurredAt
         FROM event_data d
         WHERE d.website_id = ?1
           AND d.data_key = ?2
           AND d.created_at > ?3
           AND d.string_value IN (SELECT value FROM json_each(?4))
         GROUP BY d.string_value
       )
       SELECT f.fingerprint, f.eventId, f.occurredAt,
              MAX(CASE WHEN p.data_key IN ('name', 'errorName') THEN p.string_value END) AS name,
              MAX(CASE WHEN p.data_key = 'message' THEN p.string_value END) AS message,
              MAX(CASE WHEN p.data_key = 'severity' THEN p.string_value END) AS severity,
              MAX(CASE WHEN p.data_key = 'release' THEN p.string_value END) AS release,
              MAX(CASE WHEN p.data_key = 'environment' THEN p.string_value END) AS environment
       FROM picked f
       LEFT JOIN event_data p
         ON p.website_id = ?1
        AND p.website_event_id = f.eventId
        AND p.data_key IN ('name', 'errorName', 'message', 'severity', 'release', 'environment')
       GROUP BY f.fingerprint, f.eventId, f.occurredAt`,
    )
    .bind(websiteId, ERROR_FINGERPRINT_PROPERTY, since, JSON.stringify([...new Set(fingerprints)]))
    .all<FingerprintOccurrence>();
  return new Map((rows.results ?? []).map((row) => [row.fingerprint, row]));
}

export function occurrenceTitle(row: { name: string | null; message: string | null }) {
  const name = row.name?.trim() || 'Error';
  return row.message?.trim() ? `${name}: ${row.message.trim()}` : name;
}

/**
 * Checks every resolved issue of a website for events newer than its resolve time. Each issue
 * remembers when it was last checked, so a sweep only reads recent fingerprint rows.
 */
export async function detectErrorRegressions(
  env: Env,
  websiteId: string,
  options: { now?: number; waitUntil?: WaitUntil } = {},
) {
  const now = options.now ?? Date.now();
  const resolved = await env.DB.prepare(
    `SELECT fingerprint, resolved_at as resolvedAt, regression_checked_at as checkedAt
     FROM error_issue_state
     WHERE website_id = ?1 AND status = 'resolved'`,
  )
    .bind(websiteId)
    .all<{ fingerprint: string; resolvedAt: number | null; checkedAt: number | null }>();
  const issues = resolved.results ?? [];
  if (!issues.length) return [];

  const merges = await env.DB.prepare(
    `SELECT source_fingerprint as source, target_fingerprint as target
     FROM error_issue_merge
     WHERE website_id = ?1 AND target_fingerprint IN (SELECT value FROM json_each(?2))`,
  )
    .bind(websiteId, JSON.stringify(issues.map((issue) => issue.fingerprint)))
    .all<{ source: string; target: string }>();

  const members = new Map<string, string[]>();
  for (const issue of issues) members.set(issue.fingerprint, [issue.fingerprint]);
  for (const merge of merges.results ?? []) members.get(merge.target)?.push(merge.source);

  const lowerBound = (issue: (typeof issues)[number]) =>
    Math.max(issue.resolvedAt ?? 0, issue.checkedAt ? issue.checkedAt - SWEEP_OVERLAP_MS : 0);
  const since = Math.min(...issues.map(lowerBound));
  const firsts = await fingerprintOccurrences(env, websiteId, [...members.values()].flat(), since, 'first');

  const regressions: ErrorIssueRegressionRow[] = [];
  for (const issue of issues) {
    const bound = lowerBound(issue);
    const first = (members.get(issue.fingerprint) ?? [])
      .map((fingerprint) => firsts.get(fingerprint))
      .filter((row): row is FingerprintOccurrence => Boolean(row) && row!.occurredAt > bound)
      .sort((a, b) => a.occurredAt - b.occurredAt)[0];
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
      { now, waitUntil: options.waitUntil },
    );
    if (regression) regressions.push(regression);
  }

  await env.DB.prepare(
    `UPDATE error_issue_state SET regression_checked_at = ?2 WHERE website_id = ?1 AND status = 'resolved'`,
  )
    .bind(websiteId, now)
    .run();
  return regressions;
}

/** Hourly: walks websites with resolved issues from a persisted cursor. */
export async function runScheduledErrorRegressionChecks(
  env: Env,
  now = Date.now(),
  limit = MAX_REGRESSION_WEBSITES_PER_TICK,
) {
  const cursor = (await env.CACHE.get(REGRESSION_SCAN_CURSOR_KEY)) ?? '';
  const rows = await env.DB.prepare(
    `SELECT DISTINCT s.website_id AS websiteId
     FROM error_issue_state s
     JOIN website w ON w.website_id = s.website_id
     WHERE s.status = 'resolved' AND w.deleted_at IS NULL AND s.website_id > ?1
     ORDER BY s.website_id
     LIMIT ?2`,
  )
    .bind(cursor, limit)
    .all<{ websiteId: string }>();
  const batch = rows.results ?? [];
  await env.CACHE.put(REGRESSION_SCAN_CURSOR_KEY, batch.length === limit ? batch[batch.length - 1]!.websiteId : '');

  let regressions = 0;
  for (const { websiteId } of batch) {
    try {
      regressions += (await detectErrorRegressions(env, websiteId, { now })).length;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'error_regression_check_failed',
          websiteId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return { websites: batch.length, regressions };
}
