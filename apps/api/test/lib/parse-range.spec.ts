import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { parseStatsRange } from '../../src/lib/parse-range';

function ctxFor(query: Record<string, string>, options?: Parameters<typeof parseStatsRange>[1]) {
  const app = new Hono();
  let captured: ReturnType<typeof parseStatsRange> | null = null;
  app.get('/t', (c) => {
    captured = parseStatsRange(c, options ?? { defaultSpan: '30d', withUnit: true });
    return c.text('ok');
  });
  return {
    async run(qs = '') {
      await app.request(`http://localhost/t${qs ? `?${qs}` : ''}`);
      return captured!;
    },
  };
}

describe('parseStatsRange', () => {
  it('defaults to 24h span when startAt is omitted', () => {
    const { run } = ctxFor({}, { defaultSpan: '24h' });
    return run().then((range) => {
      expect(range.endAt - range.startAt).toBe(24 * 60 * 60 * 1000);
    });
  });

  it('honors explicit startAt and endAt', async () => {
    const { run } = ctxFor({});
    const range = await run('startAt=1000&endAt=5000');
    expect(range).toMatchObject({ startAt: 1000, endAt: 5000 });
  });

  it('uses configured defaultSpan', async () => {
    const app = new Hono();
    let captured: ReturnType<typeof parseStatsRange> | null = null;
    app.get('/t', (c) => {
      captured = parseStatsRange(c, { defaultSpan: '90d' });
      return c.text('ok');
    });
    await app.request('http://localhost/t');
    expect(captured!.endAt - captured!.startAt).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('includes unit when withUnit is set', async () => {
    const { run } = ctxFor({});
    const range = await run('unit=hour');
    expect(range.unit).toBe('hour');
  });

  it('defaults unit to day when withUnit is set', async () => {
    const { run } = ctxFor({});
    const range = await run();
    expect(range.unit).toBe('day');
  });

  it('clamps range when clamp is true', async () => {
    const app = new Hono();
    let captured: ReturnType<typeof parseStatsRange> | null = null;
    const future = String(Date.now() + 86_400_000);
    app.get('/t', (c) => {
      captured = parseStatsRange(c, { defaultSpan: '30d', clamp: true });
      return c.text('ok');
    });
    await app.request(`http://localhost/t?endAt=${future}`);
    expect(captured!.endAt).toBeLessThanOrEqual(Date.now());
  });
});
