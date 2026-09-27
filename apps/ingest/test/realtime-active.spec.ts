import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { bumpRealtimeVisitor, countActiveVisitors } from '../src/lib/realtime-kv';

describe('realtime active visitors', () => {
  it('counts distinct active sessions and does not grow on repeat hits', async () => {
    const site = `rt-site-${crypto.randomUUID()}`;
    await bumpRealtimeVisitor(env, site, 'session-a', { urlPath: '/' });
    await bumpRealtimeVisitor(env, site, 'session-b', { urlPath: '/pricing' });
    await bumpRealtimeVisitor(env, site, 'session-a', { urlPath: '/docs' });
    expect(await countActiveVisitors(env, site)).toBe(2);
  });

  it('ignores sessions last seen before the window', async () => {
    const site = `rt-site-${crypto.randomUUID()}`;
    await bumpRealtimeVisitor(env, site, 'session-old', { urlPath: '/' });
    expect(await countActiveVisitors(env, site, Date.now() + 10 * 60 * 1000)).toBe(0);
  });
});
