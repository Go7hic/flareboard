import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { FIXTURE_SITE, RANGE, seedInsightFixture } from '../helpers/insight-fixture';
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
        // Legacy queries are stored upgraded to v2.
        query: expect.objectContaining({ version: 2, series: [expect.objectContaining({ event: 'signup' })] }),
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

describe('insights v2 routes', () => {
  const range = `startAt=${RANGE.startAt}&endAt=${RANGE.endAt}`;

  beforeAll(seedInsightFixture);

  it('serves and runs rows saved in the legacy query shape', async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO insight (insight_id, website_id, user_id, type, name, description, query, created_at, updated_at)
       VALUES ('00000000-0000-4000-8000-0000000000a1', ?1, ?2, 'funnel', 'Old funnel', '', ?3, ?4, ?4)`,
    )
      .bind(FIXTURE_SITE, TEST_USER_ID, JSON.stringify({ events: ['signup', 'purchase'] }), now)
      .run();
    const got = await fetchWorkerJson<{ query: { version: number; funnel: { steps: unknown[] } } }>(
      '/api/insights/00000000-0000-4000-8000-0000000000a1',
      { headers: await authHeader() },
    );
    expect(got.body.query).toMatchObject({ version: 2, countBy: 'session', funnel: { steps: [{ event: 'signup' }, { event: 'purchase' }] } });

    const run = await fetchWorkerJson<{ data: { kind: string; steps: Array<{ count: number }> } }>(
      `/api/insights/00000000-0000-4000-8000-0000000000a1/run?${range}`,
      { headers: await authHeader() },
    );
    expect(run.body.data.steps.map((s) => s.count)).toEqual([6, 1]);

    // Dashboard-wide filters are merged in at run time.
    const filters = encodeURIComponent(JSON.stringify([{ type: 'person', key: 'plan', operator: 'is', value: 'pro' }]));
    const filtered = await fetchWorkerJson<{ data: { steps: Array<{ count: number }> } }>(
      `/api/insights/00000000-0000-4000-8000-0000000000a1/run?${range}&filters=${filters}`,
      { headers: await authHeader() },
    );
    expect(filtered.body.data.steps.map((s) => s.count)).toEqual([3, 1]);
  });

  it('answers 400 for invalid queries instead of failing', async () => {
    const response = await fetchWorker(`/api/insights/preview?websiteId=${FIXTURE_SITE}&${range}`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        type: 'trend',
        query: {
          version: 2,
          series: [{ kind: 'event', event: 'signup', filters: [{ type: 'event', key: 'x', operator: 'regex', value: '(a|b)' }] }],
        },
      }),
    });
    expect(response.status).toBe(400);

    const badFormula = await fetchWorker(`/api/insights`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        websiteId: FIXTURE_SITE,
        name: 'Bad',
        type: 'trend',
        query: { version: 2, series: [{ kind: 'event', event: 'signup' }], formula: 'A / B' },
      }),
    });
    expect(badFormula.status).toBe(400);
  });

  it('lists funnel actors and observed property keys and values', async () => {
    const actors = await fetchWorkerJson<{ total: number; actors: string[] }>(
      `/api/insights/funnel-actors?websiteId=${FIXTURE_SITE}&${range}`,
      {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({
          type: 'funnel',
          query: {
            version: 2,
            funnel: {
              steps: [
                { kind: 'event', event: 'signup' },
                { kind: 'event', event: 'purchase' },
              ],
              window: { value: 1, unit: 'hour' },
            },
          },
          step: 1,
          outcome: 'converted',
        }),
      },
    );
    expect(actors.response.status).toBe(200);
    expect(actors.body).toMatchObject({ total: 1, actors: ['alice'] });

    const eventKeys = await fetchWorkerJson<Array<{ key: string; numeric: boolean }>>(
      `/api/insights/property-keys?websiteId=${FIXTURE_SITE}&type=event&${range}`,
      { headers: await authHeader() },
    );
    expect(eventKeys.body).toEqual(expect.arrayContaining([{ key: 'amount', count: 5, numeric: true }]));

    const personKeys = await fetchWorkerJson<Array<{ key: string; numeric: boolean }>>(
      `/api/insights/property-keys?websiteId=${FIXTURE_SITE}&type=person&${range}`,
      { headers: await authHeader() },
    );
    expect(personKeys.body.map((k) => k.key)).toEqual(expect.arrayContaining(['plan', 'seats', 'email', 'beta']));

    const values = await fetchWorkerJson<Array<{ value: string; count: number }>>(
      `/api/insights/property-values?websiteId=${FIXTURE_SITE}&type=person&key=plan&${range}`,
      { headers: await authHeader() },
    );
    expect(values.body).toEqual([
      { value: 'pro', count: 2 },
      { value: 'free', count: 1 },
      { value: 'team', count: 1 },
    ]);
  });
});
