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
const RETENTION_CURSOR_KEY = 'cron:retention-cursor';
/** Heatmap dedup ids only need to outlive queue redelivery (retries span minutes to hours). */
const HEATMAP_DEDUP_TTL_MS = 2 * DAY_MS;
const MAX_DEDUP_BATCHES_PER_TICK = 10;

export async function runRetentionPurge(env: Env, now = Date.now()) {
  // Walk sites from a persisted cursor: a plain LIMIT kept re-purging the same first sites.
  const cursor = (await env.CACHE.get(RETENTION_CURSOR_KEY)) ?? '';
  const sites = await env.DB.prepare(
    `SELECT website_id as websiteId, retention_days as retentionDays
     FROM website
     WHERE retention_days IS NOT NULL AND retention_days > 0 AND deleted_at IS NULL
       AND website_id > ?1
     ORDER BY website_id
     LIMIT ${MAX_WEBSITES_PER_TICK}`,
  )
    .bind(cursor)
    .all<{ websiteId: string; retentionDays: number }>();
  const batch = sites.results ?? [];
  await env.CACHE.put(
    RETENTION_CURSOR_KEY,
    batch.length === MAX_WEBSITES_PER_TICK ? batch[batch.length - 1]!.websiteId : '',
  );

  let deleted = await purgeHeatmapDedup(env, now);
  for (const site of batch) {
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
      websites: batch.length,
      deleted,
    }),
  );
  return { websites: batch.length, deleted };
}

async function purgeHeatmapDedup(env: Env, now: number) {
  let deleted = 0;
  for (let i = 0; i < MAX_DEDUP_BATCHES_PER_TICK; i++) {
    const result = await env.DB.prepare(
      `DELETE FROM heatmap_ingest_dedup
       WHERE id IN (SELECT id FROM heatmap_ingest_dedup WHERE created_at < ?1 LIMIT ${DELETE_BATCH})`,
    )
      .bind(now - HEATMAP_DEDUP_TTL_MS)
      .run();
    const changes = result.meta?.changes ?? 0;
    deleted += changes;
    if (changes < DELETE_BATCH) break;
  }
  return deleted;
}
