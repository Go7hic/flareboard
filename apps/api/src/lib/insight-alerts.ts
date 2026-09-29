import {
  alertConditionMet,
  alertIntervals,
  type InsightAlertCondition,
  type InsightAlertInterval,
  type InsightQuery,
} from '@flareboard/shared';
import type { Env } from '../env';
import { deliverInsightAlertNotification } from './alert-delivery';
import { resolveInsightQuery, runInsightQuery } from './insights';
import { InsightQueryError } from './property-filters';
import { getWebsiteById } from './queries';

export type InsightAlertRow = {
  id: string;
  websiteId: string;
  insightId: string;
  name: string;
  condition: InsightAlertCondition;
  threshold: number;
  seriesKey: string;
  checkInterval: InsightAlertInterval;
  channel: string;
  target: string | null;
  enabled: boolean;
  snoozedUntil: number | null;
  lastCheckedAt: number | null;
  lastState: string | null;
  createdBy: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type InsightAlertCheckRow = {
  id: string;
  alertId: string;
  intervalStart: number;
  intervalEnd: number;
  value: number | null;
  previousValue: number | null;
  state: 'firing' | 'ok' | 'error';
  delivered: boolean;
  error: string | null;
  createdAt: number | null;
};

const ALERT_COLUMNS = `alert_id as id, website_id as websiteId, insight_id as insightId, name, condition, threshold,
  series_key as seriesKey, check_interval as checkInterval, channel, target, enabled, snoozed_until as snoozedUntil,
  last_checked_at as lastCheckedAt, last_state as lastState, created_by as createdBy, created_at as createdAt,
  updated_at as updatedAt`;

type StoredAlert = Omit<InsightAlertRow, 'enabled'> & { enabled: number | boolean };

function normalizeAlert(row: StoredAlert): InsightAlertRow {
  return { ...row, enabled: Boolean(row.enabled) };
}

export async function listInsightAlerts(env: Env, insightId: string) {
  const rows = await env.DB.prepare(`SELECT ${ALERT_COLUMNS} FROM insight_alert WHERE insight_id = ?1 ORDER BY created_at`)
    .bind(insightId)
    .all<StoredAlert>();
  return (rows.results ?? []).map(normalizeAlert);
}

export async function getInsightAlert(env: Env, insightId: string, alertId: string) {
  const row = await env.DB.prepare(`SELECT ${ALERT_COLUMNS} FROM insight_alert WHERE insight_id = ?1 AND alert_id = ?2`)
    .bind(insightId, alertId)
    .first<StoredAlert>();
  return row ? normalizeAlert(row) : null;
}

export async function countWebsiteInsightAlerts(env: Env, websiteId: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) as n FROM insight_alert WHERE website_id = ?1`)
    .bind(websiteId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listInsightAlertChecks(env: Env, alertId: string, limit = 50) {
  const rows = await env.DB.prepare(
    `SELECT check_id as id, alert_id as alertId, interval_start as intervalStart, interval_end as intervalEnd, value,
            previous_value as previousValue, state, delivered, error, created_at as createdAt
     FROM insight_alert_check WHERE alert_id = ?1 ORDER BY interval_start DESC LIMIT ?2`,
  )
    .bind(alertId, limit)
    .all<Omit<InsightAlertCheckRow, 'delivered'> & { delivered: number }>();
  return (rows.results ?? []).map((row) => ({ ...row, delivered: Boolean(row.delivered) }));
}

/** Series keys of a trend query an alert can watch. */
export function alertSeriesKeys(query: InsightQuery): string[] {
  const count = Math.max(query.series?.length ?? 0, 1);
  const keys = 'ABCDE'.slice(0, count).split('');
  return query.formula?.trim() ? [...keys, 'formula'] : keys;
}

function dashboardUrl(env: Env) {
  return env.DASHBOARD_URL?.trim().replace(/\/$/, '') || null;
}

/** Total of one result line over [startAt, endAt], without breakdown or comparison. */
async function lineTotal(
  env: Env,
  insight: { websiteId: string; type: string; query: unknown },
  seriesKey: string,
  startAt: number,
  endAt: number,
  timezone: string,
  minStartAt: number | null,
) {
  const query: InsightQuery = { ...resolveInsightQuery(insight.type, insight.query), breakdown: null, compare: false };
  const result = await runInsightQuery(env, insight.websiteId, 'trend', query, startAt, endAt, { timezone, minStartAt });
  if (result.kind !== 'trend') throw new InsightQueryError('Alerts need a trend insight');
  const line = result.results.find((row) => row.key === seriesKey);
  if (!line) throw new InsightQueryError(`Series ${seriesKey} is not in this insight`);
  return { total: line.total, label: line.label };
}

export type AlertEvaluation =
  | { status: 'skipped'; reason: 'disabled' | 'snoozed' | 'already_checked' | 'missing_insight' }
  | { status: 'checked'; state: 'firing' | 'ok' | 'error'; value: number | null; previousValue: number | null; delivered: boolean };

/**
 * Checks one alert against the last complete interval. Each (alert, interval) is evaluated and
 * delivered at most once: the check row's unique key is claimed before anything is sent.
 */
export async function evaluateInsightAlert(env: Env, alert: InsightAlertRow, now = Date.now()): Promise<AlertEvaluation> {
  if (!alert.enabled) return { status: 'skipped', reason: 'disabled' };
  if (alert.snoozedUntil && alert.snoozedUntil > now) return { status: 'skipped', reason: 'snoozed' };

  const insight = await env.DB.prepare(`SELECT website_id as websiteId, type, name, query FROM insight WHERE insight_id = ?1`)
    .bind(alert.insightId)
    .first<{ websiteId: string; type: string; name: string; query: string }>();
  const website = insight ? await getWebsiteById(env, insight.websiteId) : null;
  if (!insight || !website) return { status: 'skipped', reason: 'missing_insight' };
  const timezone = website.timezone ?? 'UTC';
  const { current, previous } = alertIntervals(now, alert.checkInterval, timezone);

  const seen = await env.DB.prepare(`SELECT 1 as found FROM insight_alert_check WHERE alert_id = ?1 AND interval_start = ?2`)
    .bind(alert.id, current.startAt)
    .first();
  if (seen) return { status: 'skipped', reason: 'already_checked' };

  const parsedInsight = { websiteId: insight.websiteId, type: insight.type, query: JSON.parse(insight.query) as unknown };
  const floor = website.resetAt instanceof Date ? website.resetAt.getTime() : null;
  let state: 'firing' | 'ok' | 'error' = 'ok';
  let value: number | null = null;
  let previousValue: number | null = null;
  let label = alert.seriesKey;
  let error: string | null = null;
  try {
    const measured = await lineTotal(env, parsedInsight, alert.seriesKey, current.startAt, current.endAt, timezone, floor);
    value = measured.total;
    label = measured.label || alert.seriesKey;
    if (alert.condition === 'increase_above' || alert.condition === 'decrease_above') {
      previousValue = (await lineTotal(env, parsedInsight, alert.seriesKey, previous.startAt, previous.endAt, timezone, floor)).total;
    }
    state = alertConditionMet(alert.condition, alert.threshold, value, previousValue) ? 'firing' : 'ok';
  } catch (cause) {
    if (!(cause instanceof InsightQueryError)) throw cause;
    state = 'error';
    error = cause.message;
  }

  const checkId = crypto.randomUUID();
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO insight_alert_check
       (check_id, alert_id, website_id, interval_start, interval_end, value, previous_value, state, delivered, error, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10)`,
  )
    .bind(checkId, alert.id, alert.websiteId, current.startAt, current.endAt, value, previousValue, state, error, now)
    .run();
  if (!claim.meta?.changes) return { status: 'skipped', reason: 'already_checked' };

  let delivered = false;
  if (state === 'firing' && value !== null) {
    const base = dashboardUrl(env);
    const result = await deliverInsightAlertNotification(env, {
      websiteId: alert.websiteId,
      alertName: alert.name,
      insightName: insight.name,
      channel: alert.channel,
      target: alert.target,
      condition: alert.condition,
      threshold: alert.threshold,
      value,
      previousValue,
      seriesLabel: label,
      intervalStart: current.startAt,
      intervalEnd: current.endAt,
      insightUrl: base ? `${base}/insights?insight=${alert.insightId}` : null,
    }).catch((cause: unknown) => ({ delivered: false, error: cause instanceof Error ? cause.message : String(cause) }));
    delivered = result.delivered;
    await env.DB.prepare(`UPDATE insight_alert_check SET delivered = ?2, error = ?3 WHERE check_id = ?1`)
      .bind(checkId, delivered ? 1 : 0, result.error ?? null)
      .run();
  }

  await env.DB.prepare(`UPDATE insight_alert SET last_checked_at = ?2, last_state = ?3 WHERE alert_id = ?1`)
    .bind(alert.id, now, state)
    .run();
  return { status: 'checked', state, value, previousValue, delivered };
}

export async function evaluateWebsiteInsightAlerts(env: Env, websiteId: string, now = Date.now()) {
  const rows = await env.DB.prepare(`SELECT ${ALERT_COLUMNS} FROM insight_alert WHERE website_id = ?1 AND enabled = 1`)
    .bind(websiteId)
    .all<StoredAlert>();
  const results: AlertEvaluation[] = [];
  for (const alert of (rows.results ?? []).map(normalizeAlert)) {
    results.push(await evaluateInsightAlert(env, alert, now));
  }
  return results;
}

const INSIGHT_ALERT_CURSOR_KEY = 'cron:insight-alert-cursor';
const MAX_INSIGHT_ALERT_WEBSITES_PER_TICK = 50;

/** Hourly cron: walks websites with enabled insight alerts from a persisted cursor. */
export async function runScheduledInsightAlerts(env: Env, now = Date.now(), limit = MAX_INSIGHT_ALERT_WEBSITES_PER_TICK) {
  const cursor = (await env.CACHE.get(INSIGHT_ALERT_CURSOR_KEY)) ?? '';
  const rows = await env.DB.prepare(
    `SELECT DISTINCT a.website_id as websiteId
     FROM insight_alert a JOIN website w ON w.website_id = a.website_id
     WHERE a.enabled = 1 AND w.deleted_at IS NULL AND a.website_id > ?1
     ORDER BY a.website_id LIMIT ?2`,
  )
    .bind(cursor, limit)
    .all<{ websiteId: string }>();
  const batch = rows.results ?? [];
  await env.CACHE.put(INSIGHT_ALERT_CURSOR_KEY, batch.length === limit ? batch[batch.length - 1]!.websiteId : '');

  let checked = 0;
  let fired = 0;
  for (const { websiteId } of batch) {
    const results = await evaluateWebsiteInsightAlerts(env, websiteId, now).catch((error: unknown) => {
      console.error(
        JSON.stringify({ event: 'insight_alert_website_failed', websiteId, error: error instanceof Error ? error.message : String(error) }),
      );
      return [] as AlertEvaluation[];
    });
    for (const result of results) {
      if (result.status !== 'checked') continue;
      checked++;
      if (result.state === 'firing') fired++;
    }
  }
  console.log(JSON.stringify({ event: 'insight_alerts_complete', websites: batch.length, checked, fired }));
  return { websites: batch.length, checked, fired };
}
