import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 23, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('warehouse scheduled query routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, runs due scheduled queries, and stores the last run status', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES ('warehouse-schedule-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES ('warehouse-schedule-event', ?1, 'warehouse-schedule-session', 'warehouse-schedule-session', ?2, '/pricing', ?3, 'view_pricing')`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, EVENT_TYPE.customEvent)
      .run();

    const created = await fetchWorkerJson<{
      id: string;
      name: string;
      enabled: boolean;
      nextRunAt: number;
      lastStatus: string | null;
    }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/schedules`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'Hourly pricing events',
        sql: `SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 10`,
        intervalMinutes: 60,
        enabled: true,
        nextRunAt: BASE - 1000,
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        name: 'Hourly pricing events',
        enabled: true,
        lastStatus: null,
      }),
    );

    const run = await fetchWorkerJson<{
      executedCount: number;
      schedules: Array<{ id: string; lastStatus: string; lastRowCount: number; lastError: string | null }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/schedules/run-due`, {
      method: 'POST',
      headers: await authHeader(),
    });

    expect(run.response.status).toBe(200);
    expect(run.body.executedCount).toBe(1);
    expect(run.body.schedules[0]).toEqual(
      expect.objectContaining({
        id: created.body.id,
        lastStatus: 'success',
        lastRowCount: expect.any(Number),
        lastError: null,
      }),
    );
    expect(run.body.schedules[0]!.lastRowCount).toBeGreaterThan(0);

    const list = await fetchWorkerJson<{
      schedules: Array<{ id: string; lastStatus: string; nextRunAt: number }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/schedules`, {
      headers: await authHeader(),
    });

    expect(list.response.status).toBe(200);
    expect(list.body.schedules[0]).toEqual(
      expect.objectContaining({
        id: created.body.id,
        lastStatus: 'success',
      }),
    );
    expect(list.body.schedules[0]!.nextRunAt).toBeGreaterThan(created.body.nextRunAt);
  });
});
