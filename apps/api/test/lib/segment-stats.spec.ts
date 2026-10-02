import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { getCohortSizeOverTime, resolveCohortMemberJoin } from '../../src/lib/cohorts';
import { getUtmReport } from '../../src/lib/queries';
import { getMetricsFiltered, getWebsiteStatsFiltered } from '../../src/lib/segment-stats';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const testEnv = env as unknown as Env;
const DAY = 86_400_000;
const START = Date.UTC(2025, 3, 7);
const END = START + 7 * DAY - 1;
const COHORT_ID = 'segment-stats-signed-up';

// Three sessions in the website store (not the shared D1): two land on /pricing from the
// newsletter, one of them signs up; the third reads the docs and bounces.
const EVENTS: Array<[session: string, minutes: number, path: string, utm: string | null, name: string | null]> = [
  ['seg-a', 0, '/pricing', 'newsletter', null],
  ['seg-a', 3, '/signup', null, null],
  ['seg-a', 4, '/signup', null, 'signed_up'],
  ['seg-b', 60, '/pricing', 'newsletter', null],
  ['seg-b', 62, '/docs', null, null],
  ['seg-c', 120, '/docs', null, null],
];

describe('filtered reports read the website store', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    const site = testSiteDb(TEST_WEBSITE_ID);
    for (const session of ['seg-a', 'seg-b', 'seg-c']) {
      await site
        .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, created_at, country) VALUES (?1, ?2, ?3, 'DE')`)
        .bind(session, TEST_WEBSITE_ID, START)
        .run();
    }
    for (const [i, [session, minutes, path, utm, name]] of EVENTS.entries()) {
      await site
        .prepare(
          `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, utm_source, event_type, event_name)
           VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(
          `seg-event-${i}`,
          TEST_WEBSITE_ID,
          session,
          START + DAY + minutes * 60_000,
          path,
          utm,
          name ? EVENT_TYPE.customEvent : EVENT_TYPE.pageView,
          name,
        )
        .run();
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO cohort (cohort_id, website_id, name, type, value, definition, created_at, updated_at)
       VALUES (?1, ?2, 'Signed up', 'event', 'signed_up', ?3, ?4, ?4)`,
    )
      .bind(COHORT_ID, TEST_WEBSITE_ID, JSON.stringify({ conditions: [{ field: 'event_name', operator: 'equals', value: 'signed_up' }] }), START)
      .run();
  });

  it('counts a path segment, including bounces', async () => {
    const stats = await getWebsiteStatsFiltered(testEnv, TEST_WEBSITE_ID, START, END, { path: '/pricing' });
    expect(stats.pageviews.value).toBe(2);
    expect(stats.visitors.value).toBe(2);
    expect(stats.visits.value).toBe(2);
    // Bounces count sessions with a single matching pageview.
    expect(stats.bounces.value).toBe(2);

    const docs = await getWebsiteStatsFiltered(testEnv, TEST_WEBSITE_ID, START, END, { path: '/docs' });
    expect(docs.pageviews.value).toBe(2);
  });

  it('filters by cohort members (cohort parameters come before the report parameters)', async () => {
    const join = await resolveCohortMemberJoin(testEnv, TEST_WEBSITE_ID, COHORT_ID);
    expect(join?.totalMembers).toBe(1);
    const stats = await getWebsiteStatsFiltered(testEnv, TEST_WEBSITE_ID, START, END, null, join);
    expect(stats.pageviews.value).toBe(2);
    expect(stats.visitors.value).toBe(1);
    expect(stats.bounces.value).toBe(0);
    const pages = await getMetricsFiltered(testEnv, TEST_WEBSITE_ID, START, END, 'url', 10, null, join);
    expect([...pages].sort((a, b) => a.x.localeCompare(b.x))).toEqual([
      { x: '/pricing', y: 1 },
      { x: '/signup', y: 1 },
    ]);
  });

  it('builds the cohort size series', async () => {
    const result = await getCohortSizeOverTime(
      testEnv,
      { cohortId: COHORT_ID, websiteId: TEST_WEBSITE_ID, name: 'Signed up', definition: { conditions: [{ field: 'event_name', operator: 'equals', value: 'signed_up' }] } },
      START,
      END,
    );
    expect(result.totalUsers).toBe(1);
    expect(result.series).toEqual([{ bucket: '2025-04-08', users: 1 }]);
  });

  it('breaks pageviews down by UTM source', async () => {
    const report = await getUtmReport(testEnv, TEST_WEBSITE_ID, START, END);
    expect(report.source).toEqual([
      { name: '(direct)', pageviews: 3 },
      { name: 'newsletter', pageviews: 2 },
    ]);
  });
});
