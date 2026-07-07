import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const NOW = Date.now();

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('actions and annotations routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, lists, updates, and deletes actions', async () => {
    const created = await fetchWorkerJson<{ id: string; name: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/actions`,
      {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({
          name: 'Signup click',
          description: 'Clicked signup CTA',
          rules: [{ field: 'event_name', operator: 'equals', value: 'signup' }],
        }),
      },
    );
    expect(created.response.status).toBe(201);
    expect(created.body.name).toBe('Signup click');

    const list = await fetchWorkerJson<Array<{ id: string; name: string }>>(
      `/api/websites/${TEST_WEBSITE_ID}/actions`,
      { headers: await authHeader() },
    );
    expect(list.response.status).toBe(200);
    expect(list.body.some((row) => row.id === created.body.id)).toBe(true);

    const updated = await fetchWorkerJson<{ name: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/actions/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({ name: 'Signup CTA' }),
      },
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body.name).toBe('Signup CTA');

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/actions/${created.body.id}`,
      { method: 'DELETE', headers: await authHeader() },
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
  });

  it('creates, lists, updates, and deletes annotations', async () => {
    const created = await fetchWorkerJson<{ id: string; title: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/annotations`,
      {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({
          title: 'Release 2.0',
          description: 'Shipped pricing page',
          category: 'release',
          happenedAt: NOW,
        }),
      },
    );
    expect(created.response.status).toBe(201);
    expect(created.body.title).toBe('Release 2.0');

    const list = await fetchWorkerJson<{ annotations: Array<{ id: string; title: string }> }>(
      `/api/websites/${TEST_WEBSITE_ID}/annotations`,
      { headers: await authHeader() },
    );
    expect(list.response.status).toBe(200);
    expect(list.body.annotations.some((row) => row.id === created.body.id)).toBe(true);

    const updated = await fetchWorkerJson<{ title: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/annotations/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({ title: 'Release 2.0.1' }),
      },
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body.title).toBe('Release 2.0.1');

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/annotations/${created.body.id}`,
      { method: 'DELETE', headers: await authHeader() },
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
  });
});
