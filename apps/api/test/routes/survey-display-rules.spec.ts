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

describe('survey display rules', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates and updates survey display rules', async () => {
    const displayRules = [
      { field: 'path', operator: 'contains', value: '/checkout' },
      { field: 'event', operator: 'equals', value: 'checkout_started' },
    ];

    const created = await fetchWorkerJson<{
      id: string;
      displayRules: typeof displayRules;
    }>(`/api/websites/${TEST_WEBSITE_ID}/surveys`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        name: 'Checkout feedback',
        question: 'How was checkout?',
        type: 'rating',
        displayRules,
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body.displayRules).toEqual(displayRules);

    const nextRules = [{ field: 'property', key: 'plan', operator: 'equals', value: 'pro' }];
    const updated = await fetchWorkerJson<{ displayRules: typeof nextRules }>(
      `/api/websites/${TEST_WEBSITE_ID}/surveys/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({ displayRules: nextRules }),
      },
    );

    expect(updated.response.status).toBe(200);
    expect(updated.body.displayRules).toEqual(nextRules);
  });
});
