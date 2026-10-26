import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { countActiveVisitors } from '../src/lib/realtime';
import { testSiteDb } from './helpers/site-db';

const MIN = 60_000;

async function event(site: string, id: string, session: string, at: number, type: number = EVENT_TYPE.pageView) {
  await testSiteDb(site)
    .prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type)
       VALUES (?1, ?2, ?3, ?3, ?4, '/', ?5)`,
    )
    .bind(id, site, session, at, type)
    .run();
}

describe('realtime active visitors', () => {
  it('counts distinct sessions with any event in the last five minutes', async () => {
    const site = `rt-site-${crypto.randomUUID()}`;
    const now = Date.now();
    await event(site, 'a1', 'session-a', now - 4 * MIN);
    await event(site, 'a2', 'session-a', now - MIN);
    await event(site, 'b1', 'session-b', now - 2 * MIN, EVENT_TYPE.customEvent);
    await event(site, 'c1', 'session-c', now - 3 * MIN, EVENT_TYPE.performance);
    await event(site, 'old', 'session-old', now - 6 * MIN);
    await event(site, 'ahead', 'session-ahead', now + 10 * MIN);
    expect(await countActiveVisitors(env, site, now)).toBe(3);
  });

  it('ignores sessions last seen before the window', async () => {
    const site = `rt-site-${crypto.randomUUID()}`;
    const now = Date.now();
    await event(site, 'old', 'session-old', now);
    expect(await countActiveVisitors(env, site, now + 10 * MIN)).toBe(0);
  });
});
