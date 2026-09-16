import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_TYPE, EVENT_TYPE, PUBLIC_DEMO_SHARE_SLUG } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

async function insertDemoShare() {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO share (share_id, entity_id, name, share_type, slug, parameters, expires_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?7)`,
  )
    .bind(
      'share-public-demo',
      TEST_WEBSITE_ID,
      'Public demo',
      ENTITY_TYPE.website,
      PUBLIC_DEMO_SHARE_SLUG,
      JSON.stringify({ websiteId: TEST_WEBSITE_ID }),
      now,
    )
    .run();
}

async function insertSamplePageview() {
  const now = Date.now();
  const sessionId = 'demo-session-1';
  await env.DB.prepare(
    `INSERT OR REPLACE INTO session (session_id, website_id, browser, os, device, country, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(sessionId, TEST_WEBSITE_ID, 'Chrome', 'macOS', 'desktop', 'US', now)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, referrer_domain, event_type, hostname)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      'demo-event-1',
      TEST_WEBSITE_ID,
      sessionId,
      'demo-visit-1',
      now,
      '/pricing',
      'google.com',
      EVENT_TYPE.pageView,
      'example.com',
    )
    .run();
}

describe('public /api/demo', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertDemoShare();
    await insertSamplePageview();
  });

  it('returns sample website metadata without auth', async () => {
    const { response, body } = await fetchWorkerJson<{
      website: { name: string; domain: string | null; sample: boolean };
    }>('/api/demo');
    expect(response.status).toBe(200);
    expect(body.website.name).toBe('Test Site');
    expect(body.website.sample).toBe(true);
  });

  it('returns overview stats for a recent range', async () => {
    const endAt = Date.now();
    const startAt = endAt - 7 * 24 * 60 * 60 * 1000;
    const { response, body } = await fetchWorkerJson<{
      stats: { pageviews: { value: number } };
      timeseries: { pageviews: unknown[] };
    }>(`/api/demo/overview?startAt=${startAt}&endAt=${endAt}`);
    expect(response.status).toBe(200);
    expect(body.stats.pageviews.value).toBeGreaterThan(0);
    expect(Array.isArray(body.timeseries.pageviews)).toBe(true);
  });

  it('returns path metrics without auth', async () => {
    const endAt = Date.now();
    const startAt = endAt - 7 * 24 * 60 * 60 * 1000;
    const { response, body } = await fetchWorkerJson<Array<{ x: string; y: number }>>(
      `/api/demo/metrics?type=path&startAt=${startAt}&endAt=${endAt}&limit=10`,
    );
    expect(response.status).toBe(200);
    expect(body.some((row) => row.x === '/pricing')).toBe(true);
  });
});
