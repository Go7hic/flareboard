import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  MAX_INSIGHT_ALERTS_PER_WEBSITE,
  createInsightAlertSchema,
  insightAlertTargetProblem,
  updateInsightAlertSchema,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import {
  alertSeriesKeys,
  countWebsiteInsightAlerts,
  getInsightAlert,
  listInsightAlertChecks,
  listInsightAlerts,
} from '../lib/insight-alerts';
import { resolveInsightQuery } from '../lib/insights';
import { InsightQueryError } from '../lib/property-filters';
import { requireWebsiteById } from '../lib/website';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

async function loadInsight(c: Ctx) {
  const db = createDb(c.env.DB);
  const [insight] = await db
    .select()
    .from(schema.insight)
    .where(eq(schema.insight.insightId, c.req.param('insightId') ?? ''))
    .limit(1);
  if (!insight) return null;
  const website = await requireWebsiteById(c, insight.websiteId);
  return website ? { insight, website } : null;
}

function seriesProblem(insight: typeof schema.insight.$inferSelect, seriesKey: string): string | null {
  if (insight.type !== 'trend') return 'Alerts are available on trend insights';
  try {
    const keys = alertSeriesKeys(resolveInsightQuery(insight.type, insight.query));
    return keys.includes(seriesKey) ? null : `Series ${seriesKey} is not in this insight`;
  } catch (error) {
    if (error instanceof InsightQueryError) return error.message;
    throw error;
  }
}

export async function handleList(c: Ctx) {
  const found = await loadInsight(c);
  if (!found) return notFound();
  const alerts = await listInsightAlerts(c.env, found.insight.insightId);
  return json({ alerts, limit: MAX_INSIGHT_ALERTS_PER_WEBSITE });
}

export async function handleCreate(c: Ctx) {
  const found = await loadInsight(c);
  if (!found) return notFound();
  if (!(await canMutateWebsite(c.env, found.website, c.get('user')))) return json({ message: 'Read-only access' }, 403);
  const parsed = createInsightAlertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid alert');
  const problem = seriesProblem(found.insight, parsed.data.seriesKey);
  if (problem) return badRequest(problem);
  if ((await countWebsiteInsightAlerts(c.env, found.website.websiteId)) >= MAX_INSIGHT_ALERTS_PER_WEBSITE) {
    return json({ message: `A website can have at most ${MAX_INSIGHT_ALERTS_PER_WEBSITE} insight alerts.` }, 409);
  }

  const alertId = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO insight_alert
       (alert_id, website_id, insight_id, name, condition, threshold, series_key, check_interval, channel, target,
        enabled, created_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
  )
    .bind(
      alertId,
      found.website.websiteId,
      found.insight.insightId,
      parsed.data.name,
      parsed.data.condition,
      parsed.data.threshold,
      parsed.data.seriesKey,
      parsed.data.checkInterval,
      parsed.data.channel,
      parsed.data.target.trim(),
      parsed.data.enabled ? 1 : 0,
      c.get('user').userId,
      now,
    )
    .run();
  return json(await getInsightAlert(c.env, found.insight.insightId, alertId), 201);
}

export async function handleUpdate(c: Ctx) {
  const found = await loadInsight(c);
  if (!found) return notFound();
  const alert = await getInsightAlert(c.env, found.insight.insightId, c.req.param('alertId') ?? '');
  if (!alert) return notFound();
  if (!(await canMutateWebsite(c.env, found.website, c.get('user')))) return json({ message: 'Read-only access' }, 403);
  const parsed = updateInsightAlertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid alert');

  const next = {
    name: parsed.data.name ?? alert.name,
    condition: parsed.data.condition ?? alert.condition,
    threshold: parsed.data.threshold ?? alert.threshold,
    seriesKey: parsed.data.seriesKey ?? alert.seriesKey,
    checkInterval: parsed.data.checkInterval ?? alert.checkInterval,
    channel: parsed.data.channel ?? (alert.channel as 'email' | 'webhook'),
    target: (parsed.data.target ?? alert.target ?? '').trim(),
    enabled: parsed.data.enabled ?? alert.enabled,
    snoozedUntil: parsed.data.snoozedUntil === undefined ? alert.snoozedUntil : parsed.data.snoozedUntil,
  };
  const targetProblem = insightAlertTargetProblem(next.channel, next.target);
  if (targetProblem) return badRequest(targetProblem);
  if (next.condition !== 'value_above' && next.condition !== 'value_below' && next.threshold < 0) {
    return badRequest('Percent change must be positive');
  }
  if (parsed.data.seriesKey) {
    const problem = seriesProblem(found.insight, next.seriesKey);
    if (problem) return badRequest(problem);
  }

  await c.env.DB.prepare(
    `UPDATE insight_alert
     SET name = ?2, condition = ?3, threshold = ?4, series_key = ?5, check_interval = ?6, channel = ?7, target = ?8,
         enabled = ?9, snoozed_until = ?10, updated_at = ?11
     WHERE alert_id = ?1`,
  )
    .bind(
      alert.id,
      next.name,
      next.condition,
      next.threshold,
      next.seriesKey,
      next.checkInterval,
      next.channel,
      next.target,
      next.enabled ? 1 : 0,
      next.snoozedUntil,
      Date.now(),
    )
    .run();
  return json(await getInsightAlert(c.env, found.insight.insightId, alert.id));
}

export async function handleDelete(c: Ctx) {
  const found = await loadInsight(c);
  if (!found) return notFound();
  const alert = await getInsightAlert(c.env, found.insight.insightId, c.req.param('alertId') ?? '');
  if (!alert) return notFound();
  if (!(await canMutateWebsite(c.env, found.website, c.get('user')))) return json({ message: 'Read-only access' }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM insight_alert_check WHERE alert_id = ?1`).bind(alert.id),
    c.env.DB.prepare(`DELETE FROM insight_alert WHERE alert_id = ?1`).bind(alert.id),
  ]);
  return json({ ok: true });
}

export async function handleHistory(c: Ctx) {
  const found = await loadInsight(c);
  if (!found) return notFound();
  const alert = await getInsightAlert(c.env, found.insight.insightId, c.req.param('alertId') ?? '');
  if (!alert) return notFound();
  return json({ checks: await listInsightAlertChecks(c.env, alert.id) });
}
