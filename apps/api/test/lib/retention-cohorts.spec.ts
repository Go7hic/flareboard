import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getRetentionReport } from '../../src/lib/advanced-reports';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

// Monday 2026-03-02; the cohort week should be Sunday 2026-03-01.
const FIRST_VISIT = Date.UTC(2026, 2, 2, 10);
const DAY = 86_400_000;

describe('retention cohorts', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await testSiteDb(TEST_WEBSITE_ID).prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('retention-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, FIRST_VISIT)
      .run();
    // Same day (week 0), five days later (still week 0), eight days later (week 1).
    for (const [i, offset] of [0, 5 * DAY, 8 * DAY].entries()) {
      await testSiteDb(TEST_WEBSITE_ID).prepare(
        `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type)
         VALUES (?1, ?2, 'retention-session', ?1, ?3, '/', ?4)`,
      )
        .bind(`retention-event-${i}`, TEST_WEBSITE_ID, FIRST_VISIT + offset, EVENT_TYPE.pageView)
        .run();
    }
  });

  it('starts each cohort on the Sunday on or before the first visit', async () => {
    const report = await getRetentionReport(env, TEST_WEBSITE_ID, FIRST_VISIT - DAY, FIRST_VISIT + 20 * DAY);
    const rows = report.cohorts.filter((row) => row.users > 0);
    expect(rows).toEqual([
      { cohortWeek: '2026-03-01', weekOffset: 0, users: 1 },
      { cohortWeek: '2026-03-01', weekOffset: 1, users: 1 },
    ]);
  });
});
