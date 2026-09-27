import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorker } from './helpers/fetch-worker';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

describe('malformed page context', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it.each([
    { hostname: 'exa mple.com', url: '/' },
    { hostname: 'example.com', url: '/', referrer: 'http://[' },
    { hostname: 'example.com', url: 'http://[' },
    { hostname: 'example.com', url: '/', referrer: '//' },
  ])('accepts %o instead of failing with 500', async (context) => {
    const response = await fetchWorker('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': '192.0.2.120' },
      body: JSON.stringify({ type: 'event', payload: { website: TEST_WEBSITE_ID, ...context } }),
    });
    expect(response.status).toBe(200);
  });
});
