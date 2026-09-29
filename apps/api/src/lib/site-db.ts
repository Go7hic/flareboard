import type { Env } from '../env';
import { createSiteDatabase, eventStoreMode, siteStoreName } from '@flareboard/db/site-store';
import type { EventStore } from '../store/event-store';

/**
 * Tables that hold a website's high-volume analytics data. They live in one SQLite Durable
 * Object per website (apps/api/src/store) instead of the shared D1 database. Everything else
 * (websites, users, teams, flags, experiments, surveys, workflows, boards, reports, …) stays in
 * D1 and keeps using `env.DB`.
 */
export const SITE_TABLES = [
  'website_event',
  'event_data',
  'session',
  'session_data',
  'revenue',
  'session_replay',
  'session_replay_summary',
  'heatmap_cell',
  'heatmap_ingest_dedup',
  'rollup_stats_daily',
  'rollup_pageview_series',
  'rollup_series_bucket',
  'rollup_dimension_daily',
  'rollup_event_daily',
  'rollup_session_day',
  'person',
  'person_group_membership',
  'warehouse_import',
  'stripe_customer',
  'stripe_charge',
  'stripe_refund',
  'stripe_invoice',
  'stripe_invoice_line',
  'stripe_subscription',
] as const;

export { eventStoreMode, type EventStoreMode } from '@flareboard/db/site-store';

export function siteStoreStub(env: Env, websiteId: string): DurableObjectStub<EventStore> {
  if (!env.SITE_STORE) throw new Error('SITE_STORE binding is missing');
  return env.SITE_STORE.get(env.SITE_STORE.idFromName(siteStoreName(websiteId)));
}

/**
 * Database handle for one website's analytics tables (SITE_TABLES).
 *
 * Every read or write of a SITE_TABLES table must go through this handle, and a single SQL
 * statement must never join SITE_TABLES with D1-only tables (website, cohort, feature_flag, …):
 * load the D1 rows first, then pass their values as parameters. Queries across several websites
 * call siteDb once per website and merge the results in code.
 */
export function siteDb(env: Env, websiteId: string): D1Database {
  if (eventStoreMode(env) !== 'do') return env.DB;
  return createSiteDatabase(siteStoreStub(env, websiteId), websiteId);
}

/** The Durable Object handle regardless of mode (backfill, dual writes, deletion). */
export function siteStoreDb(env: Env, websiteId: string): D1Database {
  return createSiteDatabase(siteStoreStub(env, websiteId), websiteId);
}
