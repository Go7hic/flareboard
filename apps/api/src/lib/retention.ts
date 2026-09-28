import type { Env } from '../env';
import { eventStoreMode, siteDb } from './site-db';

const MAX_WEBSITES_PER_TICK = 25;
const DELETE_BATCH = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Fixed allowlist of purgeable append-only tables, child-before-parent so
// foreign keys hold. session_replay is handled by purgeReplayObjects (R2 objects first). Session rows are kept; they are small and may still be
// referenced by events that fall inside the retention window.
const PURGE_TABLES: ReadonlyArray<{ table: string; idColumn: string }> = [
  { table: 'event_data', idColumn: 'event_data_id' },
  { table: 'revenue', idColumn: 'revenue_id' },
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

  // Per-website stores purge their own heatmap dedup ids (EventStore alarm); the shared D1
  // table only exists in legacy mode.
  const storeMode = eventStoreMode(env);
  let deleted = storeMode === 'do' ? 0 : await purgeHeatmapDedup(env, now);
  for (const site of batch) {
    const cutoff = now - site.retentionDays * DAY_MS;
    deleted += await purgeReplayObjects(env, site.websiteId, cutoff);
    const db = siteDb(env, site.websiteId);
    for (const { table, idColumn } of PURGE_TABLES) {
      // In a website store, properties live on the event row and go with it.
      if (storeMode === 'do' && table === 'event_data') continue;
      const result = await db.prepare(
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

/** R2 allows at most 1000 keys per delete call. */
const REPLAY_BATCH = 1000;
const MAX_REPLAY_BATCHES_PER_SITE = 5;

/**
 * Replay chunks live in R2 (`<websiteId>/<visitId>/<chunk>`) with an index row in D1. Delete the
 * objects before their rows, or they would outlive the retention window with nothing pointing at
 * them. The summaries shown in the replay list go with them.
 */
async function purgeReplayObjects(env: Env, websiteId: string, cutoff: number) {
  const db = siteDb(env, websiteId);
  let deleted = 0;
  for (let i = 0; i < MAX_REPLAY_BATCHES_PER_SITE; i++) {
    const rows = await db.prepare(
      `SELECT visit_id AS visitId, chunk_index AS chunkIndex FROM session_replay
       WHERE website_id = ?1 AND created_at < ?2 ORDER BY rowid LIMIT ${REPLAY_BATCH}`,
    )
      .bind(websiteId, cutoff)
      .all<{ visitId: string; chunkIndex: number }>();
    const chunks = rows.results ?? [];
    if (!chunks.length) break;
    if (env.REPLAY_BUCKET) {
      await env.REPLAY_BUCKET.delete(chunks.map((row) => `${websiteId}/${row.visitId}/${row.chunkIndex}`));
    }
    const result = await db.prepare(
      `DELETE FROM session_replay WHERE rowid IN (
         SELECT rowid FROM session_replay WHERE website_id = ?1 AND created_at < ?2 ORDER BY rowid LIMIT ${REPLAY_BATCH}
       )`,
    )
      .bind(websiteId, cutoff)
      .run();
    deleted += result.meta?.changes ?? 0;
    if (chunks.length < REPLAY_BATCH) break;
  }
  const summaries = await db.prepare(
    `DELETE FROM session_replay_summary WHERE rowid IN (
       SELECT rowid FROM session_replay_summary WHERE website_id = ?1 AND started_at < ?2 LIMIT ${DELETE_BATCH}
     )`,
  )
    .bind(websiteId, cutoff)
    .run();
  return deleted + (summaries.meta?.changes ?? 0);
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
