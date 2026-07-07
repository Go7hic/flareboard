import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getStickinessReport } from '../../src/lib/advanced-reports';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 20, 12);
const DAY = 24 * 60 * 60 * 1000;

async function insertSession(id: string, distinctId: string | null, createdAt: number) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, TEST_WEBSITE_ID, distinctId, createdAt)
    .run();
}

async function insertEvent(id: string, sessionId: string, eventName: string | null, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/app', ?5, ?6)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, eventName ? EVENT_TYPE.customEvent : EVENT_TYPE.pageView, eventName)
    .run();
}

describe('stickiness report', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('groups people by number of active days for a selected event', async () => {
    await insertSession('sticky-session-a1', 'user-a', BASE);
    await insertSession('sticky-session-a2', 'user-a', BASE + DAY);
    await insertSession('sticky-session-b1', 'user-b', BASE);
    await insertEvent('sticky-a-1', 'sticky-session-a1', 'checkout_started', BASE + 100);
    await insertEvent('sticky-a-2', 'sticky-session-a2', 'checkout_started', BASE + DAY + 100);
    await insertEvent('sticky-b-1', 'sticky-session-b1', 'checkout_started', BASE + 200);
    await insertEvent('sticky-ignore', 'sticky-session-b1', 'signup_completed', BASE + DAY + 300);

    const report = await getStickinessReport(
      env,
      TEST_WEBSITE_ID,
      BASE,
      BASE + DAY * 2,
      'checkout_started',
      'person',
    );

    expect(report).toMatchObject({
      event: 'checkout_started',
      actor: 'person',
      totalActors: 2,
      actorDays: 3,
      averageActiveDays: 1.5,
      distribution: [
        { activeDays: 1, actors: 1, events: 1, percentage: 50 },
        { activeDays: 2, actors: 1, events: 2, percentage: 50 },
      ],
    });
  });

  it('can calculate stickiness by session for all activity', async () => {
    const report = await getStickinessReport(
      env,
      TEST_WEBSITE_ID,
      BASE,
      BASE + DAY * 2,
      null,
      'session',
    );

    expect(report.actor).toBe('session');
    expect(report.totalActors).toBeGreaterThanOrEqual(3);
    expect(report.distribution.length).toBeGreaterThan(0);
  });
});
