import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerJson } from './helpers/fetch-worker';
import { testSiteDb } from './helpers/site-db';

const FULL_SNAPSHOT = { type: 2, data: {}, timestamp: 1 };

function record(chunkIndex: number, events: unknown[] = [FULL_SNAPSHOT], visitId = 'replay-visit') {
  return fetchWorkerJson<{ ok: boolean; skipped?: boolean; replayId?: string; r2Key?: string | null }>('/api/record', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': '192.0.2.80',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    },
    body: JSON.stringify({
      type: 'record',
      payload: {
        website: TEST_WEBSITE_ID,
        sessionId: 'replay-session',
        visitId,
        chunkIndex,
        events,
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
      },
    }),
  });
}

async function setReplayConfig(config: Record<string, unknown>) {
  await env.DB.prepare('UPDATE website SET replay_enabled = 1, replay_config = ?2 WHERE website_id = ?1')
    .bind(TEST_WEBSITE_ID, JSON.stringify(config))
    .run();
  await env.CACHE.delete(`website:${TEST_WEBSITE_ID}`);
}

const ACTIVITY = [
  FULL_SNAPSHOT,
  { type: 3, data: { source: 2, type: 2, id: 1, x: 0, y: 0 }, timestamp: 2 },
  { type: 3, data: { source: 2, type: 2, id: 1, x: 0, y: 0 }, timestamp: 3 },
  { type: 3, data: { source: 5, id: 3, text: '***' }, timestamp: 4 },
  { type: 5, data: { tag: '$console', payload: { level: 'error', message: 'boom', stack: 'at x' } }, timestamp: 5 },
  { type: 5, data: { tag: '$console', payload: { level: 'warn', message: 'hm' } }, timestamp: 6 },
  {
    type: 5,
    data: { tag: '$network', payload: { method: 'GET', url: '/api/cart?id=1', status: 500, headers: { a: 'b' } } },
    timestamp: 7,
  },
];

describe('replay recording gate', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('skips chunks for websites that have not enabled replay', async () => {
    await env.DB.prepare('UPDATE website SET replay_enabled = 0 WHERE website_id = ?1').bind(TEST_WEBSITE_ID).run();
    await env.CACHE.delete(`website:${TEST_WEBSITE_ID}`);
    const { body } = await record(0);
    expect(body).toEqual({ ok: true, skipped: true });
  });

  it('stores chunks once replay is enabled', async () => {
    await env.DB.prepare('UPDATE website SET replay_enabled = 1 WHERE website_id = ?1').bind(TEST_WEBSITE_ID).run();
    await env.CACHE.delete(`website:${TEST_WEBSITE_ID}`);
    const { body } = await record(1);
    expect(body.ok).toBe(true);
    expect(body.skipped).toBeUndefined();
    expect(body.replayId).toBeTruthy();
  });

  it('drops console and network entries the website did not opt in to, and counts activity', async () => {
    await setReplayConfig({ maskInputs: true });
    const { body } = await record(0, ACTIVITY, 'visit-no-capture');
    expect(body.r2Key).toBe(`${TEST_WEBSITE_ID}/visit-no-capture/0`);
    const stored = (await (await env.REPLAY_BUCKET!.get(body.r2Key!))!.json()) as Array<{ type: number }>;
    expect(stored.map((event) => event.type)).toEqual([2, 3, 3, 3]);

    const summary = await testSiteDb(TEST_WEBSITE_ID).prepare(
      `SELECT event_count AS eventCount, click_count AS clicks, input_count AS inputs,
              console_error_count AS consoleErrors, network_error_count AS networkErrors
       FROM session_replay_summary WHERE website_id = ?1 AND visit_id = 'visit-no-capture'`,
    )
      .bind(TEST_WEBSITE_ID)
      .first();
    expect(summary).toEqual({ eventCount: 4, clicks: 2, inputs: 1, consoleErrors: 0, networkErrors: 0 });
  });

  it('keeps allowlisted console and network fields when opted in and sums counters per visit', async () => {
    await setReplayConfig({ captureConsole: true, captureNetwork: true });
    const first = await record(0, ACTIVITY, 'visit-capture');
    await record(1, ACTIVITY.slice(4), 'visit-capture');
    const stored = (await (await env.REPLAY_BUCKET!.get(first.body.r2Key!))!.json()) as Array<{
      type: number;
      data: { tag?: string; payload?: unknown };
    }>;
    expect(stored.filter((event) => event.type === 5).map((event) => event.data.payload)).toEqual([
      { level: 'error', message: 'boom' },
      { level: 'warn', message: 'hm' },
      { method: 'GET', url: '/api/cart', status: 500, duration: null, size: null, failed: false },
    ]);

    const summary = await testSiteDb(TEST_WEBSITE_ID).prepare(
      `SELECT chunks, click_count AS clicks, console_error_count AS consoleErrors,
              console_warn_count AS consoleWarns, network_error_count AS networkErrors
       FROM session_replay_summary WHERE website_id = ?1 AND visit_id = 'visit-capture'`,
    )
      .bind(TEST_WEBSITE_ID)
      .first();
    expect(summary).toEqual({ chunks: 2, clicks: 2, consoleErrors: 2, consoleWarns: 2, networkErrors: 2 });
  });
});
