import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_DOCS_WEBSITE_ID, EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { getRealtime } from '../../src/lib/queries';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const testEnv = env as unknown as Env;
const MIN = 60_000;

async function event(websiteId: string, id: string, session: string, at: number, path: string, type: number = EVENT_TYPE.pageView) {
  await testSiteDb(websiteId)
    .prepare(
      `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, referrer_domain, event_type)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(id, websiteId, session, at, path, type === EVENT_TYPE.pageView ? 'google.com' : null, type)
    .run();
}

const pageview = (websiteId: string, id: string, session: string, at: number, path: string) =>
  event(websiteId, id, session, at, path);

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

  it('reads every other website from its store the same way', async () => {
    const data = await getRealtime(testEnv, TEST_WEBSITE_ID);
    expect(data.visitors).toBe(1);
    expect(data.sessions.map((row) => [row.sessionId, row.urlPath, row.country])).toEqual([['rt-real', '/', null]]);
    expect(data.window30.pageviews).toBe(1);
  });

  it('counts a session active on any event and shows its latest pageview', async () => {
    const site = 'realtime-rules-site';
    const now = Date.now();
    await testSiteDb(site)
      .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, country, created_at) VALUES ('s1', ?1, 'DE', ?2)`)
      .bind(site, now - 30 * MIN)
      .run();
    // s1: last pageview before the window, kept active by a custom event.
    await event(site, 's1-pv', 's1', now - 20 * MIN, '/a');
    await event(site, 's1-ev', 's1', now - 1 * MIN, '/a', EVENT_TYPE.customEvent);
    // s2: a Web Vitals report only, no pageview.
    await event(site, 's2-perf', 's2', now - 2 * MIN, '/x', EVENT_TYPE.performance);
    // s3: two pageviews in the window; the latest one wins.
    await event(site, 's3-pv1', 's3', now - 3 * MIN, '/b');
    await event(site, 's3-pv2', 's3', now - MIN / 2, '/c');
    // s4 is too old, s5 is dated ahead of now.
    await event(site, 's4-err', 's4', now - 6 * MIN, '/', EVENT_TYPE.error);
    await event(site, 's5-pv', 's5', now + 10 * MIN, '/later');

    const data = await getRealtime(testEnv, site);
    expect(data.visitors).toBe(3);
    expect(data.sessions.map((row) => [row.sessionId, row.urlPath, row.referrerDomain, row.country])).toEqual([
      ['s3', '/c', 'google.com', null],
      ['s1', '/a', 'google.com', 'DE'],
      ['s2', '', null, null],
    ]);
  });
});
