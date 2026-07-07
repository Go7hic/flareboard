import type { Env } from '../env';
import { evaluateErrorAlertRules } from './errors';
import { runScheduledEmailReports } from './email-reports';
import { evaluateLogAlertRules } from './logs';
import { runRetentionPurge } from './retention';
import { runDueWarehouseScheduledQueries, runDueWarehouseDataSourceSyncs } from './warehouse';

// Caps how many websites a single cron tick processes so one invocation
// cannot blow past Worker CPU/subrequest limits; the remainder is picked up
// on the next tick.
const MAX_ALERT_WEBSITES_PER_TICK = 100;
const MAX_WAREHOUSE_WEBSITES_PER_TICK = 50;

export async function runScheduledAlertChecks(env: Env, now = Date.now()) {
  // Only visit websites that actually have enabled alert rules instead of
  // iterating every website in the instance.
  const rows = await env.DB.prepare(
    `SELECT DISTINCT w.website_id as websiteId
     FROM website w
     JOIN (
       SELECT website_id FROM error_alert_rule WHERE enabled = 1
       UNION
       SELECT website_id FROM log_alert_rule WHERE enabled = 1
     ) rules ON rules.website_id = w.website_id
     WHERE w.deleted_at IS NULL
     LIMIT ${MAX_ALERT_WEBSITES_PER_TICK}`,
  ).all<{ websiteId: string }>();

  let websites = 0;
  let errorAlerts = 0;
  let logAlerts = 0;

  for (const row of rows.results ?? []) {
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
  return { alerts, warehouse, dataSources, retention };
}
