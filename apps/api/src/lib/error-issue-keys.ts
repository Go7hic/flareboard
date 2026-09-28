import { messageFingerprint } from '@flareboard/shared';
import type { Env } from '../env';

/**
 * Issue identity for error tracking.
 *
 * - Events carry `$exception_fingerprint` (computed at ingest). Events stored before that property
 *   existed are grouped by the normalized-message fingerprint of their name and message.
 * - Merging issue B into A stores B -> A in `error_issue_merge`; queries map fingerprints through
 *   it, so B's past and future events show up under A. Chains are flattened on write, so one
 *   lookup always yields the canonical fingerprint.
 * - Issue state and comments written before stack fingerprints were keyed by `name|message`.
 *   Those legacy keys are rekeyed here (see migration 0048).
 * - KV holds `error-resolved:<websiteId>:<fingerprint>` for every fingerprint whose issue is
 *   resolved, so ingest can spot a regression without a D1 read per error event.
 */

export type ErrorIssueStatus = 'open' | 'resolved' | 'ignored' | 'regressed';

export type ErrorIssueMergeRow = {
  sourceFingerprint: string;
  targetFingerprint: string;
  sourceName: string | null;
  sourceMessage: string | null;
  mergedBy: string | null;
  createdAt: number | null;
};

const LEGACY_EVENT_KEY_PREFIX = 'legacy:';
export const RESOLVED_ISSUE_KV_PREFIX = 'error-resolved:';

export function resolvedIssueKvPrefix(websiteId: string) {
  return `${RESOLVED_ISSUE_KV_PREFIX}${websiteId}:`;
}

export function resolvedIssueKvKey(websiteId: string, fingerprint: string) {
  return `${resolvedIssueKvPrefix(websiteId)}${fingerprint}`;
}

/** Issue keys written before stack fingerprints: `name|message`. */
export function isLegacyIssueKey(key: string) {
  return key.includes('|');
}

function splitLegacyKey(key: string): [string, string] {
  const index = key.indexOf('|');
  return index < 0 ? ['Error', key] : [key.slice(0, index), key.slice(index + 1)];
}

/** Fingerprint of a legacy `name|message` issue key. */
export function legacyIssueKeyFingerprint(key: string) {
  const [name, message] = splitLegacyKey(key);
  return messageFingerprint(name, message);
}

/**
 * SQL expression for an event's issue key inside the error CTEs: the stored fingerprint, or
 * `legacy:<name>|<message>` for events stored before fingerprints (mapped in code).
 */
export const EVENT_ISSUE_KEY_SQL = `COALESCE(props.fingerprint, '${LEGACY_EVENT_KEY_PREFIX}' || COALESCE(props.name, 'Error') || '|' || COALESCE(props.message, e.event_name, 'Unknown error'))`;

export function isLegacyEventKey(key: string) {
  return key.startsWith(LEGACY_EVENT_KEY_PREFIX);
}

/** Fingerprint for an event issue key returned by EVENT_ISSUE_KEY_SQL. */
export function eventKeyFingerprint(key: string) {
  return isLegacyEventKey(key) ? legacyIssueKeyFingerprint(key.slice(LEGACY_EVENT_KEY_PREFIX.length)) : key;
}

/** source fingerprint -> canonical (target) fingerprint for every merged issue of a website. */
export async function loadIssueMerges(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `SELECT source_fingerprint as source, target_fingerprint as target
     FROM error_issue_merge
     WHERE website_id = ?1`,
  )
    .bind(websiteId)
    .all<{ source: string; target: string }>();
  return new Map((rows.results ?? []).map((row) => [row.source, row.target]));
}

export async function listIssueMergesInto(env: Env, websiteId: string, target: string) {
  const rows = await env.DB.prepare(
    `SELECT source_fingerprint as sourceFingerprint,
            target_fingerprint as targetFingerprint,
            source_name as sourceName,
            source_message as sourceMessage,
            merged_by as mergedBy,
            created_at as createdAt
     FROM error_issue_merge
     WHERE website_id = ?1 AND target_fingerprint = ?2
     ORDER BY created_at DESC`,
  )
    .bind(websiteId, target)
    .all<ErrorIssueMergeRow>();
  return rows.results ?? [];
}

async function mergeTargetOf(env: Env, websiteId: string, fingerprint: string) {
  const row = await env.DB.prepare(
    `SELECT target_fingerprint as target FROM error_issue_merge WHERE website_id = ?1 AND source_fingerprint = ?2`,
  )
    .bind(websiteId, fingerprint)
    .first<{ target: string }>();
  return row?.target ?? null;
}

/** Client-supplied issue fingerprint -> canonical fingerprint (legacy keys converted, merges followed). */
export async function resolveIssueFingerprint(env: Env, websiteId: string, fingerprint: string) {
  const current = isLegacyIssueKey(fingerprint) ? legacyIssueKeyFingerprint(fingerprint) : fingerprint;
  return (await mergeTargetOf(env, websiteId, current)) ?? current;
}

type LegacyStateRow = {
  fingerprint: string;
  status: string;
  note: string | null;
  assigneeUserId: string | null;
  resolvedAt: number | null;
  regressedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
};

const STATE_COLUMNS = `fingerprint,
       status,
       note,
       assignee_user_id as assigneeUserId,
       resolved_at as resolvedAt,
       regressed_at as regressedAt,
       created_at as createdAt,
       updated_at as updatedAt`;

function lastTouched(row: LegacyStateRow) {
  return row.updatedAt ?? row.createdAt ?? 0;
}

/**
 * Rekeys issue state and comments stored under legacy `name|message` fingerprints to the
 * normalized-message fingerprint their events now group under. Several legacy keys can land on
 * one issue (that is the point of normalizing): the most recently updated state wins, the
 * earliest created_at is kept, and every comment moves over. Runs as one D1 batch.
 */
export async function migrateLegacyErrorIssueKeys(env: Env, websiteId: string) {
  const [stateRows, commentRows] = await Promise.all([
    env.DB.prepare(
      `SELECT ${STATE_COLUMNS} FROM error_issue_state WHERE website_id = ?1 AND instr(fingerprint, '|') > 0`,
    )
      .bind(websiteId)
      .all<LegacyStateRow>(),
    env.DB.prepare(
      `SELECT DISTINCT fingerprint FROM error_issue_comment WHERE website_id = ?1 AND instr(fingerprint, '|') > 0`,
    )
      .bind(websiteId)
      .all<{ fingerprint: string }>(),
  ]);
  const legacyStates = stateRows.results ?? [];
  const legacyCommentKeys = (commentRows.results ?? []).map((row) => row.fingerprint);
  if (!legacyStates.length && !legacyCommentKeys.length) return { states: 0, comments: 0, resolved: [] as string[] };

  const byFingerprint = new Map<string, LegacyStateRow[]>();
  for (const row of legacyStates) {
    const fingerprint = legacyIssueKeyFingerprint(row.fingerprint);
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), row]);
  }

  const statements: D1PreparedStatement[] = [];
  const resolved: string[] = [];
  for (const [fingerprint, rows] of byFingerprint) {
    const existing = await env.DB.prepare(
      `SELECT ${STATE_COLUMNS} FROM error_issue_state WHERE website_id = ?1 AND fingerprint = ?2`,
    )
      .bind(websiteId, fingerprint)
      .first<LegacyStateRow>();
    const candidates = existing ? [existing, ...rows] : rows;
    // Stable winner: latest update, then the already-migrated row, then key order.
    const winner = [...candidates].sort(
      (a, b) =>
        lastTouched(b) - lastTouched(a) ||
        Number(b === existing) - Number(a === existing) ||
        a.fingerprint.localeCompare(b.fingerprint),
    )[0]!;
    const createdAt = Math.min(...candidates.map((row) => row.createdAt ?? row.updatedAt ?? Date.now()));
    const updatedAt = Math.max(...candidates.map(lastTouched));
    const resolvedAt = winner.status === 'resolved' ? (winner.resolvedAt ?? winner.updatedAt ?? updatedAt) : winner.resolvedAt;
    if (winner.status === 'resolved') resolved.push(fingerprint);

    statements.push(
      env.DB.prepare(
        `INSERT INTO error_issue_state
           (website_id, fingerprint, status, note, assignee_user_id, resolved_at, regressed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(website_id, fingerprint)
         DO UPDATE SET status = excluded.status,
                       note = excluded.note,
                       assignee_user_id = excluded.assignee_user_id,
                       resolved_at = excluded.resolved_at,
                       regressed_at = excluded.regressed_at,
                       created_at = excluded.created_at,
                       updated_at = excluded.updated_at`,
      ).bind(
        websiteId,
        fingerprint,
        winner.status,
        winner.note,
        winner.assigneeUserId,
        resolvedAt,
        winner.regressedAt,
        createdAt,
        updatedAt,
      ),
    );
    for (const row of rows) {
      statements.push(
        env.DB.prepare(`DELETE FROM error_issue_state WHERE website_id = ?1 AND fingerprint = ?2`).bind(
          websiteId,
          row.fingerprint,
        ),
      );
    }
  }

  for (const key of legacyCommentKeys) {
    statements.push(
      env.DB.prepare(`UPDATE error_issue_comment SET fingerprint = ?3 WHERE website_id = ?1 AND fingerprint = ?2`).bind(
        websiteId,
        key,
        legacyIssueKeyFingerprint(key),
      ),
    );
  }

  await env.DB.batch(statements);
  if (resolved.length) await syncResolvedIssueIndex(env, websiteId, resolved);
  return { states: legacyStates.length, comments: legacyCommentKeys.length, resolved };
}

// Websites whose legacy keys are known to be gone in this isolate. New legacy keys are never
// written (handlers resolve incoming fingerprints first), so the check only has to pass once.
const migratedWebsites = new Set<string>();

/** Rekeys legacy issue state for a website before its issues are read or written. */
export async function ensureErrorIssueKeysMigrated(env: Env, websiteId: string) {
  if (migratedWebsites.has(websiteId)) return;
  const legacy = await env.DB.prepare(
    `SELECT 1 AS found FROM error_issue_state WHERE website_id = ?1 AND instr(fingerprint, '|') > 0
     UNION ALL
     SELECT 1 AS found FROM error_issue_comment WHERE website_id = ?1 AND instr(fingerprint, '|') > 0
     LIMIT 1`,
  )
    .bind(websiteId)
    .first<{ found: number }>();
  if (legacy) await migrateLegacyErrorIssueKeys(env, websiteId);
  migratedWebsites.add(websiteId);
}

/** Cron sweep for websites nobody opened since the upgrade. Bounded per tick. */
export async function migrateLegacyErrorIssueKeysBatch(env: Env, limit = 20) {
  const rows = await env.DB.prepare(
    `SELECT website_id AS websiteId FROM error_issue_state WHERE instr(fingerprint, '|') > 0
     UNION
     SELECT website_id AS websiteId FROM error_issue_comment WHERE instr(fingerprint, '|') > 0
     LIMIT ?1`,
  )
    .bind(limit)
    .all<{ websiteId: string }>();
  let websites = 0;
  for (const { websiteId } of rows.results ?? []) {
    await migrateLegacyErrorIssueKeys(env, websiteId);
    websites++;
  }
  return { websites };
}

/**
 * Brings the KV regression index in line with D1 for the given canonical fingerprints: every
 * fingerprint of a resolved issue (its own and those merged into it) maps to the issue and its
 * resolve time, everything else is removed.
 */
export async function syncResolvedIssueIndex(env: Env, websiteId: string, fingerprints: string[]) {
  const unique = [...new Set(fingerprints)];
  if (!unique.length) return;
  const json = JSON.stringify(unique);
  const [states, merges] = await Promise.all([
    env.DB.prepare(
      `SELECT fingerprint, status, resolved_at as resolvedAt
       FROM error_issue_state
       WHERE website_id = ?1 AND fingerprint IN (SELECT value FROM json_each(?2))`,
    )
      .bind(websiteId, json)
      .all<{ fingerprint: string; status: string; resolvedAt: number | null }>(),
    env.DB.prepare(
      `SELECT source_fingerprint as source, target_fingerprint as target
       FROM error_issue_merge
       WHERE website_id = ?1 AND target_fingerprint IN (SELECT value FROM json_each(?2))`,
    )
      .bind(websiteId, json)
      .all<{ source: string; target: string }>(),
  ]);
  const stateByFingerprint = new Map((states.results ?? []).map((row) => [row.fingerprint, row]));
  const writes: Promise<unknown>[] = [];
  for (const fingerprint of unique) {
    const state = stateByFingerprint.get(fingerprint);
    const members = [fingerprint, ...(merges.results ?? []).filter((row) => row.target === fingerprint).map((row) => row.source)];
    for (const member of members) {
      const key = resolvedIssueKvKey(websiteId, member);
      if (state?.status === 'resolved') {
        writes.push(env.CACHE.put(key, JSON.stringify({ issue: fingerprint, resolvedAt: state.resolvedAt ?? 0 })));
      } else {
        writes.push(env.CACHE.delete(key));
      }
    }
  }
  await Promise.all(writes);
}
