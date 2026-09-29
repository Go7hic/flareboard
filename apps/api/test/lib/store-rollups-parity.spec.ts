import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { EVENT_TYPE, type QueueMessage } from '@flareboard/shared';
import aggregator from '../../../../workers/aggregator/src/index';
import type { Env } from '../../src/env';
import { siteStoreStub } from '../../src/lib/site-db';
import { testSiteDb } from '../helpers/site-db';
import { applyTestMigrations } from '../helpers/migrations';

const SITE = 'rollup-parity-site';
const DAY1 = Date.UTC(2026, 3, 10, 9, 15);
const DAY2 = Date.UTC(2026, 3, 11, 23, 50);
const ROLLUP_TABLES = [
  'rollup_session_day',
  'rollup_stats_daily',
  'rollup_pageview_series',
  'rollup_series_bucket',
  'rollup_dimension_daily',
  'rollup_event_daily',
];

function message(body: QueueMessage) {
  return { body, attempts: 1, ack: vi.fn(), retry: vi.fn() };
}

function session(id: string, meta: Partial<{ browser: string; os: string; device: string; language: string; country: string }>) {
  return message({ type: 'session', data: { id, websiteId: SITE, createdAt: DAY1, ...meta } } as QueueMessage);
}

let n = 0;
function event(sessionId: string, at: number, extra: Partial<{ eventType: number; eventName: string; urlPath: string; referrerDomain: string }> = {}) {
  n += 1;
  return message({
    type: 'event',
    data: {
      id: `parity-e${n}`,
      websiteId: SITE,
      sessionId,
      visitId: `${sessionId}-v`,
      createdAt: at,
      urlPath: '/',
      eventType: EVENT_TYPE.pageView,
      ...extra,
    },
  } as QueueMessage);
}

async function snapshot() {
  const db = testSiteDb(SITE);
  const out: Record<string, unknown[]> = {};
  for (const table of ROLLUP_TABLES) {
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
    out[table] = results.map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

describe('store rollup rebuild', () => {
  it('rebuilds exactly what the aggregator maintains incrementally', async () => {
    await applyTestMigrations(env.DB);
    const messages = [
      session('s1', { browser: 'Chrome', os: 'macOS', device: 'desktop', language: 'en-US', country: 'US' }),
      session('s2', { browser: 'Safari', os: 'iOS', device: 'mobile', language: 'zh-CN', country: 'CN' }),
      event('s1', DAY1, { urlPath: '/pricing', referrerDomain: 'google.com' }),
      event('s1', DAY1 + 60_000, { urlPath: '/signup', referrerDomain: '' }),
      event('s1', DAY1 + 120_000, { eventType: EVENT_TYPE.customEvent, eventName: 'signup' }),
      event('s2', DAY2, { urlPath: '/' }),
      event('s2', DAY2 + 30 * 60_000, { urlPath: '/docs' }), // crosses into the next UTC day
      event('s2', DAY2 + 31 * 60_000, { eventType: EVENT_TYPE.customEvent, eventName: 'search' }),
      event('s-nometa', DAY2, { urlPath: '/orphan' }), // session row is a stub without metadata
    ];
    const batch = { messages, ackAll: vi.fn(), retryAll: vi.fn() };
    await aggregator.queue(batch as unknown as MessageBatch<QueueMessage>, {
      ...(env as unknown as Env),
      EVENT_STORE: 'do',
    } as never);
    for (const m of messages) expect(m.ack).toHaveBeenCalledTimes(1);

    const incremental = await snapshot();
    expect((incremental.rollup_pageview_series ?? []).length).toBeGreaterThan(0);
    expect((incremental.rollup_dimension_daily ?? []).length).toBeGreaterThan(0);

    const result = await siteStoreStub(env as unknown as Env, SITE).rebuildRollups(SITE);
    expect(result.pageviews).toBe(5);
    expect(await snapshot()).toEqual(incremental);
  });
});
