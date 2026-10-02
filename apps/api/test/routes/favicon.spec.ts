import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { faviconHost } from '../../src/lib/favicon';
import { fetchWorker } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const ICON = new Uint8Array(200).fill(7);

async function auth() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}` };
}

/** Answers outbound requests from a map of URL → response factory; everything else is a 404. */
function mockSites(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new Request(input as RequestInfo).url;
    calls.push(url);
    const route = routes[url];
    return route ? route() : new Response('not found', { status: 404 });
  });
  return calls;
}

describe('favicon proxy', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts public hostnames only', () => {
    expect(faviconHost('https://Shop.Example.com/pricing?x=1')).toBe('shop.example.com');
    expect(faviconHost('markcut.com:443')).toBe('markcut.com');
    for (const bad of ['localhost', '127.0.0.1', '10.0.0.8', 'intranet', 'printer.local', 'a..b.com', '-x.com', '', null]) {
      expect(faviconHost(bad)).toBeNull();
    }
  });

  it('serves /favicon.ico from the site and caches it', async () => {
    const calls = mockSites({
      'https://icon-direct.com/favicon.ico': () => new Response(ICON, { headers: { 'Content-Type': 'image/x-icon' } }),
    });
    const first = await fetchWorker('/api/favicon?domain=https://icon-direct.com/about', { headers: await auth() });
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('image/x-icon');
    expect(first.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(ICON);

    const second = await fetchWorker('/api/favicon?domain=icon-direct.com', { headers: await auth() });
    expect(second.status).toBe(200);
    await second.arrayBuffer();
    expect(calls).toEqual(['https://icon-direct.com/favicon.ico']);
  });

  it('falls back to the icon the home page links to', async () => {
    mockSites({
      'https://icon-linked.com/': () =>
        new Response('<html><head><link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/static/logo.png"></head></html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      'https://icon-linked.com/static/logo.png': () => new Response(ICON, { headers: { 'Content-Type': 'image/png' } }),
    });
    const response = await fetchWorker('/api/favicon?domain=icon-linked.com', { headers: await auth() });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    await response.arrayBuffer();
  });

  it('answers 404 for sites without an icon, and refuses non-images and placeholders', async () => {
    mockSites({
      'https://icon-html.com/favicon.ico': () => new Response('<html>soft 404</html>', { headers: { 'Content-Type': 'text/html' } }),
      'https://icon-pixel.com/favicon.ico': () => new Response(new Uint8Array(10), { headers: { 'Content-Type': 'image/gif' } }),
    });
    for (const domain of ['icon-missing.com', 'icon-html.com', 'icon-pixel.com']) {
      const response = await fetchWorker(`/api/favicon?domain=${domain}`, { headers: await auth() });
      expect(response.status, domain).toBe(404);
    }
  });

  it('needs a signed-in user and a valid domain', async () => {
    mockSites({});
    expect((await fetchWorker('/api/favicon?domain=icon-direct.com')).status).toBe(401);
    expect((await fetchWorker('/api/favicon?domain=localhost', { headers: await auth() })).status).toBe(400);
  });
});
