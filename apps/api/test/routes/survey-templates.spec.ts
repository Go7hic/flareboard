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

describe('survey templates', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates an NPS survey from a template', async () => {
    const result = await fetchWorkerJson<{
      name: string;
      question: string;
      type: string;
      options: string[];
    }>(`/api/websites/${TEST_WEBSITE_ID}/surveys`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        template: 'nps',
        name: 'Quarterly NPS',
      }),
    });

    expect(result.response.status).toBe(201);
    expect(result.body).toMatchObject({
      name: 'Quarterly NPS',
      question: 'How likely are you to recommend us to a friend or colleague?',
      type: 'choice',
      options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    });
  });

  it('creates a CSAT survey from a template', async () => {
    const result = await fetchWorkerJson<{
      name: string;
      question: string;
      type: string;
      options: string[];
    }>(`/api/websites/${TEST_WEBSITE_ID}/surveys`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        template: 'csat',
        triggerPath: '/checkout',
      }),
    });

    expect(result.response.status).toBe(201);
    expect(result.body).toMatchObject({
      name: 'Customer satisfaction',
      question: 'How satisfied are you with your experience?',
      type: 'rating',
      options: [],
      triggerPath: '/checkout',
    });
  });
});
