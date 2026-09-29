import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getPageviews, getTrafficHeatmap } from '../../src/lib/queries';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

// Tokyo is UTC+9: 10:00Z is 19:00 on Mar 5 locally, 16:00Z is 01:00 on Mar 6.
const EVENING = Date.UTC(2026, 2, 5, 10);
const AFTER_MIDNIGHT = Date.UTC(2026, 2, 5, 16);
const RANGE_START = Date.UTC(2026, 2, 4, 15); // Mar 5 00:00 JST
const RANGE_END = Date.UTC(2026, 2, 6, 14, 59, 59, 999); // Mar 6 23:59 JST

describe('site timezone bucketing', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await testSiteDb(TEST_WEBSITE_ID).prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('tz-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, EVENING)
      .run();
    for (const [i, at] of [EVENING, AFTER_MIDNIGHT].entries()) {
      await testSiteDb(TEST_WEBSITE_ID).prepare(
        `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type)
         VALUES (?1, ?2, 'tz-session', ?1, ?3, '/', ?4)`,
      )
        .bind(`tz-event-${i}`, TEST_WEBSITE_ID, at, EVENT_TYPE.pageView)
        .run();
    }
  });

  it('buckets days by the site calendar', async () => {
    const { pageviews } = await getPageviews(env, TEST_WEBSITE_ID, RANGE_START, RANGE_END, 'day', 'Asia/Tokyo');
    expect(pageviews).toEqual([
      { x: '2026-03-05', y: 1 },
      { x: '2026-03-06', y: 1 },
    ]);
  });

  it('keeps UTC buckets for UTC sites', async () => {
    const { pageviews } = await getPageviews(env, TEST_WEBSITE_ID, RANGE_START, RANGE_END, 'day');
    expect(pageviews).toEqual([{ x: '2026-03-05', y: 2 }]);
  });

  it('puts heatmap cells at local weekday and hour', async () => {
    const { cells } = await getTrafficHeatmap(env, TEST_WEBSITE_ID, RANGE_START, RANGE_END, 'Asia/Tokyo');
    // Thu 19:00 and Fri 01:00 local.
    expect(cells.map((c) => [c.dow, c.hour]).sort()).toEqual([
      [4, 19],
      [5, 1],
    ]);
  });
});
