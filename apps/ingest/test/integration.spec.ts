import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorker, fetchWorkerJson } from './helpers/fetch-worker';

describe('ingest integration', () => {
  it('GET / returns service metadata', async () => {
    const { response, body } = await fetchWorkerJson<{ name: string; version: string }>('/');
    expect(response.status).toBe(200);
    expect(body.name).toBe('flareboard-ingest');
    expect(body.version).toBe('0.0.1');
  });

  it('GET /api/heartbeat returns ok', async () => {
    const { response, body } = await fetchWorkerJson<{ ok: boolean }>('/api/heartbeat');
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('GET /script.js returns tracker JavaScript', async () => {
    const response = await fetchWorker('/script.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('javascript');
    const text = await response.text();
    expect(text).toContain('data-website-id');
  });

  it('GET /recorder.js returns recorder JavaScript', async () => {
    const response = await fetchWorker('/recorder.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('javascript');
    const text = await response.text();
    expect(text).toContain('rrweb');
  });
});

describe('POST /api/send', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('rejects invalid JSON payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{not-json',
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/invalid json/i);
  });

  it('rejects null JSON payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/expected json object/i);
  });

  it('rejects schema-invalid payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event', payload: {} }),
    });
    expect(response.status).toBe(400);
    expect(body.message).toBeTruthy();
  });

  it('returns 400 when website does not exist', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: '00000000-0000-0000-0000-000000000098',
          hostname: 'example.com',
          url: '/',
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/website not found/i);
  });

  it('accepts a valid pageview event for an existing website', async () => {
    await seedTestWebsite(env.DB);

    const { response, body } = await fetchWorkerJson<{ cache?: string; sessionId?: string }>(
      '/api/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event',
          payload: {
            website: TEST_WEBSITE_ID,
            hostname: 'example.com',
            url: '/docs',
            title: 'Docs',
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(body.sessionId).toBeTruthy();
    expect(body.cache).toBeTruthy();
  });
});

describe('POST /api/batch', () => {
  it('rejects non-array payloads', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event' }),
    });
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/expected array/i);
  });
});

describe('GET /api/tracker-config', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('requires website query param', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>('/api/tracker-config');
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/website query param required/i);
  });

  it('returns 404 for unknown website', async () => {
    const { response, body } = await fetchWorkerJson<{ message: string }>(
      '/api/tracker-config?website=00000000-0000-0000-0000-000000000098',
    );
    expect(response.status).toBe(404);
    expect(body.message).toMatch(/not found/i);
  });

  it('returns default tracker config for an existing website', async () => {
    await seedTestWebsite(env.DB);

    const { response, body } = await fetchWorkerJson<{
      heatmapSampleRate: number;
      heatmapEnabled: boolean;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);

    expect(response.status).toBe(200);
    expect(body.heatmapSampleRate).toBe(0.1);
    expect(body.heatmapEnabled).toBe(true);
  });
});
