import { describe, expect, it } from 'vitest';
import { fetchWorkerJson } from './helpers/fetch-worker';

describe('API integration', () => {
  it('GET /api/heartbeat returns ok', async () => {
    const { response, body } = await fetchWorkerJson<{ ok: boolean; service: string; environment: string }>(
      '/api/heartbeat',
    );
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe('flareboard-api');
    expect(body.environment).toBe('development');
  });

  it('GET / returns service metadata', async () => {
    const { response, body } = await fetchWorkerJson<{ name: string; version: string }>('/');
    expect(response.status).toBe(200);
    expect(body.name).toBe('flareboard-api');
    expect(body.version).toBe('0.0.1');
  });

  it('GET /api/me returns 401 without Authorization header', async () => {
    const response = await fetchWorkerJson('/api/me');
    expect(response.response.status).toBe(401);
  });

  it('GET /api/me returns 401 with invalid token', async () => {
    const response = await fetchWorkerJson('/api/me', {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    });
    expect(response.response.status).toBe(401);
  });

  it('GET /api/websites returns 401 without auth', async () => {
    const response = await fetchWorkerJson('/api/websites');
    expect(response.response.status).toBe(401);
  });
});
