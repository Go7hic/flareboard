import type { Env } from '../env';
import { migrateLegacyErrorIssueKeysBatch } from './error-issue-keys';
import { runScheduledErrorRegressionChecks } from './error-regressions';
import { evaluateErrorAlertRules } from './errors';
import { runScheduledEmailReports } from './email-reports';
import { evaluateLogAlertRules } from './logs';
import { runRetentionPurge } from './retention';
import { runDueWarehouseScheduledQueries, runDueWarehouseDataSourceSyncs } from './warehouse';
import { runDataDeletion } from './data-deletion';
import { migrateInlineSourceMapsToR2 } from './source-maps';

// Caps how many websites a single cron tick processes so one invocation
// cannot blow past Worker CPU/subrequest limits; later ticks continue from a cursor.
const MAX_ALERT_WEBSITES_PER_TICK = 100;
const MAX_WAREHOUSE_WEBSITES_PER_TICK = 50;

const ALERT_SCAN_CURSOR_KEY = 'cron:alert-scan-cursor';

export async function runScheduledAlertChecks(
  env: Env,
  now = Date.now(),
  limit = MAX_ALERT_WEBSITES_PER_TICK,
) {
  // Only visit websites that actually have enabled alert rules, walking them in id
  // order from a persisted cursor so every site is reached across ticks (a bare
  // LIMIT always returned the same first sites).
  const cursor = (await env.CACHE.get(ALERT_SCAN_CURSOR_KEY)) ?? '';
  const rows = await env.DB.prepare(
    `SELECT DISTINCT w.website_id as websiteId
     FROM website w
     JOIN (
       SELECT website_id FROM error_alert_rule WHERE enabled = 1
       UNION
       SELECT website_id FROM log_alert_rule WHERE enabled = 1
     ) rules ON rules.website_id = w.website_id
     WHERE w.deleted_at IS NULL AND w.website_id > ?1
     ORDER BY w.website_id
     LIMIT ?2`,
  )
    .bind(cursor, limit)
    .all<{ websiteId: string }>();
  const batch = rows.results ?? [];
  // A short page means the end was reached: start from the beginning next tick.
  await env.CACHE.put(ALERT_SCAN_CURSOR_KEY, batch.length === limit ? batch[batch.length - 1]!.websiteId : '');

  let websites = 0;
  let errorAlerts = 0;
  let logAlerts = 0;

  for (const row of batch) {
    websites++;
    const errors = await evaluateErrorAlertRules(env, row.websiteId, now);
    const logs = await evaluateLogAlertRules(env, row.websiteId, now);
    errorAlerts += errors.length;
    logAlerts += logs.length;
  }

  console.log(
    JSON.stringify({
      event: 'alert_checks_complete',
      websites,
      errorAlerts,
      logAlerts,
    }),
  );

  return { websites, errorAlerts, logAlerts };
}

export async function runScheduledWarehouseQueries(env: Env, now = Date.now()) {
  const rows = await env.DB.prepare(
    `SELECT website_id as websiteId, MIN(next_run_at) as dueAt
     FROM warehouse_scheduled_query
     WHERE enabled = 1 AND next_run_at <= ?1
     GROUP BY website_id
     ORDER BY dueAt ASC
     LIMIT ${MAX_WAREHOUSE_WEBSITES_PER_TICK}`,
  )
    .bind(now)
    .all<{ websiteId: string }>();

  let websites = 0;
  let executed = 0;

  for (const row of rows.results ?? []) {
    websites++;
    const result = await runDueWarehouseScheduledQueries(env, row.websiteId, now);
    executed += result.executedCount;
  }

  console.log(
    JSON.stringify({
      event: 'warehouse_schedules_complete',
      websites,
      executed,
    }),
  );

  return { websites, executed };
}

/**
 * Error tracking upkeep: rekey issue state stored under legacy fingerprints, move inline source
 * maps to R2, and catch regressions the ingest fast path missed. Each step is bounded per tick.
 */
export async function runScheduledErrorTracking(env: Env, now = Date.now()) {
  const legacyKeys = await migrateLegacyErrorIssueKeysBatch(env);
  const sourceMaps = await migrateInlineSourceMapsToR2(env);
  const regressions = await runScheduledErrorRegressionChecks(env, now);
  console.log(JSON.stringify({ event: 'error_tracking_maintenance_complete', legacyKeys, sourceMaps, regressions }));
  return { legacyKeys, sourceMaps, regressions };
}

export async function runScheduledMaintenance(env: Env, cron: string) {
  await runScheduledEmailReports(env, cron);
  const alerts = await runScheduledAlertChecks(env);
  // Must never keep retention and deletion below from running.
  const errorTracking = await runScheduledErrorTracking(env).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'error_tracking_maintenance_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  });
  const warehouse = await runScheduledWarehouseQueries(env);
  const dataSources = await runDueWarehouseDataSourceSyncs(env);
  const retention = await runRetentionPurge(env);
  const deletion = await runDataDeletion(env);
  return { alerts, errorTracking, warehouse, dataSources, retention, deletion };
}
