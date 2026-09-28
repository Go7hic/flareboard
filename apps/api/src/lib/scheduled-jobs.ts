import type { Env } from '../env';
import { evaluateErrorAlertRules } from './errors';
import { runScheduledEmailReports } from './email-reports';
import { evaluateLogAlertRules } from './logs';
import { runRetentionPurge } from './retention';
import { runDueWarehouseScheduledQueries, runDueWarehouseDataSourceSyncs } from './warehouse';
import { runDataDeletion } from './data-deletion';

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

export async function runScheduledMaintenance(env: Env, cron: string) {
  await runScheduledEmailReports(env, cron);
  const alerts = await runScheduledAlertChecks(env);
  const warehouse = await runScheduledWarehouseQueries(env);
  const dataSources = await runDueWarehouseDataSourceSyncs(env);
  const retention = await runRetentionPurge(env);
  const deletion = await runDataDeletion(env);
  return { alerts, warehouse, dataSources, retention, deletion };
}
