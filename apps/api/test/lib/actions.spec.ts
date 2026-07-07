import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getActionSummary } from '../../src/lib/actions';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 14, 12);

async function insertSession(id: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(id, TEST_WEBSITE_ID, createdAt)
    .run();
}

async function insertEvent(
  id: string,
  sessionId: string,
  eventName: string | null,
  path: string,
  eventType: number,
  createdAt: number,
) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, path, eventType, eventName)
    .run();
}

async function insertEventProperty(eventId: string, key: string, value: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
  )
    .bind(`${eventId}-${key}`, TEST_WEBSITE_ID, eventId, key, value, createdAt)
    .run();
}

describe('action query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('summarizes events matching event, path, and property rules', async () => {
    await insertSession('action-session-a', BASE);
    await insertSession('action-session-b', BASE + 1000);
    await insertEvent('action-event-1', 'action-session-a', 'checkout_started', '/pricing', EVENT_TYPE.customEvent, BASE + 100);
    await insertEvent('action-event-2', 'action-session-b', 'checkout_started', '/checkout', EVENT_TYPE.customEvent, BASE + 200);
    await insertEvent('action-event-3', 'action-session-b', 'signup_completed', '/signup', EVENT_TYPE.customEvent, BASE + 300);
    await insertEventProperty('action-event-1', 'plan', 'pro', BASE + 100);
    await insertEventProperty('action-event-2', 'plan', 'free', BASE + 200);

    const summary = await getActionSummary(
      env,
      TEST_WEBSITE_ID,
      [
        { field: 'event_name', operator: 'equals', value: 'checkout_started' },
        { field: 'property', key: 'plan', operator: 'equals', value: 'pro' },
      ],
      BASE,
      BASE + 1000,
    );

    expect(summary).toMatchObject({
      events: 1,
      sessions: 1,
      visits: 1,
      firstSeenAt: BASE + 100,
      lastSeenAt: BASE + 100,
      trend: [{ date: '2026-01-14', events: 1, sessions: 1 }],
      paths: [expect.objectContaining({ path: '/pricing', events: 1, sessions: 1 })],
      recent: [expect.objectContaining({ id: 'action-event-1', eventName: 'checkout_started' })],
    });
  });

  it('can define page-view based actions without an event name', async () => {
    await insertEvent('action-pageview-1', 'action-session-a', null, '/pricing', EVENT_TYPE.pageView, BASE + 400);

    const summary = await getActionSummary(
      env,
      TEST_WEBSITE_ID,
      [{ field: 'url_path', operator: 'contains', value: 'pricing' }],
      BASE,
      BASE + 1000,
    );

    expect(summary.events).toBeGreaterThanOrEqual(2);
    expect(summary.paths.map((row) => row.path)).toContain('/pricing');
  });
});
