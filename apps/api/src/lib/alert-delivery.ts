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

export async function deliverAlertNotification(env: Env, input: AlertDeliveryInput) {
  const channel = input.channel.trim().toLowerCase();
  if (channel === 'record' || !channel) return { delivered: false, channel };

  const subject = `Flareboard ${input.kind} alert: ${input.ruleName}`;
  const text = [
    `${input.ruleName} triggered.`,
    `Count: ${input.count}`,
    `Threshold: ${input.threshold}`,
    `Window: ${input.windowMinutes} minutes`,
    `Website: ${input.websiteId}`,
  ].join('\n');
  const payload = {
    type: `${input.kind}_alert`,
    websiteId: input.websiteId,
    ruleName: input.ruleName,
    count: input.count,
    threshold: input.threshold,
    windowMinutes: input.windowMinutes,
  };

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

  if (channel === 'email') {
    const to = input.target?.trim();
    if (!to) return { delivered: false, channel, error: 'Missing email target' };
    const ok = await sendEmail(env, {
      to,
      subject,
      text,
      html: `<p><strong>${escapeHtml(input.ruleName)}</strong> triggered.</p><p>Count: ${input.count}<br/>Threshold: ${input.threshold}<br/>Window: ${input.windowMinutes} minutes</p>`,
    });
    return { delivered: ok, channel, error: ok ? undefined : 'Email binding unavailable' };
  }

  if (channel === 'webhook') {
    const result = await postWebhook(input.target ?? '', payload);
    return { delivered: result.ok, channel, error: result.error };
  }

  return { delivered: false, channel, error: `Unsupported alert channel: ${input.channel}` };
}
