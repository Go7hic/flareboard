import { postWebhook } from '@flareboard/shared';
import type { Env } from '../env';
import { sendEmail } from './email';

export type AlertDeliveryInput = {
  websiteId: string;
  ruleName: string;
  channel: string;
  target: string | null;
  count: number;
  threshold: number;
  windowMinutes: number;
  kind: 'error' | 'log';
};

export type RegressionDeliveryInput = {
  websiteId: string;
  ruleName: string;
  channel: string;
  target: string | null;
  fingerprint: string;
  title: string;
  release: string | null;
  environment: string | null;
  occurredAt: number;
  resolvedAt: number | null;
  issueUrl: string | null;
};

export type AlertDeliveryResult = { delivered: boolean; channel: string; error?: string };

export async function hasRecentAlertEvent(
  env: Env,
  table: 'error_alert_event' | 'log_alert_event',
  alertRuleId: string,
  websiteId: string,
  since: number,
) {
  const row = await env.DB.prepare(
    `SELECT alert_event_id as id
     FROM ${table}
     WHERE alert_rule_id = ?1 AND website_id = ?2 AND created_at >= ?3
     LIMIT 1`,
  )
    .bind(alertRuleId, websiteId, since)
    .first<{ id: string }>();
  return Boolean(row);
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function deliver(
  env: Env,
  rawChannel: string,
  target: string | null,
  message: { subject: string; text: string; html: string; payload: Record<string, unknown> },
): Promise<AlertDeliveryResult> {
  const channel = rawChannel.trim().toLowerCase();
  if (channel === 'record' || !channel) return { delivered: false, channel };

  if (channel === 'email') {
    const to = target?.trim();
    if (!to) return { delivered: false, channel, error: 'Missing email target' };
    const ok = await sendEmail(env, { to, subject: message.subject, text: message.text, html: message.html });
    return { delivered: ok, channel, error: ok ? undefined : 'Email binding unavailable' };
  }

  if (channel === 'webhook') {
    const result = await postWebhook(target ?? '', message.payload);
    return { delivered: result.ok, channel, error: result.error };
  }

  return { delivered: false, channel, error: `Unsupported alert channel: ${rawChannel}` };
}

export async function deliverAlertNotification(env: Env, input: AlertDeliveryInput) {
  return deliver(env, input.channel, input.target, {
    subject: `Flareboard ${input.kind} alert: ${input.ruleName}`,
    text: [
      `${input.ruleName} triggered.`,
      `Count: ${input.count}`,
      `Threshold: ${input.threshold}`,
      `Window: ${input.windowMinutes} minutes`,
      `Website: ${input.websiteId}`,
    ].join('\n'),
    html: `<p><strong>${escapeHtml(input.ruleName)}</strong> triggered.</p><p>Count: ${input.count}<br/>Threshold: ${input.threshold}<br/>Window: ${input.windowMinutes} minutes</p>`,
    payload: {
      type: `${input.kind}_alert`,
      websiteId: input.websiteId,
      ruleName: input.ruleName,
      count: input.count,
      threshold: input.threshold,
      windowMinutes: input.windowMinutes,
    },
  });
}

export type InsightAlertDeliveryInput = {
  websiteId: string;
  alertName: string;
  insightName: string;
  channel: string;
  target: string | null;
  condition: string;
  threshold: number;
  value: number;
  previousValue: number | null;
  seriesLabel: string;
  intervalStart: number;
  intervalEnd: number;
  insightUrl: string | null;
};

const CONDITION_TEXT: Record<string, string> = {
  value_above: 'is above',
  value_below: 'is below',
  increase_above: 'increased by more than',
  decrease_above: 'decreased by more than',
};

function formatAlertNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** An insight alert fired for one interval. Sent once per interval through the alert's channel. */
export async function deliverInsightAlertNotification(env: Env, input: InsightAlertDeliveryInput) {
  const relative = input.condition === 'increase_above' || input.condition === 'decrease_above';
  const rule = `${input.seriesLabel} ${CONDITION_TEXT[input.condition] ?? input.condition} ${formatAlertNumber(input.threshold)}${relative ? '%' : ''}`;
  const period = `${new Date(input.intervalStart).toISOString()} – ${new Date(input.intervalEnd + 1).toISOString()}`;
  const lines = [
    `Alert "${input.alertName}" fired on insight "${input.insightName}".`,
    `Condition: ${rule}`,
    `Value: ${formatAlertNumber(input.value)}`,
    input.previousValue === null ? null : `Previous interval: ${formatAlertNumber(input.previousValue)}`,
    `Interval: ${period}`,
    input.insightUrl ? `Insight: ${input.insightUrl}` : null,
  ].filter((line): line is string => Boolean(line));
  const link = input.insightUrl ? `<p><a href="${escapeHtml(input.insightUrl)}">Open insight</a></p>` : '';
  return deliver(env, input.channel, input.target, {
    subject: `Flareboard alert: ${input.alertName.slice(0, 120)}`,
    text: lines.join('\n'),
    html: `<p>Alert <strong>${escapeHtml(input.alertName)}</strong> fired on insight <strong>${escapeHtml(input.insightName)}</strong>.</p><p>Condition: ${escapeHtml(rule)}<br/>Value: <strong>${escapeHtml(formatAlertNumber(input.value))}</strong>${input.previousValue === null ? '' : `<br/>Previous interval: ${escapeHtml(formatAlertNumber(input.previousValue))}`}<br/>Interval: ${escapeHtml(period)}</p>${link}`,
    payload: {
      type: 'insight_alert',
      websiteId: input.websiteId,
      alertName: input.alertName,
      insightName: input.insightName,
      condition: input.condition,
      threshold: input.threshold,
      value: input.value,
      previousValue: input.previousValue,
      series: input.seriesLabel,
      intervalStart: input.intervalStart,
      intervalEnd: input.intervalEnd,
      insightUrl: input.insightUrl,
    },
  });
}

/** A resolved error issue occurred again. Sent once per regression through the rule's channel. */
export async function deliverRegressionNotification(env: Env, input: RegressionDeliveryInput) {
  const when = new Date(input.occurredAt).toISOString();
  const lines = [
    `A resolved issue occurred again: ${input.title}`,
    `Alert rule: ${input.ruleName}`,
    `Occurred at: ${when}`,
    input.release ? `Release: ${input.release}` : null,
    input.environment ? `Environment: ${input.environment}` : null,
    `Website: ${input.websiteId}`,
    input.issueUrl ? `Issue: ${input.issueUrl}` : null,
  ].filter((line): line is string => Boolean(line));
  const link = input.issueUrl ? `<p><a href="${escapeHtml(input.issueUrl)}">View issue</a></p>` : '';
  return deliver(env, input.channel, input.target, {
    subject: `Flareboard error regression: ${input.title.slice(0, 120)}`,
    text: lines.join('\n'),
    html: `<p>A resolved issue occurred again: <strong>${escapeHtml(input.title)}</strong></p><p>Alert rule: ${escapeHtml(input.ruleName)}<br/>Occurred at: ${when}${input.release ? `<br/>Release: ${escapeHtml(input.release)}` : ''}${input.environment ? `<br/>Environment: ${escapeHtml(input.environment)}` : ''}</p>${link}`,
    payload: {
      type: 'error_regression',
      websiteId: input.websiteId,
      ruleName: input.ruleName,
      fingerprint: input.fingerprint,
      title: input.title,
      release: input.release,
      environment: input.environment,
      occurredAt: input.occurredAt,
      resolvedAt: input.resolvedAt,
      issueUrl: input.issueUrl,
    },
  });
}
