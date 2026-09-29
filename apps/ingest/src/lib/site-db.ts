import { createSiteDatabase, eventStoreMode, siteStoreName, type SiteStoreRpc } from '@flareboard/db/site-store';
import type { Env } from '../env';

/**
 * The website's analytics tables (person, session_replay, …) as seen from ingest. Mirrors
 * apps/api/src/lib/site-db.ts: the shared D1 database until `EVENT_STORE` is `do`, then the
 * website's `EventStore` Durable Object (hosted by the API worker, bound via `script_name`).
 */
export function siteDb(env: Env, websiteId: string): D1Database {
  return eventStoreMode(env) === 'do' ? siteStoreDb(env, websiteId) : env.DB;
}

/** The website's store regardless of mode (tables that exist only there, such as OTLP logs). */
export function siteStoreDb(env: Env, websiteId: string): D1Database {
  if (!env.SITE_STORE) throw new Error('SITE_STORE binding is missing');
  const stub = env.SITE_STORE.get(env.SITE_STORE.idFromName(siteStoreName(websiteId)));
  return createSiteDatabase(stub as unknown as SiteStoreRpc, websiteId);
}

/**
 * Runs a write against every copy of the website's analytics tables: D1 (`d1`), D1 then the store
 * (`dual`, where a store failure is logged and left to the backfill), or the store (`do`).
 */
export async function writeSiteTables<T>(env: Env, websiteId: string, write: (db: D1Database) => Promise<T>): Promise<T> {
  const mode = eventStoreMode(env);
  if (mode === 'do') return write(siteStoreDb(env, websiteId));
  const result = await write(env.DB);
  if (mode === 'dual') {
    try {
      await write(siteStoreDb(env, websiteId));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'ingest_dual_write_failed',
          websiteId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return result;
}
