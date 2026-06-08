import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function fetchWorker(path: string, init?: RequestInit) {
  const request = new IncomingRequest(`http://example.com${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('API integration', () => {
  it('GET /api/heartbeat returns ok', async () => {
    const response = await fetchWorker('/api/heartbeat');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; service: string; environment: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('flareboard-api');
    expect(body.environment).toBe('development');
  });

  it('GET / returns service metadata', async () => {
    const response = await fetchWorker('/');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; version: string };
    expect(body.name).toBe('flareboard-api');
    expect(body.version).toBe('0.0.1');
  });

  it('GET /api/me returns 401 without Authorization header', async () => {
    const response = await fetchWorker('/api/me');
    expect(response.status).toBe(401);
  });

  it('GET /api/me returns 401 with invalid token', async () => {
    const response = await fetchWorker('/api/me', {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    });
    expect(response.status).toBe(401);
  });
});
