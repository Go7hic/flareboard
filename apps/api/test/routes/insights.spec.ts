import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 22, 12);
const DAY = 24 * 60 * 60 * 1000;

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function insertSession(id: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, browser, country, created_at)
     VALUES (?1, ?2, ?3, 'Chrome', 'US', ?4)`,
  )
    .bind(id, TEST_WEBSITE_ID, `user-${id}`, createdAt)
    .run();
}

async function insertEvent(id: string, sessionId: string, eventName: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/app', ?5, ?6)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.customEvent, eventName)
    .run();
}

describe('insights routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertSession('insight-route-session', BASE);
    await insertEvent('insight-route-event', 'insight-route-session', 'signup', BASE + 100);
  });

  it('creates, lists, runs, previews, updates, and deletes insights', async () => {
    const created = await fetchWorkerJson<{
      id: string;
      name: string;
      type: string;
      query: { event: string };
    }>('/api/insights', {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        websiteId: TEST_WEBSITE_ID,
        name: 'Signup trend',
        type: 'trend',
        query: { metric: 'events', event: 'signup', unit: 'day' },
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        name: 'Signup trend',
        type: 'trend',
        query: expect.objectContaining({ event: 'signup' }),
      }),
    );

    const list = await fetchWorkerJson<Array<{ id: string; name: string }>>(
      `/api/insights?websiteId=${TEST_WEBSITE_ID}`,
      { headers: await authHeader() },
    );
    expect(list.response.status).toBe(200);
    expect(list.body.some((row) => row.id === created.body.id)).toBe(true);

    const run = await fetchWorkerJson<{ insight: { id: string }; data: { kind: string } }>(
      `/api/insights/${created.body.id}/run?startAt=${BASE}&endAt=${BASE + DAY * 2}`,
      { headers: await authHeader() },
    );
    expect(run.response.status).toBe(200);
    expect(run.body.data).toMatchObject({ kind: 'trend' });

    const preview = await fetchWorkerJson<{ data: { kind: string }; startAt: number; endAt: number }>(
      `/api/insights/preview?websiteId=${TEST_WEBSITE_ID}&startAt=${BASE}&endAt=${BASE + DAY * 2}`,
      {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({
          type: 'trend',
          query: { metric: 'events', event: 'signup', unit: 'day' },
        }),
      },
    );
    expect(preview.response.status).toBe(200);
    expect(preview.body.data).toMatchObject({ kind: 'trend' });

    const updated = await fetchWorkerJson<{ name: string }>(`/api/insights/${created.body.id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Signup trend v2' }),
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.name).toBe('Signup trend v2');

    const deleted = await fetchWorkerJson<{ ok: boolean }>(`/api/insights/${created.body.id}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
  });
});
