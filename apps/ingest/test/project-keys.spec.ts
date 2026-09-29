import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { projectKeyCacheKey } from '@flareboard/shared';
import { applyTestMigrations } from './helpers/migrations';
import { fetchWorkerWithEnv, recordingQueue, seedProjectKey } from './helpers/queue';

const SITE = '00000000-0000-0000-0000-0000000000c1';
const LIMITED_SITE = '00000000-0000-0000-0000-0000000000c2';
const KEY = `fb_pk_${'ProjectKeySpec'.padEnd(24, '0')}`;
const LIMITED_KEY = `fb_pk_${'ProjectKeyLimited'.padEnd(24, '0')}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function call(path: string, init: RequestInit & { ip?: string } = {}, overrides: Record<string, unknown> = {}) {
  const recorder = recordingQueue();
  const response = await fetchWorkerWithEnv(
    path,
    {
      ...init,
      headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': init.ip ?? '192.0.2.200', ...(init.headers ?? {}) },
    },
    { EVENT_QUEUE: recorder.queue, ...overrides },
  );
  return { response, ...recorder };
}

function send(website: string, ip?: string, overrides: Record<string, unknown> = {}) {
  return call(
    '/api/send',
    { method: 'POST', ip, body: JSON.stringify({ type: 'event', payload: { website, hostname: 'keys.example.com', url: '/', name: 'signup' } }) },
    overrides,
  );
}

describe('project keys in place of website ids', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES ('pk-owner', 'pk-owner', 'hash', 'admin', ?1, ?1)`,
    )
      .bind(now)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at) VALUES
         (?1, 'Keys', 'keys.example.com', 'pk-owner', ?3, ?3), (?2, 'Limited', 'limited.example.com', 'pk-owner', ?3, ?3)`,
    )
      .bind(SITE, LIMITED_SITE, now)
      .run();
    await seedProjectKey(env.DB, SITE, KEY);
    await seedProjectKey(env.DB, LIMITED_SITE, LIMITED_KEY);
  });

  it('resolves a project key in /api/send to the website', async () => {
    const { response, events, sessions } = await send(KEY);
    expect(response.status).toBe(200);
    expect(events()[0]!.data.websiteId).toBe(SITE);
    expect(sessions()[0]!.data.websiteId).toBe(SITE);
    expect(await env.CACHE.get(projectKeyCacheKey(KEY))).toBe(SITE);
  });

  it('rejects unknown and malformed keys like unknown website ids', async () => {
    for (const website of ['fb_pk_000000000000000000000000', 'fb_pk_short']) {
      const { response, messages } = await send(website);
      expect(response.status).toBe(400);
      expect(messages).toHaveLength(0);
    }
  });

  it('stops resolving a rotated key once its cache entry is gone', async () => {
    const rotated = `fb_pk_${'ProjectKeyRotated'.padEnd(24, '0')}`;
    await seedProjectKey(env.DB, SITE, rotated);
    await env.CACHE.delete(projectKeyCacheKey(KEY));
    expect((await send(KEY)).response.status).toBe(400);
    expect((await send(rotated)).response.status).toBe(200);
    await seedProjectKey(env.DB, SITE, KEY);
    await env.CACHE.delete(projectKeyCacheKey(KEY));
  });

  it('accepts keys in /api/batch items, /api/tracker-config and feature flag evaluation', async () => {
    const batch = await call('/api/batch', {
      method: 'POST',
      body: JSON.stringify([
        { type: 'event', payload: { website: KEY, hostname: 'keys.example.com', url: '/a' } },
        { type: 'event', payload: { website: 'fb_pk_000000000000000000000000', hostname: 'keys.example.com', url: '/b' } },
      ]),
    });
    expect(await batch.response.json()).toMatchObject({ processed: 1, errors: 1 });
    expect(batch.events().map((e) => e.data.websiteId)).toEqual([SITE]);

    const config = await call(`/api/tracker-config?website=${KEY}`);
    expect(config.response.status).toBe(200);
    expect(await config.response.json()).toHaveProperty('featureFlags');
    expect((await call('/api/tracker-config?website=fb_pk_000000000000000000000000')).response.status).toBe(404);

    const flags = await call('/api/feature-flags/evaluate', {
      method: 'POST',
      body: JSON.stringify({ website: KEY, keys: ['missing'], context: {} }),
    });
    expect(await flags.response.json()).toEqual({ results: { missing: false }, payloads: {} });
  });

  it('limits keyed requests per key across IPs, leaving per-IP traffic alone', async () => {
    const limits = { PROJECT_KEY_RATE_LIMIT: '3' };
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await send(LIMITED_KEY, `198.51.100.${10 + i}`, limits)).response.status);
    expect(statuses).toEqual([200, 200, 200, 429]);

    // PostHog capture with the same key shares the per-key budget.
    const capture = await call(
      '/capture/',
      { method: 'POST', ip: '198.51.100.99', body: JSON.stringify({ api_key: LIMITED_KEY, event: 'x', distinct_id: 'u' }) },
      limits,
    );
    expect(capture.response.status).toBe(429);

    // The same website by id from one of those IPs is still limited per IP only.
    expect((await send(LIMITED_SITE, '198.51.100.10', limits)).response.status).toBe(200);
  });

  it('gives server SDKs more than the per-IP budget', async () => {
    const statuses = new Set<number>();
    // The per-IP limit is 100 per minute; keyed traffic from one IP goes past it.
    for (let i = 0; i < 105; i++) statuses.add((await send(KEY, '198.51.100.200')).response.status);
    expect([...statuses]).toEqual([200]);
  }, 30_000);
});
