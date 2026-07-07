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

describe('warehouse data source routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, updates, lists, and deletes external data sources', async () => {
    const created = await fetchWorkerJson<{
      id: string;
      name: string;
      type: string;
      enabled: boolean;
      config: Record<string, unknown>;
      lastStatus: string | null;
    }>(`/api/websites/${TEST_WEBSITE_ID}/warehouse/data-sources`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'CRM accounts',
        type: 'http_json',
        enabled: true,
        config: {
          url: 'https://example.com/accounts.json',
          method: 'GET',
          primaryKey: 'account_id',
        },
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        name: 'CRM accounts',
        type: 'http_json',
        enabled: true,
        lastStatus: null,
      }),
    );
    expect(created.body.config).toEqual(
      expect.objectContaining({
        url: 'https://example.com/accounts.json',
        method: 'GET',
      }),
    );

    const updated = await fetchWorkerJson<{ name: string; lastStatus: string; lastError: string | null }>(
      `/api/websites/${TEST_WEBSITE_ID}/warehouse/data-sources/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({
          name: 'CRM accounts import',
          lastStatus: 'connected',
          lastError: null,
        }),
      },
    );

    expect(updated.response.status).toBe(200);
    expect(updated.body).toEqual(
      expect.objectContaining({
        name: 'CRM accounts import',
        lastStatus: 'connected',
        lastError: null,
      }),
    );

    const list = await fetchWorkerJson<{ dataSources: Array<{ id: string; name: string; lastStatus: string }> }>(
      `/api/websites/${TEST_WEBSITE_ID}/warehouse/data-sources`,
      {
        headers: await authHeader(),
      },
    );

    expect(list.response.status).toBe(200);
    expect(list.body.dataSources[0]).toEqual(
      expect.objectContaining({
        id: created.body.id,
        name: 'CRM accounts import',
        lastStatus: 'connected',
      }),
    );

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/warehouse/data-sources/${created.body.id}`,
      {
        method: 'DELETE',
        headers: await authHeader(),
      },
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
  });
});
