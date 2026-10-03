import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_DOCS_WEBSITE_ID, EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { getRealtime } from '../../src/lib/queries';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const testEnv = env as unknown as Env;
const MIN = 60_000;

async function pageview(websiteId: string, id: string, session: string, at: number, path: string) {
  await testSiteDb(websiteId)
    .prepare(
      `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, referrer_domain, event_type)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, 'google.com', ?6)`,
    )
    .bind(id, websiteId, session, at, path, EVENT_TYPE.pageView)
    .run();
}

describe('realtime', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    const now = Date.now();
    const demo = testSiteDb(DEMO_DOCS_WEBSITE_ID);
    for (const [session, country] of [['rt-a', 'DE'], ['rt-b', 'JP'], ['rt-old', 'US']] as const) {
      await demo
        .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, country, created_at) VALUES (?1, ?2, ?3, ?4)`)
        .bind(session, DEMO_DOCS_WEBSITE_ID, country, now - 20 * MIN)
        .run();
    }
    await pageview(DEMO_DOCS_WEBSITE_ID, 'rt-a1', 'rt-a', now - 4 * MIN, '/docs');
    await pageview(DEMO_DOCS_WEBSITE_ID, 'rt-a2', 'rt-a', now - 1 * MIN, '/docs/api');
    await pageview(DEMO_DOCS_WEBSITE_ID, 'rt-b1', 'rt-b', now - 2 * MIN, '/pricing');
    // Outside the 5-minute window, and a future event the daily generator wrote ahead of time.
    await pageview(DEMO_DOCS_WEBSITE_ID, 'rt-old1', 'rt-old', now - 9 * MIN, '/');
    await pageview(DEMO_DOCS_WEBSITE_ID, 'rt-future', 'rt-old', now + 30 * MIN, '/later');
    await pageview(TEST_WEBSITE_ID, 'rt-real1', 'rt-real', now - MIN, '/');
  });

  it('reads demo websites from the store: sessions active in the last five minutes, latest page first', async () => {
    const data = await getRealtime(testEnv, DEMO_DOCS_WEBSITE_ID);
    expect(data.visitors).toBe(2);
    expect(data.sessions.map((row) => [row.sessionId, row.urlPath, row.country, row.referrerDomain])).toEqual([
      ['rt-a', '/docs/api', 'DE', 'google.com'],
      ['rt-b', '/pricing', 'JP', 'google.com'],
    ]);
  });

  it('keeps other websites on the KV keys that ingest writes', async () => {
    const data = await getRealtime(testEnv, TEST_WEBSITE_ID);
    expect(data.visitors).toBe(0);
    expect(data.sessions).toEqual([]);
    expect(data.window30.pageviews).toBe(1);
  });
});
