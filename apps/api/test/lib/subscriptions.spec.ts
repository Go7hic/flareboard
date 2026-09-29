import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { formatDelta, runDueSubscriptions } from '../../src/lib/subscriptions';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { DAY, DAY0, FIXTURE_SITE, seedInsightFixture } from '../helpers/insight-fixture';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const HOUR = 3_600_000;
/** Daily slot on day 1 at 08:00 UTC: covers day 0 (4 signups) against day -1 (1 signup). */
const SLOT = DAY0 + DAY + 8 * HOUR;

async function headers() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type Sent = { to: string; subject: string; text: string; html: string };

function envWithOutbox() {
  const outbox: Sent[] = [];
  const binding = { send: async (message: Sent) => void outbox.push(message) };
  return { env: { ...(env as unknown as Env), EMAIL: binding } as unknown as Env, outbox };
}

let insightId = '';

async function subscribe(body: Record<string, unknown>) {
  return fetchWorkerJson<{ id: string; nextRunAt: number; recipients: string[]; message?: string }>('/api/subscriptions', {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ targetType: 'insight', targetId: insightId, frequency: 'daily', hour: 8, ...body }),
  });
}

async function setNextRun(id: string, at: number) {
  await env.DB.prepare(`UPDATE report_subscription SET next_run_at = ?2 WHERE subscription_id = ?1`).bind(id, at).run();
}

describe('report subscriptions', () => {
  beforeAll(async () => {
    await seedInsightFixture();
    const created = await fetchWorkerJson<{ id: string }>('/api/insights', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        websiteId: FIXTURE_SITE,
        name: 'Signups <script>',
        type: 'trend',
        query: { version: 2, interval: 'day', series: [{ kind: 'event', event: 'signup', math: 'total', label: 'Signups' }] },
      }),
    });
    insightId = created.body.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare(`UPDATE report_subscription SET enabled = 0`).run();
  });

  it('validates recipients and schedules the first send', async () => {
    expect((await subscribe({ recipients: [] })).response.status).toBe(400);
    expect((await subscribe({ recipients: ['not-an-email'] })).response.status).toBe(400);
    expect((await subscribe({ recipients: Array.from({ length: 11 }, (_, i) => `u${i}@example.com`) })).response.status).toBe(400);

    const before = Date.now();
    const created = await subscribe({ recipients: ['Team@Example.com'], hour: 9 });
    expect(created.response.status).toBe(201);
    expect(created.body.recipients).toEqual(['team@example.com']);
    expect(created.body.nextRunAt).toBeGreaterThan(before);
    expect(new Date(created.body.nextRunAt).getUTCHours()).toBe(9);
    expect(created.body.nextRunAt - before).toBeLessThanOrEqual(DAY);

    const listed = await fetchWorkerJson<Array<{ id: string }>>(`/api/subscriptions?targetType=insight&targetId=${insightId}`, {
      headers: await headers(),
    });
    expect(listed.body.some((row) => row.id === created.body.id)).toBe(true);

    const weekly = await fetchWorkerJson<{ nextRunAt: number; frequency: string }>(`/api/subscriptions/${created.body.id}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ frequency: 'weekly', weekday: 3 }),
    });
    expect(weekly.body.frequency).toBe('weekly');
    expect(new Date(weekly.body.nextRunAt).getUTCDay()).toBe(3);

    const removed = await fetchWorker(`/api/subscriptions/${created.body.id}`, { method: 'DELETE', headers: await headers() });
    expect(removed.status).toBe(200);
  });

  it('sends a due summary once per slot with values and deltas, and reschedules', async () => {
    const created = await subscribe({ recipients: ['a@example.com', 'b@example.com'] });
    await setNextRun(created.body.id, SLOT);
    const { env: mailEnv, outbox } = envWithOutbox();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));

    const first = await runDueSubscriptions(mailEnv, SLOT + 60_000);
    expect(first).toMatchObject({ sent: 1, failed: 0 });
    expect(outbox.map((m) => m.to).sort()).toEqual(['a@example.com', 'b@example.com']);
    const mail = outbox[0]!;
    expect(mail.subject).toContain('Daily summary');
    expect(mail.text).toContain('Signups: 4 (+300% vs previous day)');
    expect(mail.html).toContain('Signups &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');

    // A second (overlapping or later) tick does not resend the same slot.
    const second = await runDueSubscriptions(mailEnv, SLOT + 120_000);
    expect(second.sent).toBe(0);
    expect(outbox).toHaveLength(2);

    const row = await env.DB.prepare(`SELECT next_run_at as nextRunAt, last_sent_at as lastSentAt FROM report_subscription WHERE subscription_id = ?1`)
      .bind(created.body.id)
      .first<{ nextRunAt: number; lastSentAt: number }>();
    expect(row?.nextRunAt).toBe(SLOT + DAY);
    expect(row?.lastSentAt).toBe(SLOT + 60_000);

    // Neither recipients nor summary content reach the logs.
    const logged = logs.join('\n');
    expect(logged).not.toContain('a@example.com');
    expect(logged).not.toContain('Signups');
  });

  it('summarizes board widgets with board filters applied', async () => {
    const board = await fetchWorkerJson<{ id: string }>('/api/boards', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        name: 'Weekly board',
        parameters: {
          filters: [{ type: 'person', key: 'plan', operator: 'is', value: ['pro'] }],
          widgets: [{ type: 'insight', insightId, label: 'Pro signups' }],
        },
      }),
    });
    const created = await fetchWorkerJson<{ id: string }>('/api/subscriptions', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ targetType: 'board', targetId: board.body.id, frequency: 'daily', recipients: ['c@example.com'] }),
    });
    expect(created.response.status).toBe(201);
    await setNextRun(created.body.id, SLOT);
    const { env: mailEnv, outbox } = envWithOutbox();
    await runDueSubscriptions(mailEnv, SLOT + 1);
    expect(outbox).toHaveLength(1);
    // Day 0 pro signups: alice and carol.
    expect(outbox[0]?.text).toContain('Pro signups');
    expect(outbox[0]?.text).toContain('Signups: 2');
  });

  it('records why a summary could not be sent without sending', async () => {
    const created = await subscribe({ recipients: ['d@example.com'] });
    await setNextRun(created.body.id, SLOT);
    await env.DB.prepare(`UPDATE report_subscription SET target_id = ?2 WHERE subscription_id = ?1`)
      .bind(created.body.id, '00000000-0000-4000-8000-00000000dead')
      .run();
    const { env: mailEnv, outbox } = envWithOutbox();
    const result = await runDueSubscriptions(mailEnv, SLOT + 1);
    expect(result.skipped).toBe(1);
    expect(outbox).toHaveLength(0);
    const row = await env.DB.prepare(`SELECT last_error as lastError FROM report_subscription WHERE subscription_id = ?1`)
      .bind(created.body.id)
      .first<{ lastError: string }>();
    expect(row?.lastError).toBe('Insight no longer exists');
  });

  it('formats deltas', () => {
    expect(formatDelta(4, 1)).toBe('+300%');
    expect(formatDelta(1, 4)).toBe('-75%');
    expect(formatDelta(3, 0)).toBe('new');
    expect(formatDelta(3, null)).toBe('');
  });
});
