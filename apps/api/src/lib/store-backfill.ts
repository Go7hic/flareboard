import type { Env } from '../env';
import { siteStoreDb, siteStoreStub } from './site-db';

/**
 * Copies a website's analytics history from the shared D1 database into its store (the
 * `dual` phase of docs/parity/storage-migration.md). Resumable: progress per website is kept in
 * KV and every copy is idempotent, so running it again only fills gaps.
 */

type MergeRule =
  /** keep the store row if it already exists (immutable rows: events, sessions, …) */
  | 'ignore'
  /** D1 is authoritative until cutover (mutable rows: people, imports) */
  | 'replace'
  /** counters: keep the larger count (heatmap cells written by D1 and later by the store) */
  | 'max-count';

type CopySpec = { table: string; merge: MergeRule; conflict?: string };

/** Order matters only for readability; the store has no foreign keys. */
export const BACKFILL_TABLES: ReadonlyArray<CopySpec> = [
  { table: 'session', merge: 'ignore' },
  { table: 'website_event', merge: 'ignore' },
  { table: 'session_data', merge: 'ignore' },
  { table: 'revenue', merge: 'ignore' },
  { table: 'session_replay', merge: 'ignore' },
  { table: 'person', merge: 'replace' },
  { table: 'person_group_membership', merge: 'replace' },
  { table: 'warehouse_import', merge: 'replace' },
  {
    table: 'heatmap_cell',
    merge: 'max-count',
    conflict: 'website_id, url_path, day, kind, norm_x, norm_y, device_class',
  },
];

const CHUNK_ROWS = 200;

export type BackfillState = {
  tableIndex: number;
  cursor: number;
  copied: Record<string, number>;
  done: boolean;
  rollupsRebuiltAt: number | null;
  updatedAt: number;
};

const stateKey = (websiteId: string) => `store-backfill:${websiteId}`;

export async function getBackfillState(env: Env, websiteId: string): Promise<BackfillState> {
  const raw = await env.CACHE.get(stateKey(websiteId));
  if (raw) {
    try {
      return JSON.parse(raw) as BackfillState;
    } catch {
      /* start over */
    }
  }
  return { tableIndex: 0, cursor: 0, copied: {}, done: false, rollupsRebuiltAt: null, updatedAt: 0 };
}

async function saveBackfillState(env: Env, websiteId: string, state: BackfillState) {
  state.updatedAt = Date.now();
  await env.CACHE.put(stateKey(websiteId), JSON.stringify(state));
}

/** Reads one chunk from D1. Events carry their event_data rows folded into `properties`. */
async function readChunk(env: Env, spec: CopySpec, websiteId: string, cursor: number) {
  const select =
    spec.table === 'website_event'
      ? `SELECT e.rowid AS _rid, e.*,
                (SELECT json_group_object(
                   d.data_key,
                   CASE d.data_type
                     WHEN 2 THEN d.number_value
                     WHEN 3 THEN json(CASE WHEN d.string_value = 'true' THEN 'true' ELSE 'false' END)
                     ELSE d.string_value
                   END)
                 FROM event_data d WHERE d.website_event_id = e.event_id) AS properties
         FROM website_event e
         WHERE e.website_id = ?1 AND e.rowid > ?2
         ORDER BY e.rowid LIMIT ?3`
      : `SELECT rowid AS _rid, * FROM ${spec.table}
         WHERE website_id = ?1 AND rowid > ?2
         ORDER BY rowid LIMIT ?3`;
  const { results } = await env.DB.prepare(select).bind(websiteId, cursor, CHUNK_ROWS).all<Record<string, unknown>>();
  return results ?? [];
}

function insertSql(spec: CopySpec, columns: string[]) {
  const list = columns.join(', ');
  const values = columns.map((_, i) => `?${i + 1}`).join(', ');
  if (spec.merge === 'ignore') return `INSERT OR IGNORE INTO ${spec.table} (${list}) VALUES (${values})`;
  if (spec.merge === 'replace') return `INSERT OR REPLACE INTO ${spec.table} (${list}) VALUES (${values})`;
  return `INSERT INTO ${spec.table} (${list}) VALUES (${values})
          ON CONFLICT(${spec.conflict}) DO UPDATE SET
            count = MAX(count, excluded.count),
            viewport_w = MAX(viewport_w, excluded.viewport_w),
            viewport_h = MAX(viewport_h, excluded.viewport_h)`;
}

/**
 * Copies up to `maxChunks` chunks for one website. When every table is copied it rebuilds the
 * store's rollups from the copied events. Returns the updated state.
 */
export async function backfillWebsite(env: Env, websiteId: string, maxChunks = 25): Promise<BackfillState> {
  const state = await getBackfillState(env, websiteId);
  if (state.done) return state;
  const store = siteStoreDb(env, websiteId);

  let chunks = 0;
  while (chunks < maxChunks && state.tableIndex < BACKFILL_TABLES.length) {
    const spec = BACKFILL_TABLES[state.tableIndex]!;
    const rows = await readChunk(env, spec, websiteId, state.cursor);
    chunks++;
    if (rows.length) {
      const columns = Object.keys(rows[0]!).filter((column) => column !== '_rid');
      const sql = insertSql(spec, columns);
      await store.batch(rows.map((row) => store.prepare(sql).bind(...columns.map((column) => row[column]))));
      state.cursor = Number(rows[rows.length - 1]!._rid);
      state.copied[spec.table] = (state.copied[spec.table] ?? 0) + rows.length;
    }
    if (rows.length < CHUNK_ROWS) {
      state.tableIndex++;
      state.cursor = 0;
    }
    await saveBackfillState(env, websiteId, state);
  }

  if (state.tableIndex >= BACKFILL_TABLES.length) {
    await siteStoreStub(env, websiteId).rebuildRollups(websiteId);
    state.done = true;
    state.rollupsRebuiltAt = Date.now();
    await saveBackfillState(env, websiteId, state);
  }
  return state;
}

/** Starts a website over (for example after a failed verification). */
export async function resetBackfill(env: Env, websiteId: string) {
  await env.CACHE.delete(stateKey(websiteId));
}

/** Row counts per table in D1 and in the store; equal counts mean the copy is complete. */
export async function verifyWebsiteStore(env: Env, websiteId: string) {
  const store = siteStoreDb(env, websiteId);
  const tables: Array<{ table: string; d1: number; store: number }> = [];
  for (const { table } of BACKFILL_TABLES) {
    const d1 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE website_id = ?1`).bind(websiteId).first<number>('n');
    const inStore = await store.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE website_id = ?1`).bind(websiteId).first<number>('n');
    tables.push({ table, d1: d1 ?? 0, store: inStore ?? 0 });
  }
  const d1Properties = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_data WHERE website_id = ?1`).bind(websiteId).first<number>('n');
  const storeProperties = await store
    .prepare(`SELECT COUNT(*) AS n FROM event_data WHERE website_id = ?1`)
    .bind(websiteId)
    .first<number>('n');
  tables.push({ table: 'event_data', d1: d1Properties ?? 0, store: storeProperties ?? 0 });
  // The store may hold more rows than D1 (events written only to the store during `dual`).
  return { websiteId, complete: tables.every((row) => row.store >= row.d1), tables };
}

const SITES_PER_TICK = 5;
const CURSOR_KEY = 'store-backfill:cursor';

/** Cron step during the `dual` phase: advances a few websites per tick. */
export async function runStoreBackfill(env: Env) {
  const cursor = (await env.CACHE.get(CURSOR_KEY)) ?? '';
  const { results } = await env.DB.prepare(
    `SELECT website_id AS id FROM website WHERE deleted_at IS NULL AND website_id > ?1 ORDER BY website_id LIMIT ${SITES_PER_TICK}`,
  )
    .bind(cursor)
    .all<{ id: string }>();
  const sites = results ?? [];
  let advanced = 0;
  for (const { id } of sites) {
    const state = await backfillWebsite(env, id);
    if (!state.done) advanced++;
  }
  await env.CACHE.put(CURSOR_KEY, sites.length === SITES_PER_TICK ? sites[sites.length - 1]!.id : '');
  console.log(JSON.stringify({ event: 'store_backfill_tick', websites: sites.length, inProgress: advanced }));
  return { websites: sites.length, inProgress: advanced };
}
