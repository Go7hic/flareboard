import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorker } from './helpers/fetch-worker';
import { testSiteDb } from './helpers/site-db';

describe('$alias', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('stores the alias as its own person row pointing at the canonical id', async () => {
    const response = await fetchWorker('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': '192.0.2.60',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: TEST_WEBSITE_ID,
          hostname: 'example.com',
          url: '/signup',
          name: '$alias',
          data: { alias: 'anon-7f3', distinctId: 'user-42' },
        },
      }),
    });
    expect(response.status).toBe(200);

    const rows = await testSiteDb(TEST_WEBSITE_ID).prepare(
      `SELECT distinct_id AS distinctId, properties_json AS props FROM person
       WHERE website_id = ?1 AND distinct_id IN ('user-42', 'anon-7f3') ORDER BY distinct_id`,
    )
      .bind(TEST_WEBSITE_ID)
      .all<{ distinctId: string; props: string }>();
    const byId = Object.fromEntries((rows.results ?? []).map((r) => [r.distinctId, JSON.parse(r.props)]));
    expect(byId['user-42']).toMatchObject({ $alias: 'anon-7f3' });
    expect(byId['anon-7f3']).toMatchObject({ $canonical_distinct_id: 'user-42' });
  });
});
