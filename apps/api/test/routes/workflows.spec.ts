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

describe('workflow routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, lists, updates, lists executions, and deletes workflows', async () => {
    const created = await fetchWorkerJson<{ id: string; name: string; triggerEvent: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/workflows`,
      {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({
          name: 'Signup webhook',
          triggerEvent: 'signup',
          actionType: 'webhook',
          actionConfig: { url: 'https://example.com/hooks/signup' },
        }),
      },
    );
    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        name: 'Signup webhook',
        triggerEvent: 'signup',
      }),
    );

    const list = await fetchWorkerJson<Array<{ id: string; name: string }>>(
      `/api/websites/${TEST_WEBSITE_ID}/workflows`,
      { headers: await authHeader() },
    );
    expect(list.response.status).toBe(200);
    expect(list.body.some((row) => row.id === created.body.id)).toBe(true);

    const updated = await fetchWorkerJson<{ name: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/workflows/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({ name: 'Signup webhook v2' }),
      },
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body.name).toBe('Signup webhook v2');

    const executions = await fetchWorkerJson<{ executions: unknown[] }>(
      `/api/websites/${TEST_WEBSITE_ID}/workflows/${created.body.id}/executions`,
      { headers: await authHeader() },
    );
    expect(executions.response.status).toBe(200);
    expect(Array.isArray(executions.body.executions)).toBe(true);

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/workflows/${created.body.id}`,
      { method: 'DELETE', headers: await authHeader() },
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
  });
});
