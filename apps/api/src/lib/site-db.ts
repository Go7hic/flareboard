import type { Env } from '../env';

/**
 * Tables that hold a website's high-volume analytics data. They are moving out of the shared D1
 * database into one SQLite Durable Object per website (see docs/parity/CONVENTIONS.md).
 * Everything else (websites, users, teams, flags, experiments, surveys, workflows, boards,
 * reports, …) stays in D1 and keeps using `env.DB`.
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
] as const;

/**
 * Database handle for one website's analytics tables (SITE_TABLES).
 *
 * Every read or write of a SITE_TABLES table must go through this handle, and a single SQL
 * statement must never join SITE_TABLES with D1-only tables (website, cohort, feature_flag, …):
 * load the D1 rows first, then pass their values as parameters. Queries across several websites
 * must call siteDb once per website and merge the results in code.
 *
 * Today this returns the shared D1 database; the storage migration swaps it for the website's
 * Durable Object without changing callers.
 */
export function siteDb(env: Env, websiteId: string): D1Database {
  void websiteId;
  return env.DB;
}
