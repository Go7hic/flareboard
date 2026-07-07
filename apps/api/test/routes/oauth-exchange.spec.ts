import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

describe('oauth code exchange', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('swaps a one-time code for a token exactly once', async () => {
    await env.CACHE.put('oauth-code:sample-code', 'issued-jwt-token', { expirationTtl: 60 });

    const first = await fetchWorkerJson<{ token: string }>('/api/auth/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'sample-code' }),
    });
    expect(first.response.status).toBe(200);
    expect(first.body.token).toBe('issued-jwt-token');

    const second = await fetchWorkerJson('/api/auth/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'sample-code' }),
    });
    expect(second.response.status).toBe(401);
  });
});
