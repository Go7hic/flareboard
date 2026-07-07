import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { upsertPerson } from '@flareboard/db';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('people routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('patches stored person properties and returns merged profile detail', async () => {
    await upsertPerson(env.DB, {
      websiteId: TEST_WEBSITE_ID,
      distinctId: 'stored-user-1',
      properties: { email: 'stored@example.com', plan: 'pro' },
      seenAt: Date.UTC(2026, 0, 20, 12),
    });

    const patched = await fetchWorkerJson<{ profile: { email: string | null }; properties: Array<{ key: string }> }>(
      `/api/websites/${TEST_WEBSITE_ID}/people/stored-user-1`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({ properties: { title: 'Founder' } }),
      },
    );

    expect(patched.response.status).toBe(200);
    expect(patched.body.profile).toMatchObject({ email: 'stored@example.com' });
    expect(patched.body.properties.map((row) => row.key)).toEqual(
      expect.arrayContaining(['email', 'plan', 'title']),
    );
  });
});
