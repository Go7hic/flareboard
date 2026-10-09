import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { applyTestMigrations } from '../helpers/migrations';
import { call, createTestUser, login } from '../helpers/auth';
import { fetchWorker } from '../helpers/fetch-worker';
import { testSiteDb } from '../helpers/site-db';

/** Writes `count` pageviews in one statement, newest a minute ago. */
async function seedEvents(websiteId: string, count: number) {
  const now = Date.now();
  await testSiteDb(websiteId).prepare(`INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('export-sess', ?1, ?2)`)
    .bind(websiteId, now)
    .run();
  await testSiteDb(websiteId).prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?3)
     INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     SELECT 'export-' || i, ?1, 'export-sess', 'export-sess', ?2 - i * 1000, '/', ?4, NULL FROM n`,
  )
    .bind(websiteId, now - 60_000, count, EVENT_TYPE.pageView)
    .run();
}

describe('events CSV export', () => {
  let token = '';

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await createTestUser('events-export', 'export-password');
    token = (await login('events-export', 'export-password')).token!;
  });

  async function exportCsv(websiteId: string) {
    const response = await fetchWorker(`/api/websites/${websiteId}/export?type=pageviews`, { headers: { Authorization: `Bearer ${token}` } });
    return { response, lines: (await response.text()).split('\n').length - 1 };
  }

  it('says when the 10,000-row cap left older rows out', async () => {
    const site = await call('/api/websites', token, { method: 'POST', body: JSON.stringify({ name: 'Big', domain: 'big.example' }) });
    await seedEvents(site.body.id as string, 10_001);
    const { response, lines } = await exportCsv(site.body.id as string);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Truncated')).toBe('true');
    expect(response.headers.get('X-Row-Cap')).toBe('10000');
    expect(lines).toBe(10_000);
  });

  it('says nothing was left out when everything fits', async () => {
    const site = await call('/api/websites', token, { method: 'POST', body: JSON.stringify({ name: 'Small', domain: 'small.example' }) });
    await seedEvents(site.body.id as string, 3);
    const { response, lines } = await exportCsv(site.body.id as string);
    expect(response.headers.get('X-Truncated')).toBe('false');
    expect(lines).toBe(3);
  });
});
