import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getGroupDetail, listGroups, listGroupTypes } from '../../src/lib/groups';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 16, 12);

async function insertSession(id: string, distinctId: string | null, createdAt: number) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, browser, os, country, city, created_at)
     VALUES (?1, ?2, ?3, 'Chrome', 'macOS', 'US', 'Austin', ?4)`,
  )
    .bind(id, TEST_WEBSITE_ID, distinctId, createdAt)
    .run();
}

async function insertSessionData(id: string, sessionId: string, key: string, value: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO session_data (session_data_id, website_id, session_id, data_key, string_value, data_type, distinct_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, key, value, 'user-1', createdAt)
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

describe('group query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('lists group types and account-level activity', async () => {
    await insertSession('group-session-a', 'user-1', BASE);
    await insertSession('group-session-b', 'user-2', BASE + 1000);
    await insertSessionData('group-a-key', 'group-session-a', '$group/account', 'acme', BASE + 100);
    await insertSessionData('group-a-name', 'group-session-a', '$group/account/name', 'Acme Inc', BASE + 100);
    await insertSessionData('group-b-key', 'group-session-b', '$group/account', 'globex', BASE + 200);
    await insertEvent('group-event-1', 'group-session-a', null, EVENT_TYPE.pageView, BASE + 300);
    await insertEvent('group-event-2', 'group-session-a', 'checkout_started', EVENT_TYPE.customEvent, BASE + 400);
    await insertEvent('group-event-3', 'group-session-b', 'signup_completed', EVENT_TYPE.customEvent, BASE + 500);

    await expect(listGroupTypes(env, TEST_WEBSITE_ID)).resolves.toContain('account');

    const groups = await listGroups(env, TEST_WEBSITE_ID, 'account', BASE, BASE + 1000);

    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupKey: 'acme',
          latestName: 'Acme Inc',
          sessions: 1,
          people: 1,
          visits: 1,
          pageviews: 1,
          events: 1,
        }),
        expect.objectContaining({
          groupKey: 'globex',
          events: 1,
        }),
      ]),
    );
  });

  it('returns group detail with properties, sessions, and events', async () => {
    const detail = await getGroupDetail(env, TEST_WEBSITE_ID, 'account', 'acme');

    expect(detail).toMatchObject({
      groupType: 'account',
      groupKey: 'acme',
      properties: expect.arrayContaining([
        expect.objectContaining({ key: 'name', value: 'Acme Inc' }),
      ]),
      sessions: expect.arrayContaining([
        expect.objectContaining({ id: 'group-session-a', distinctId: 'user-1' }),
      ]),
      events: expect.arrayContaining([
        expect.objectContaining({ id: 'group-event-2', eventName: 'checkout_started' }),
        expect.objectContaining({ id: 'group-event-1', eventName: null }),
      ]),
    });
  });
});
