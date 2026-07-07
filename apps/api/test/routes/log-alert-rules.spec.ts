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

describe('log alert rule routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, lists, updates, and deletes log alert rules', async () => {
    const created = await fetchWorkerJson<{
      id: string;
      name: string;
      threshold: number;
      windowMinutes: number;
      level: string | null;
      service: string | null;
      enabled: boolean;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/alerts`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'Payment error logs',
        threshold: 3,
        windowMinutes: 15,
        level: 'error',
        service: 'payments',
        search: 'timeout',
        enabled: true,
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Payment error logs',
      threshold: 3,
      windowMinutes: 15,
      level: 'error',
      service: 'payments',
      enabled: true,
    });

    const listed = await fetchWorkerJson<{
      alertRules: Array<{ id: string; name: string; threshold: number }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/alerts`, {
      headers: await authHeader(),
    });

    expect(listed.response.status).toBe(200);
    expect(listed.body.alertRules).toEqual([
      expect.objectContaining({
        id: created.body.id,
        name: 'Payment error logs',
        threshold: 3,
      }),
    ]);

    const updated = await fetchWorkerJson<{ threshold: number; enabled: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/logs/alerts/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({ threshold: 5, enabled: false }),
      },
    );

    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({ threshold: 5, enabled: false });

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/logs/alerts/${created.body.id}`,
      {
        method: 'DELETE',
        headers: await authHeader(),
      },
    );

    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
  });
});
