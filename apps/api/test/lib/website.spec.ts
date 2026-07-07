import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requireWebsite, requireWebsiteById } from '../../src/lib/website';

const website = { websiteId: 'site-1', userId: 'user-1', teamId: null, name: 'Test' };

vi.mock('../../src/lib/queries', () => ({
  getWebsiteById: vi.fn(async () => website),
}));

vi.mock('../../src/lib/access', () => ({
  canAccessWebsite: vi.fn(async () => true),
}));

describe('requireWebsite helpers', () => {
  it('requireWebsite reads websiteId from route params', async () => {
    const app = new Hono();
    let captured: Awaited<ReturnType<typeof requireWebsite>> = null;
    app.get('/websites/:websiteId/stats', async (c) => {
      captured = await requireWebsite(c as never);
      return c.text('ok');
    });
    await app.request('http://localhost/websites/site-1/stats');
    expect(captured?.websiteId).toBe('site-1');
  });

  it('requireWebsiteById checks an explicit website id', async () => {
    const app = new Hono();
    let captured: Awaited<ReturnType<typeof requireWebsiteById>> = null;
    app.get('/t', async (c) => {
      captured = await requireWebsiteById(c as never, 'site-1');
      return c.text('ok');
    });
    await app.request('http://localhost/t');
    expect(captured?.websiteId).toBe('site-1');
  });
});
