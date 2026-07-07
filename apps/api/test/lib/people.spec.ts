import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getPersonDetail, listPeople } from '../../src/lib/people';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 10, 12);

async function insertSession(id: string, distinctId: string | null, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO session (session_id, website_id, distinct_id, browser, os, country, city, created_at)
     VALUES (?1, ?2, ?3, 'Chrome', 'macOS', 'US', 'Austin', ?4)`,
  )
    .bind(id, TEST_WEBSITE_ID, distinctId, createdAt)
    .run();
}

async function insertEvent(id: string, sessionId: string, eventName: string | null, eventType: number, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/pricing', ?5, ?6)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, eventType, eventName)
    .run();
}

async function insertProperty(id: string, sessionId: string, key: string, value: string, distinctId: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO session_data (session_data_id, website_id, session_id, data_key, string_value, data_type, distinct_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, key, value, distinctId, createdAt)
    .run();
}

describe('people query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('lists identified people with sessions, properties, and recent activity', async () => {
    await insertSession('people-session-a', 'user-123', BASE);
    await insertSession('people-session-b', 'user-123', BASE + 1000);
    await insertProperty('people-prop-email', 'people-session-a', 'email', 'user@example.com', 'user-123', BASE + 100);
    await insertProperty('people-prop-name', 'people-session-b', 'name', 'Ada User', 'user-123', BASE + 1100);
    await insertEvent('people-pageview-a', 'people-session-a', null, EVENT_TYPE.pageView, BASE + 200);
    await insertEvent('people-event-a', 'people-session-a', 'signup', EVENT_TYPE.customEvent, BASE + 300);
    await insertEvent('people-event-b', 'people-session-b', 'purchase', EVENT_TYPE.customEvent, BASE + 1200);

    const people = await listPeople(env, TEST_WEBSITE_ID, BASE - 1000, BASE + 2000);

    expect(people[0]).toMatchObject({
      personId: 'user-123',
      latestEmail: 'user@example.com',
      latestName: 'Ada User',
      sessions: 2,
      visits: 2,
      pageviews: 1,
      events: 2,
      country: 'US',
      city: 'Austin',
    });

    const detail = await getPersonDetail(env, TEST_WEBSITE_ID, 'user-123');

    expect(detail).toMatchObject({
      personId: 'user-123',
      properties: expect.arrayContaining([
        expect.objectContaining({ key: 'email', value: 'user@example.com' }),
        expect.objectContaining({ key: 'name', value: 'Ada User' }),
      ]),
      sessions: expect.arrayContaining([
        expect.objectContaining({ id: 'people-session-a' }),
        expect.objectContaining({ id: 'people-session-b' }),
      ]),
      events: expect.arrayContaining([
        expect.objectContaining({ eventName: 'purchase', sessionId: 'people-session-b' }),
        expect.objectContaining({ eventName: 'signup', sessionId: 'people-session-a' }),
      ]),
    });
  });

  it('merges stored person profile properties with session properties', async () => {
    const { upsertPerson } = await import('@flareboard/db');
    await upsertPerson(env.DB, {
      websiteId: TEST_WEBSITE_ID,
      distinctId: 'user-123',
      properties: { title: 'Founder', email: 'stored@example.com' },
      seenAt: BASE + 1500,
    });

    const detail = await getPersonDetail(env, TEST_WEBSITE_ID, 'user-123');
    expect(detail?.profile).toMatchObject({
      distinctId: 'user-123',
      email: 'stored@example.com',
    });
    expect(detail?.properties.map((row) => row.key)).toEqual(expect.arrayContaining(['title', 'email', 'name']));
  });

  it('filters people by email or name', async () => {
    const people = await listPeople(env, TEST_WEBSITE_ID, BASE - 1000, BASE + 2000, 100, {
      search: 'ada',
    });

    expect(people.map((person) => person.personId)).toContain('user-123');
  });
});
