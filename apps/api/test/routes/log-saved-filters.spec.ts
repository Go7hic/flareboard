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

describe('log saved filter routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, lists, updates, and deletes saved log filters', async () => {
    const created = await fetchWorkerJson<{
      id: string;
      name: string;
      filters: { level: string; service: string; search: string };
      isDefault: boolean;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/filters`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'Payment errors',
        filters: {
          level: 'error',
          service: 'payments',
          search: 'timeout',
        },
        isDefault: true,
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Payment errors',
      filters: {
        level: 'error',
        service: 'payments',
        search: 'timeout',
      },
      isDefault: true,
    });

    const listed = await fetchWorkerJson<{
      filters: Array<{ id: string; name: string; isDefault: boolean }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/filters`, {
      headers: await authHeader(),
    });

    expect(listed.response.status).toBe(200);
    expect(listed.body.filters).toEqual([
      expect.objectContaining({
        id: created.body.id,
        name: 'Payment errors',
        isDefault: true,
      }),
    ]);

    const updated = await fetchWorkerJson<{ name: string; isDefault: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/logs/filters/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({
          name: 'Payment warnings',
          isDefault: false,
        }),
      },
    );

    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: 'Payment warnings',
      isDefault: false,
    });

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/logs/filters/${created.body.id}`,
      {
        method: 'DELETE',
        headers: await authHeader(),
      },
    );

    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
  });
});
