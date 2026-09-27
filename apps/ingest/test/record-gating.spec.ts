import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerJson } from './helpers/fetch-worker';

function record(chunkIndex: number) {
  return fetchWorkerJson<{ ok: boolean; skipped?: boolean; replayId?: string }>('/api/record', {
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
        visitId: 'replay-visit',
        chunkIndex,
        events: [{ type: 2, data: {}, timestamp: 1 }],
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
      },
    }),
  });
}

describe('replay recording gate', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('skips chunks for websites that have not enabled replay', async () => {
    await env.DB.prepare('UPDATE website SET replay_enabled = 0 WHERE website_id = ?1').bind(TEST_WEBSITE_ID).run();
    const { body } = await record(0);
    expect(body).toEqual({ ok: true, skipped: true });
  });

  it('stores chunks once replay is enabled', async () => {
    await env.DB.prepare('UPDATE website SET replay_enabled = 1 WHERE website_id = ?1').bind(TEST_WEBSITE_ID).run();
    const { body } = await record(1);
    expect(body.ok).toBe(true);
    expect(body.skipped).toBeUndefined();
    expect(body.replayId).toBeTruthy();
  });
});
