import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getAggregateMetricsForWebsites, getDashboardMetricsByWebsite } from '../../src/lib/queries';
import { getWebsiteStatsFromRollups } from '../../src/lib/rollups';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const DAY = 86_400_000;
const END = Date.UTC(2026, 5, 30, 23, 59, 59, 999);
const START = Date.UTC(2026, 0, 1);

describe('queries stay under D1’s 100 bound-parameter limit', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('param-limit-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, START + DAY)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type)
       VALUES ('param-limit-event', ?1, 'param-limit-session', 'param-limit-visit', ?2, '/', ?3)`,
    )
      .bind(TEST_WEBSITE_ID, START + DAY, EVENT_TYPE.pageView)
      .run();
  });

  it('ranks 120 sites without exceeding the limit', async () => {
    const ids = [TEST_WEBSITE_ID, ...Array.from({ length: 119 }, (_, i) => `param-limit-site-${i}`)];
    const metrics = await getDashboardMetricsByWebsite(env, ids, START, END);
    expect(metrics.find((m) => m.websiteId === TEST_WEBSITE_ID)?.pageviews).toBe(1);

    const series = await getAggregateMetricsForWebsites(env, ids, START, END, 'day');
    expect(series.pageviews.reduce((sum, p) => sum + p.y, 0)).toBe(1);
  });

  it('checks rollups for a 181-day range', async () => {
    await expect(getWebsiteStatsFromRollups(env, TEST_WEBSITE_ID, START, END)).resolves.toBeNull();
  });
});
