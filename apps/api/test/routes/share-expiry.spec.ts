import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

async function insertShare(slug: string, expiresAt: number | null) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO share (share_id, entity_id, name, share_type, slug, parameters, expires_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
  )
    .bind(
      `share-${slug}`,
      TEST_WEBSITE_ID,
      'Expiry share',
      ENTITY_TYPE.website,
      slug,
      JSON.stringify({ websiteId: TEST_WEBSITE_ID }),
      expiresAt,
      Date.now(),
    )
    .run();
}

describe('public share expiry', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('serves a share with a future expiry and 404s an expired one', async () => {
    await insertShare('future-share', Date.now() + 60_000);
    await insertShare('expired-share', Date.now() - 60_000);

    const live = await fetchWorkerJson(`/api/share/future-share`, {});
    expect(live.response.status).toBe(200);

    const dead = await fetchWorkerJson(`/api/share/expired-share`, {});
    expect(dead.response.status).toBe(404);
  });
});
