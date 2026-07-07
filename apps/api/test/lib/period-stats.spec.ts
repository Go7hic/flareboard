import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { queryPeriodStats } from '../../src/lib/period-stats';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 1, 1, 12);

describe('queryPeriodStats', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);

    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES ('period-s1', ?1, ?2), ('period-s2', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO website_event
        (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES
         ('period-e1', ?1, 'period-s1', 'period-v1', ?2, '/a', ?5, NULL),
         ('period-e2', ?1, 'period-s1', 'period-v1', ?3, '/b', ?5, NULL),
         ('period-e3', ?1, 'period-s2', 'period-v2', ?4, '/c', ?5, NULL)`,
    )
      .bind(TEST_WEBSITE_ID, BASE, BASE + 30_000, BASE + 60_000, EVENT_TYPE.pageView)
      .run();
  });

  it('aggregates pageviews, visitors, visits, bounces, and totaltime', async () => {
    const stats = await queryPeriodStats(env, TEST_WEBSITE_ID, BASE, BASE + 120_000);

    expect(stats.pageviews).toBe(3);
    expect(stats.visitors).toBe(2);
    expect(stats.visits).toBe(2);
    expect(stats.bounces).toBe(1);
    expect(stats.totaltime).toBeGreaterThanOrEqual(30);
  });
});
