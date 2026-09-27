import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerJson } from './helpers/fetch-worker';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

function send(payload: Record<string, unknown>, cache?: string) {
  return fetchWorkerJson<{ cache?: string; sessionId?: string }>('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': '192.0.2.90' },
    body: JSON.stringify({ type: 'event', payload: { website: TEST_WEBSITE_ID, hostname: 'example.com', ...payload }, cache }),
  });
}

describe('identify within a visit', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('keeps the anonymous session when the tab identifies the user', async () => {
    const anonymous = await send({ url: '/pricing' });
    expect(anonymous.body.sessionId).toBeTruthy();

    const identified = await send({ url: '/dashboard', name: 'login', id: 'user-7' }, anonymous.body.cache);
    expect(identified.body.sessionId).toBe(anonymous.body.sessionId);
  });

  it('uses a stable per-user session when there is no tab session', async () => {
    const a = await send({ url: '/', id: 'user-8' });
    const b = await send({ url: '/', id: 'user-8' });
    expect(a.body.sessionId).toBe(b.body.sessionId);
  });
});
