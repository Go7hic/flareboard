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

describe('error alert rule routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates, lists, updates, and deletes error alert rules', async () => {
    const created = await fetchWorkerJson<{
      id: string;
      name: string;
      threshold: number;
      windowMinutes: number;
      severity: string | null;
      release: string | null;
      enabled: boolean;
    }>(`/api/websites/${TEST_WEBSITE_ID}/errors/alerts`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'Checkout errors spike',
        threshold: 5,
        windowMinutes: 10,
        severity: 'error',
        release: '4.0.0',
        enabled: true,
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Checkout errors spike',
      threshold: 5,
      windowMinutes: 10,
      severity: 'error',
      release: '4.0.0',
      enabled: true,
    });

    const listed = await fetchWorkerJson<{
      alertRules: Array<{ id: string; name: string; threshold: number; windowMinutes: number }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/errors/alerts`, {
      headers: await authHeader(),
    });

    expect(listed.response.status).toBe(200);
    expect(listed.body.alertRules).toEqual([
      expect.objectContaining({
        id: created.body.id,
        name: 'Checkout errors spike',
        threshold: 5,
        windowMinutes: 10,
      }),
    ]);

    const updated = await fetchWorkerJson<{ threshold: number; enabled: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/errors/alerts/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({
          threshold: 8,
          enabled: false,
        }),
      },
    );

    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({
      threshold: 8,
      enabled: false,
    });

    const deleted = await fetchWorkerJson<{ ok: boolean }>(
      `/api/websites/${TEST_WEBSITE_ID}/errors/alerts/${created.body.id}`,
      {
        method: 'DELETE',
        headers: await authHeader(),
      },
    );

    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
  });
});
