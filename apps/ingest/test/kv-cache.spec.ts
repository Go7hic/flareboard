import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { applyTestMigrations, seedTestWebsite, TEST_USER_ID } from './helpers/migrations';
import { fetchWorkerWithEnv, recordingQueue } from './helpers/queue';

// A website no other test warms, so its settings are not already memoized in this isolate.
const SITE = '00000000-0000-0000-0000-0000000000c7';

/** KV past the Workers Free allowance: every read and write throws. */
const failingKv = {
  async get() {
    throw new Error('KV get() limit exceeded for the day.');
  },
  async put() {
    throw new Error('KV put() limit exceeded for the day.');
  },
};

describe('KV unavailable', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'KV site', 'kv.example.com', ?2, ?3, ?3)`,
    )
      .bind(SITE, TEST_USER_ID, Date.now())
      .run();
  });

  it('still accepts events, reading what it would cache from D1', async () => {
    const recording = recordingQueue();
    const response = await fetchWorkerWithEnv(
      '/api/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'event', payload: { website: SITE, hostname: 'kv.example.com', url: '/pricing' } }),
      },
      { CACHE: failingKv, EVENT_QUEUE: recording.queue, HOSTED_MODE: 'true' },
    );
    expect(response.status).toBe(200);
    expect(recording.events().map((m) => [m.data.urlPath, m.data.eventType])).toEqual([['/pricing', EVENT_TYPE.pageView]]);
  });

  it('still serves the tracker config', async () => {
    const response = await fetchWorkerWithEnv(`/api/tracker-config?website=${SITE}`, undefined, { CACHE: failingKv });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { websiteId: string }).websiteId).toBe(SITE);
  });
});
