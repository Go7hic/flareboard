import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite } from './helpers/migrations';
import { fetchWorker } from './helpers/fetch-worker';

const LINK_ID = '5a0f8e2c-7b1d-4c3e-9f6a-0d2b4c6e8a11';
const PIXEL_ID = '5a0f8e2c-7b1d-4c3e-9f6a-0d2b4c6e8a12';
const NOW = Date.now();
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function hits(sourceType: 'link' | 'pixel', sourceId: string) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM link_pixel_hit WHERE source_type = ?1 AND source_id = ?2',
  )
    .bind(sourceType, sourceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('link and pixel hits', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO link (link_id, name, url, slug, created_at, updated_at)
       VALUES (?1, 'Launch', 'https://example.com/launch', 'launch-post', ?2, ?2)`,
    )
      .bind(LINK_ID, NOW)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO pixel (pixel_id, name, slug, created_at, updated_at)
       VALUES (?1, 'Newsletter', 'newsletter-open', ?2, ?2)`,
    )
      .bind(PIXEL_ID, NOW)
      .run();
  });

  it('records a redirect hit and still redirects', async () => {
    const response = await fetchWorker('/l/launch-post', {
      headers: { 'cf-connecting-ip': '198.51.100.7', 'user-agent': BROWSER_UA },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://example.com/launch');
    expect(await hits('link', LINK_ID)).toBe(1);
  });

  it('records a pixel view', async () => {
    const response = await fetchWorker('/p/newsletter-open.gif', {
      headers: { 'cf-connecting-ip': '198.51.100.8', 'user-agent': BROWSER_UA },
    });
    expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(await hits('pixel', PIXEL_ID)).toBe(1);
  });

  it('records link hits sent through /api/send and rejects unknown ids', async () => {
    const send = (link: string) =>
      fetchWorker('/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '198.51.100.9',
          'user-agent': BROWSER_UA,
        },
        body: JSON.stringify({ type: 'event', payload: { link, hostname: 'example.com', url: '/' } }),
      });

    expect((await send(LINK_ID)).status).toBe(200);
    expect(await hits('link', LINK_ID)).toBe(2);

    const unknown = '5a0f8e2c-7b1d-4c3e-9f6a-0d2b4c6e8aff';
    expect((await send(unknown)).status).toBe(400);
    expect(await hits('link', unknown)).toBe(0);
  });
});
