import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerJson } from './helpers/fetch-worker';

function send(userAgent: string, ip: string) {
  return fetchWorkerJson<{ beep?: string; sessionId?: string }>('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': userAgent, 'cf-connecting-ip': ip },
    body: JSON.stringify({
      type: 'event',
      payload: { website: TEST_WEBSITE_ID, hostname: 'example.com', url: '/billing', name: 'subscription_renewed' },
    }),
  });
}

describe('server-side senders', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it.each(['node', 'axios/1.7.2', 'python-requests/2.32.3', 'Go-http-client/1.1', 'curl/8.7.1'])(
    'accepts events from %s',
    async (ua) => {
      const { response, body } = await send(ua, '192.0.2.40');
      expect(response.status).toBe(200);
      expect(body.beep).toBeUndefined();
    },
  );

  it('still drops crawler traffic', async () => {
    const { body } = await send('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '192.0.2.41');
    expect(body.beep).toBe('boop');
  });
});
