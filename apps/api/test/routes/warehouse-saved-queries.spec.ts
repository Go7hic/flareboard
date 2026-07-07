import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('warehouse saved query routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, lists, updates, and deletes saved queries', async () => {
    const sql = `SELECT event_name as eventName
FROM website_event
WHERE website_id = ?1
LIMIT 20`;

    const created = await fetchWorkerJson<{
      id: string;
      name: string;
      sql: string;
      analysis: { valid: boolean; hasLimit: boolean };
    }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/saved-queries`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'Recent event names',
        description: 'Reusable event query',
        sql,
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Recent event names',
      sql,
      analysis: { valid: true, hasLimit: true },
    });

    const listed = await fetchWorkerJson<{
      savedQueries: Array<{ id: string; name: string; description: string }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/saved-queries`, {
      headers: await authHeader(),
    });

    expect(listed.response.status).toBe(200);
    expect(listed.body.savedQueries).toEqual([
      expect.objectContaining({
        id: created.body.id,
        name: 'Recent event names',
        description: 'Reusable event query',
      }),
    ]);

    const updated = await fetchWorkerJson<{ name: string; description: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/warehouse/saved-queries/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({
          name: 'Updated event names',
          description: 'Updated reusable query',
        }),
      },
    );

    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: 'Updated event names',
      description: 'Updated reusable query',
    });

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/warehouse/saved-queries/${created.body.id}`,
      {
        method: 'DELETE',
        headers: await authHeader(),
      },
    );

    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
  });
});
