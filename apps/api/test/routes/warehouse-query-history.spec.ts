import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 22, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('warehouse query history routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('records query history for successful and failed warehouse queries', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES ('warehouse-history-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES ('warehouse-history-event', ?1, 'warehouse-history-session', 'warehouse-history-session', ?2, '/docs', ?3, 'view_docs')`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, EVENT_TYPE.customEvent)
      .run();

    const success = await fetchWorkerJson<{ rowCount: number }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/query`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        sql: `SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 10`,
      }),
    });
    expect(success.response.status).toBe(200);
    expect(success.body.rowCount).toBeGreaterThan(0);

    const failed = await fetchWorkerJson<{ message: string }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/query`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        sql: `SELECT * FROM website_event LIMIT 10`,
      }),
    });
    expect(failed.response.status).toBe(400);

    const history = await fetchWorkerJson<{
      history: Array<{ status: string; rowCount: number; error: string | null; sql: string }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/history`, {
      headers: await authHeader(),
    });

    expect(history.response.status).toBe(200);
    expect(history.body.history.slice(0, 2)).toEqual([
      expect.objectContaining({
        status: 'failed',
        rowCount: 0,
        error: expect.stringMatching(/website_id/i),
      }),
      expect.objectContaining({
        status: 'success',
        rowCount: success.body.rowCount,
        error: null,
      }),
    ]);
  });
});
