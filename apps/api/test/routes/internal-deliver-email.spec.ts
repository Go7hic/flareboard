import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { fetchWorkerJson } from '../helpers/fetch-worker';

describe('POST /api/internal/deliver-email', () => {
  it('rejects missing auth', async () => {
    const res = await fetchWorkerJson<{ error: string }>('/api/internal/deliver-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'ops@example.com', subject: 'Test', text: 'Hello' }),
    });
    expect(res.response.status).toBe(401);
  });

  it('rejects invalid payload', async () => {
    const res = await fetchWorkerJson<{ error: string }>('/api/internal/deliver-email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.APP_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: 'ops@example.com' }),
    });
    expect(res.response.status).toBe(400);
  });

  it('accepts valid payload and returns delivery status', async () => {
    const res = await fetchWorkerJson<{ ok: boolean }>('/api/internal/deliver-email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.APP_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: 'ops@example.com',
        subject: 'Workflow alert',
        text: 'A workflow action fired.',
      }),
    });
    expect(res.response.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
