import type { Env } from '../env';
import { resolvedIssueKvPrefix } from './error-issue-keys';
import { eventStoreMode, siteStoreStub } from './site-db';
import { sourceMapObjectPrefix } from './source-maps';

/**
 * Hard deletion behind the soft deletes in the API. Deleting a website or an account only sets
 * `deleted_at` (so support can still help with mistakes); this job erases what is left once the
 * grace period has passed. The Privacy Policy and Terms promise erasure within 30 days, so keep
 * DELETION_GRACE_DAYS in sync with them.
 */
export const DELETION_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = DELETION_GRACE_DAYS * DAY_MS;
const DELETE_BATCH = 1000;
const R2_PAGE = 1000;
const MAX_ITEMS_PER_TICK = 10;
/** Upper bound on D1/R2 calls per cron tick, shared by every purge below; the rest waits for the next tick. */
const TICK_BUDGET = 400;

type Budget = { left: number };

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(name: string) {
  if (!IDENTIFIER.test(name)) throw new Error(`Unexpected table name: ${name}`);
  return name;
}

async function exec(env: Env, budget: Budget, sql: string, ...binds: unknown[]) {
  budget.left--;
  const result = await env.DB.prepare(sql).bind(...binds).run();
  return result.meta?.changes ?? 0;
}

/** Deletes matching rows in rowid batches. Returns true once none are left, false when out of budget. */
async function drain(env: Env, budget: Budget, table: string, where: string, ...binds: unknown[]) {
  const name = assertIdentifier(table);
  while (budget.left > 0) {
    const changes = await exec(
      env,
      budget,
      `DELETE FROM ${name} WHERE rowid IN (SELECT rowid FROM ${name} WHERE ${where} LIMIT ${DELETE_BATCH})`,
      ...binds,
    );
    if (changes < DELETE_BATCH) return true;
  }
  return false;
}

/**
 * Deletes every R2 object under `prefix`: replay chunks (`<websiteId>/<visitId>/<chunk>`) and
 * source maps (`sourcemaps/<websiteId>/<id>.map`) share the bucket.
 */
async function deleteReplayObjects(env: Env, budget: Budget, prefix: string) {
  const bucket = env.REPLAY_BUCKET;
  if (!bucket) return true;
  while (budget.left > 0) {
    budget.left--;
    const page = await bucket.list({ prefix, limit: R2_PAGE });
    if (page.objects.length) {
      budget.left--;
      await bucket.delete(page.objects.map((object) => object.key));
    }
    // Listing restarts from the top each round because deleted keys are gone.
    if (!page.truncated) return true;
  }
  return false;
}

/**
 * Every table with a `website_id` column, ordered so that tables referencing another table
 * in the set come first (D1 enforces foreign keys). Discovered from the schema so new
 * website-scoped tables are erased without touching this file.
 */
export async function websiteScopedTables(env: Env): Promise<string[]> {
  const internal = `m.type = 'table' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`;
  const tables = await env.DB.prepare(
    `SELECT DISTINCT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p
     WHERE ${internal} AND m.name <> 'website' AND p.name = 'website_id'`,
  ).all<{ name: string }>();
  const edges = await env.DB.prepare(
    `SELECT m.name AS child, f."table" AS parent FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
     WHERE ${internal}`,
  ).all<{ child: string; parent: string }>();

  const remaining = new Set((tables.results ?? []).map((row) => assertIdentifier(row.name)));
  const referencedBy = new Map<string, Set<string>>();
  for (const { child, parent } of edges.results ?? []) {
    if (child === parent || !remaining.has(child) || !remaining.has(parent)) continue;
    if (!referencedBy.has(parent)) referencedBy.set(parent, new Set());
    referencedBy.get(parent)!.add(child);
  }

  const ordered: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((table) => ![...(referencedBy.get(table) ?? [])].some((c) => remaining.has(c)));
    // A cycle would be a schema bug; fall back to the remaining tables in name order.
    const batch = ready.length ? ready.sort() : [...remaining].sort();
    for (const table of batch) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

/** Deletes the website's KV index of resolved error issues (`error-resolved:<websiteId>:*`). */
async function deleteResolvedIssueKeys(env: Env, budget: Budget, websiteId: string) {
  const prefix = resolvedIssueKvPrefix(websiteId);
  while (budget.left > 0) {
    budget.left--;
    const page = await env.CACHE.list({ prefix, limit: R2_PAGE });
    if (page.keys.length) {
      budget.left -= page.keys.length;
      await Promise.all(page.keys.map((key) => env.CACHE.delete(key.name)));
    }
    if (page.list_complete) return true;
  }
  return false;
}

async function purgeWebsite(env: Env, budget: Budget, websiteId: string, tables: string[]) {
  if (!(await deleteReplayObjects(env, budget, `${websiteId}/`))) return false;
  if (!(await deleteReplayObjects(env, budget, sourceMapObjectPrefix(websiteId)))) return false;
  if (!(await deleteResolvedIssueKeys(env, budget, websiteId))) return false;
  if (eventStoreMode(env) !== 'd1') {
    // Analytics rows live in the website's own store: erase it in one call.
    budget.left--;
    await siteStoreStub(env, websiteId).erase();
  }
  for (const table of tables) {
    // SITE_TABLES left in D1 (legacy or dual mode) and D1 config tables with a website_id.
    if (!(await drain(env, budget, table, 'website_id = ?1', websiteId))) return false;
  }
  if (!(await drain(env, budget, 'share', 'entity_id = ?1', websiteId))) return false;
  if (!(await drain(env, budget, 'audit_log', "entity_type = 'website' AND entity_id = ?1", websiteId))) return false;
  // History of website-scoped entities (feature flag changes, …) names its website in the metadata.
  const scopedHistory = `entity_type <> 'website' AND CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.websiteId') END = ?1`;
  if (!(await drain(env, budget, 'audit_log', scopedHistory, websiteId))) return false;
  if (budget.left <= 0) return false;
  await exec(env, budget, 'DELETE FROM website WHERE website_id = ?1', websiteId);
  await Promise.all([env.CACHE.delete(`website:${websiteId}`), env.CACHE.delete(`tracker-config:${websiteId}`)]);
  return true;
}

/** Links, pixels and boards that leave with the account: personal ones and those of deleted teams. */
const OWNED_BY_USER = `user_id = ?1 AND (team_id IS NULL OR team_id IN (SELECT team_id FROM team WHERE deleted_at IS NOT NULL))`;

/** Rows that cannot exist without the user (NOT NULL user_id). */
const USER_OWNED_TABLES = [
  // Messages reference their conversation: erase them first.
  'ai_message',
  'ai_conversation',
  'ai_usage_daily',
  'annotation',
  'insight',
  'personal_api_key',
  'report',
  'usage_monthly',
  'user_oauth_identity',
  'user_subscription',
  'team_user',
  'audit_log',
] as const;

/** Shared team content that survives with the author cleared (nullable references). */
const USER_REFERENCES: ReadonlyArray<[table: string, column: string]> = [
  ['board', 'user_id'],
  ['link', 'user_id'],
  ['pixel', 'user_id'],
  ['error_issue_comment', 'user_id'],
  ['error_issue_merge', 'merged_by'],
  ['error_issue_state', 'assignee_user_id'],
  ['log_saved_filter', 'user_id'],
  ['warehouse_data_source', 'user_id'],
  ['warehouse_query_history', 'user_id'],
  ['warehouse_saved_query', 'user_id'],
  ['warehouse_scheduled_query', 'user_id'],
  ['website', 'user_id'],
  ['website', 'created_by'],
];

async function purgeUser(env: Env, budget: Budget, userId: string) {
  // Personal websites are erased by purgeWebsite first (they were soft-deleted with the account).
  budget.left--;
  const personalSite = await env.DB.prepare('SELECT 1 AS found FROM website WHERE user_id = ?1 AND team_id IS NULL LIMIT 1')
    .bind(userId)
    .first();
  if (personalSite) return false;

  const hitSources = `(source_type = 'link' AND source_id IN (SELECT link_id FROM link WHERE ${OWNED_BY_USER}))
    OR (source_type = 'pixel' AND source_id IN (SELECT pixel_id FROM pixel WHERE ${OWNED_BY_USER}))`;
  if (!(await drain(env, budget, 'link_pixel_hit', hitSources, userId))) return false;
  if (!(await drain(env, budget, 'share', `entity_id IN (SELECT board_id FROM board WHERE ${OWNED_BY_USER})`, userId))) {
    return false;
  }
  for (const table of ['link', 'pixel', 'board']) {
    if (!(await drain(env, budget, table, OWNED_BY_USER, userId))) return false;
  }
  for (const table of USER_OWNED_TABLES) {
    if (!(await drain(env, budget, table, 'user_id = ?1', userId))) return false;
  }
  for (const [table, column] of USER_REFERENCES) {
    if (budget.left <= 0) return false;
    await exec(env, budget, `UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?1`, userId);
  }
  if (budget.left <= 0) return false;
  await exec(env, budget, 'DELETE FROM user WHERE user_id = ?1', userId);
  await env.CACHE.delete(`token-version:${userId}`);
  return true;
}

/**
 * Erases websites and accounts deleted more than DELETION_GRACE_DAYS ago, and failed queue
 * payloads older than that. Idempotent and bounded per tick; unfinished work resumes next run.
 */
export async function runDataDeletion(env: Env, now = Date.now()) {
  const budget: Budget = { left: TICK_BUDGET };
  const cutoff = now - GRACE_MS;
  const tables = await websiteScopedTables(env);
  budget.left -= 2;

  // Accounts deleted by an admin keep live personal websites; they leave with the account.
  await exec(
    env,
    budget,
    `UPDATE website
     SET deleted_at = (SELECT u.deleted_at FROM user u WHERE u.user_id = website.user_id), updated_at = ?1
     WHERE deleted_at IS NULL AND team_id IS NULL
       AND user_id IN (SELECT user_id FROM user WHERE deleted_at IS NOT NULL AND deleted_at < ?2)`,
    now,
    cutoff,
  );

  let websites = 0;
  const dueSites = await env.DB.prepare(
    `SELECT website_id AS id FROM website WHERE deleted_at IS NOT NULL AND deleted_at < ?1
     ORDER BY deleted_at LIMIT ${MAX_ITEMS_PER_TICK}`,
  )
    .bind(cutoff)
    .all<{ id: string }>();
  budget.left--;
  for (const { id } of dueSites.results ?? []) {
    if (!(await purgeWebsite(env, budget, id, tables))) break;
    websites++;
  }

  let users = 0;
  const dueUsers = await env.DB.prepare(
    `SELECT user_id AS id FROM user WHERE deleted_at IS NOT NULL AND deleted_at < ?1
     ORDER BY deleted_at LIMIT ${MAX_ITEMS_PER_TICK}`,
  )
    .bind(cutoff)
    .all<{ id: string }>();
  budget.left--;
  for (const { id } of dueUsers.results ?? []) {
    if (budget.left <= 0) break;
    if (await purgeUser(env, budget, id)) users++;
  }

  const deadEventsDone = budget.left > 0 && (await drain(env, budget, 'dead_event', 'created_at < ?1', cutoff));

  const summary = { websites, users, deadEventsDone, budgetLeft: Math.max(0, budget.left) };
  console.log(JSON.stringify({ event: 'data_deletion_complete', ...summary }));
  return summary;
}
