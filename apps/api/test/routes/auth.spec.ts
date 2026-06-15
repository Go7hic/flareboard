import { beforeAll, describe, expect, it } from 'vitest';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';
import { env } from 'cloudflare:workers';

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('rejects invalid credentials', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'wrong-password' }),
    });
    expect(response.status).toBe(401);
    expect(body.message).toMatch(/invalid/i);
  });

  it('rejects malformed payloads', async () => {
    const { response } = await fetchWorkerJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'only-user' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/register', () => {
  it('is disabled outside hosted mode', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new-user@example.com',
        password: 'password123',
      }),
    });
    expect(response.status).toBe(404);
    expect(body.message).toMatch(/registration is not enabled/i);
  });
});
