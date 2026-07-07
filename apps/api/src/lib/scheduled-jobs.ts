import type { Env } from '../env';
import { evaluateErrorAlertRules } from './errors';
import { runScheduledEmailReports } from './email-reports';
import { evaluateLogAlertRules } from './logs';
import { runDueWarehouseScheduledQueries, runDueWarehouseDataSourceSyncs } from './warehouse';

export async function runScheduledAlertChecks(env: Env, now = Date.now()) {
  const rows = await env.DB.prepare(
    `SELECT website_id as websiteId
     FROM website
     WHERE deleted_at IS NULL`,
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
    `SELECT DISTINCT website_id as websiteId
     FROM warehouse_scheduled_query
     WHERE enabled = 1 AND next_run_at <= ?1`,
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
  return { alerts, warehouse, dataSources };
}
