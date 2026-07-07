import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getEventCatalog, getEventCatalogDetail } from '../../src/lib/event-catalog';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 12, 12);

async function insertSession(id: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(id, TEST_WEBSITE_ID, createdAt)
    .run();
}

async function insertEvent(id: string, sessionId: string, eventName: string, path: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, path, EVENT_TYPE.customEvent, eventName)
    .run();
}

async function insertEventProperty(eventId: string, key: string, value: string | number, createdAt: number) {
  const isNumber = typeof value === 'number';
  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      `${eventId}-${key}-${String(value)}`,
      TEST_WEBSITE_ID,
      eventId,
      key,
      isNumber ? null : value,
      isNumber ? value : null,
      isNumber ? 2 : 1,
      createdAt,
    )
    .run();
}

describe('event catalog query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('lists custom events with properties, sessions, paths, and recency', async () => {
    await insertSession('event-catalog-session-a', BASE);
    await insertSession('event-catalog-session-b', BASE + 1000);
    await insertEvent('event-catalog-1', 'event-catalog-session-a', 'checkout_started', '/pricing', BASE + 100);
    await insertEvent('event-catalog-2', 'event-catalog-session-b', 'checkout_started', '/checkout', BASE + 200);
    await insertEvent('event-catalog-3', 'event-catalog-session-b', 'signup_completed', '/signup', BASE + 300);
    await insertEventProperty('event-catalog-1', 'plan', 'pro', BASE + 100);
    await insertEventProperty('event-catalog-2', 'plan', 'team', BASE + 200);
    await insertEventProperty('event-catalog-2', 'amount', 29, BASE + 200);

    const events = await getEventCatalog(env, TEST_WEBSITE_ID, BASE, BASE + 1000);

    expect(events[0]).toMatchObject({
      eventName: 'signup_completed',
      events: 1,
      sessions: 1,
      visits: 1,
      paths: 1,
      propertyCount: 0,
      propertyKeys: [],
      firstSeenAt: BASE + 300,
      lastSeenAt: BASE + 300,
    });
    expect(events[1]).toMatchObject({
      eventName: 'checkout_started',
      events: 2,
      sessions: 2,
      visits: 2,
      paths: 2,
      propertyCount: 2,
      propertyKeys: ['amount', 'plan'],
      firstSeenAt: BASE + 100,
      lastSeenAt: BASE + 200,
    });
  });

  it('returns detail for one event with properties, pages, and recent examples', async () => {
    const detail = await getEventCatalogDetail(
      env,
      TEST_WEBSITE_ID,
      'checkout_started',
      BASE,
      BASE + 1000,
    );

    expect(detail).toMatchObject({
      summary: {
        eventName: 'checkout_started',
        events: 2,
        sessions: 2,
        visits: 2,
      },
      properties: expect.arrayContaining([
        expect.objectContaining({ key: 'plan', count: 2, valuesCount: 2 }),
        expect.objectContaining({ key: 'amount', count: 1, valuesCount: 1 }),
      ]),
      paths: expect.arrayContaining([
        expect.objectContaining({ path: '/checkout', events: 1 }),
        expect.objectContaining({ path: '/pricing', events: 1 }),
      ]),
      recent: expect.arrayContaining([
        expect.objectContaining({ id: 'event-catalog-2', sessionId: 'event-catalog-session-b' }),
        expect.objectContaining({ id: 'event-catalog-1', sessionId: 'event-catalog-session-a' }),
      ]),
    });
  });

  it('filters event catalog by search text', async () => {
    const events = await getEventCatalog(env, TEST_WEBSITE_ID, BASE, BASE + 1000, {
      search: 'signup',
    });

    expect(events.map((event) => event.eventName)).toEqual(['signup_completed']);
  });
});
