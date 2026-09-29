import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSecureToken, MAX_INSIGHT_ALERTS_PER_WEBSITE } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { evaluateInsightAlert, getInsightAlert, runScheduledInsightAlerts } from '../../src/lib/insight-alerts';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { DAY, DAY0, FIXTURE_SITE, seedInsightFixture } from '../helpers/insight-fixture';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
/** Day 1, 05:00 UTC: the last complete day is day 0 (4 signups), the one before is day -1 (1 signup). */
const NOW = DAY0 + DAY + 5 * 3_600_000;
const testEnv = env as unknown as Env;

async function headers() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

let insightId = '';

async function createAlert(body: Record<string, unknown>) {
  return fetchWorkerJson<{ id: string; message?: string }>(`/api/insights/${insightId}/alerts`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ name: 'Signups', channel: 'webhook', target: 'https://hooks.example.com/alert', ...body }),
  });
}

async function checks(alertId: string) {
  const rows = await env.DB.prepare(`SELECT state, value, previous_value as previousValue, delivered FROM insight_alert_check WHERE alert_id = ?1`)
    .bind(alertId)
    .all<{ state: string; value: number; previousValue: number | null; delivered: number }>();
  return rows.results ?? [];
}

function mockWebhook() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
}

describe('insight alerts', () => {
  beforeAll(async () => {
    await seedInsightFixture();
    const created = await fetchWorkerJson<{ id: string }>('/api/insights', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        websiteId: FIXTURE_SITE,
        name: 'Signups <b>daily</b>',
        type: 'trend',
        query: { version: 2, interval: 'day', series: [{ kind: 'event', event: 'signup', math: 'total' }] },
      }),
    });
    insightId = created.body.id;
  });

  afterEach(() => vi.restoreAllMocks());

  it('validates alerts: trend insights only, existing series, channel targets', async () => {
    expect((await createAlert({ condition: 'value_above', threshold: 3, seriesKey: 'B' })).response.status).toBe(400);
    expect((await createAlert({ condition: 'value_above', threshold: 3, channel: 'email', target: 'no' })).response.status).toBe(400);

    const funnel = await fetchWorkerJson<{ id: string }>('/api/insights', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ websiteId: FIXTURE_SITE, name: 'Funnel', type: 'funnel', query: { events: ['signup', 'purchase'] } }),
    });
    const onFunnel = await fetchWorker(`/api/insights/${funnel.body.id}/alerts`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ name: 'x', condition: 'value_above', threshold: 1, channel: 'email', target: 'a@b.co' }),
    });
    expect(onFunnel.status).toBe(400);
  });

  it('fires once per interval and delivers through the webhook', async () => {
    const webhook = mockWebhook();
    const created = await createAlert({ condition: 'value_above', threshold: 3 });
    expect(created.response.status).toBe(201);
    const alert = (await getInsightAlert(testEnv, insightId, created.body.id))!;

    const first = await evaluateInsightAlert(testEnv, alert, NOW);
    expect(first).toMatchObject({ status: 'checked', state: 'firing', value: 4, delivered: true });
    expect(webhook).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(webhook.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ type: 'insight_alert', value: 4, threshold: 3, condition: 'value_above' });

    // Same interval again (next hourly tick): nothing new is evaluated or sent.
    const again = await evaluateInsightAlert(testEnv, alert, NOW + 3_600_000);
    expect(again).toEqual({ status: 'skipped', reason: 'already_checked' });
    expect(webhook).toHaveBeenCalledTimes(1);
    expect(await checks(alert.id)).toEqual([{ state: 'firing', value: 4, previousValue: null, delivered: 1 }]);

    // The next day is a new interval (day 1: alice and dave signed up = 2).
    const nextDay = await evaluateInsightAlert(testEnv, alert, NOW + DAY);
    expect(nextDay).toMatchObject({ status: 'checked', state: 'ok', value: 2 });
    expect(webhook).toHaveBeenCalledTimes(1);

    const history = await fetchWorkerJson<{ checks: Array<{ state: string }> }>(
      `/api/insights/${insightId}/alerts/${alert.id}/history`,
      { headers: await headers() },
    );
    expect(history.body.checks.map((c) => c.state)).toEqual(['ok', 'firing']);
  });

  it('compares with the previous interval for percent changes', async () => {
    mockWebhook();
    const up = await createAlert({ condition: 'increase_above', threshold: 200 });
    const down = await createAlert({ condition: 'decrease_above', threshold: 10 });
    const upAlert = (await getInsightAlert(testEnv, insightId, up.body.id))!;
    const downAlert = (await getInsightAlert(testEnv, insightId, down.body.id))!;
    // 1 -> 4 signups is +300%.
    expect(await evaluateInsightAlert(testEnv, upAlert, NOW)).toMatchObject({ state: 'firing', value: 4, previousValue: 1 });
    expect(await evaluateInsightAlert(testEnv, downAlert, NOW)).toMatchObject({ state: 'ok' });
  });

  it('sends email alerts through the email binding', async () => {
    const sent: Array<{ to: string; subject: string; html: string }> = [];
    const withEmail = { ...testEnv, EMAIL: { send: async (message: { to: string; subject: string; html: string }) => void sent.push(message) } } as unknown as Env;
    const created = await createAlert({ condition: 'value_below', threshold: 10, channel: 'email', target: 'ops@example.com' });
    const alert = (await getInsightAlert(testEnv, insightId, created.body.id))!;
    expect(await evaluateInsightAlert(withEmail, alert, NOW)).toMatchObject({ state: 'firing', delivered: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('ops@example.com');
    // Insight names are escaped in the HTML body.
    expect(sent[0]?.html).toContain('Signups &lt;b&gt;daily&lt;/b&gt;');
  });

  it('skips snoozed and disabled alerts without recording a check', async () => {
    const webhook = mockWebhook();
    const created = await createAlert({ condition: 'value_above', threshold: 0 });
    const snooze = await fetchWorkerJson<{ snoozedUntil: number }>(`/api/insights/${insightId}/alerts/${created.body.id}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ snoozedUntil: NOW + 2 * DAY }),
    });
    expect(snooze.body.snoozedUntil).toBe(NOW + 2 * DAY);
    let alert = (await getInsightAlert(testEnv, insightId, created.body.id))!;
    expect(await evaluateInsightAlert(testEnv, alert, NOW)).toEqual({ status: 'skipped', reason: 'snoozed' });

    await fetchWorker(`/api/insights/${insightId}/alerts/${created.body.id}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ snoozedUntil: null, enabled: false }),
    });
    alert = (await getInsightAlert(testEnv, insightId, created.body.id))!;
    expect(await evaluateInsightAlert(testEnv, alert, NOW)).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(await checks(alert.id)).toEqual([]);
    expect(webhook).not.toHaveBeenCalled();

    // Unmuted: the current interval is evaluated.
    await fetchWorker(`/api/insights/${insightId}/alerts/${created.body.id}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ enabled: true }),
    });
    alert = (await getInsightAlert(testEnv, insightId, created.body.id))!;
    expect(await evaluateInsightAlert(testEnv, alert, NOW)).toMatchObject({ state: 'firing' });
  });

  it('runs from the cron and caps alerts per website', async () => {
    mockWebhook();
    const result = await runScheduledInsightAlerts(testEnv, NOW + 2 * DAY);
    expect(result.websites).toBeGreaterThanOrEqual(1);
    expect(result.checked).toBeGreaterThan(0);

    const count = await env.DB.prepare(`SELECT COUNT(*) as n FROM insight_alert WHERE website_id = ?1`)
      .bind(FIXTURE_SITE)
      .first<{ n: number }>();
    for (let i = count?.n ?? 0; i < MAX_INSIGHT_ALERTS_PER_WEBSITE; i++) {
      expect((await createAlert({ condition: 'value_above', threshold: 1000 })).response.status).toBe(201);
    }
    const over = await createAlert({ condition: 'value_above', threshold: 1000 });
    expect(over.response.status).toBe(409);
  });

  it('deletes alerts and their history with the insight', async () => {
    const created = await fetchWorkerJson<{ id: string }>('/api/insights', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        websiteId: FIXTURE_SITE,
        name: 'Temp',
        type: 'trend',
        query: { version: 2, series: [{ kind: 'event', event: 'signup', math: 'total' }] },
      }),
    });
    await env.DB.prepare(`DELETE FROM insight_alert WHERE website_id = ?1 AND condition = 'value_above' AND threshold = 1000`)
      .bind(FIXTURE_SITE)
      .run();
    const alert = await fetchWorkerJson<{ id: string }>(`/api/insights/${created.body.id}/alerts`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ name: 'x', condition: 'value_above', threshold: 0, channel: 'email', target: 'a@b.co' }),
    });
    expect(alert.response.status).toBe(201);
    await evaluateInsightAlert(testEnv, (await getInsightAlert(testEnv, created.body.id, alert.body.id))!, NOW);
    const deleted = await fetchWorker(`/api/insights/${created.body.id}`, { method: 'DELETE', headers: await headers() });
    expect(deleted.status).toBe(200);
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM insight_alert WHERE alert_id = ?1) + (SELECT COUNT(*) FROM insight_alert_check WHERE alert_id = ?1) AS n`,
    )
      .bind(alert.body.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
