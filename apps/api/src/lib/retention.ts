import type { Env } from '../env';

const MAX_WEBSITES_PER_TICK = 25;
const DELETE_BATCH = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Fixed allowlist of purgeable append-only tables, child-before-parent so
// foreign keys hold. Session rows are kept; they are small and may still be
// referenced by events that fall inside the retention window.
const PURGE_TABLES: ReadonlyArray<{ table: string; idColumn: string }> = [
  { table: 'event_data', idColumn: 'event_data_id' },
  { table: 'revenue', idColumn: 'revenue_id' },
  { table: 'session_replay', idColumn: 'replay_id' },
  { table: 'session_data', idColumn: 'session_data_id' },
  { table: 'website_event', idColumn: 'event_id' },
];

/**
 * Deletes raw event data older than each website's opt-in retention window.
 * Disabled unless `website.retention_days` is set. Work is bounded per tick so
 * a cron invocation cannot exceed Worker limits; the rest is picked up next run.
 */
export async function runRetentionPurge(env: Env, now = Date.now()) {
  const sites = await env.DB.prepare(
    `SELECT website_id as websiteId, retention_days as retentionDays
     FROM website
     WHERE retention_days IS NOT NULL AND retention_days > 0 AND deleted_at IS NULL
     ORDER BY website_id
     LIMIT ${MAX_WEBSITES_PER_TICK}`,
  ).all<{ websiteId: string; retentionDays: number }>();

  let deleted = 0;
  for (const site of sites.results ?? []) {
    const cutoff = now - site.retentionDays * DAY_MS;
    for (const { table, idColumn } of PURGE_TABLES) {
      const result = await env.DB.prepare(
        `DELETE FROM ${table}
         WHERE ${idColumn} IN (
           SELECT ${idColumn} FROM ${table}
           WHERE website_id = ?1 AND created_at < ?2
           LIMIT ${DELETE_BATCH}
         )`,
      )
        .bind(site.websiteId, cutoff)
        .run();
      deleted += result.meta?.changes ?? 0;
    }
  }

  console.log(
    JSON.stringify({
      event: 'retention_purge_complete',
      websites: sites.results?.length ?? 0,
      deleted,
    }),
  );
  return { websites: sites.results?.length ?? 0, deleted };
}
