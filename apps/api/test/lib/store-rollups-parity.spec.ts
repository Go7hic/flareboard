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

async function snapshot(site = SITE, tables = ROLLUP_TABLES) {
  const db = testSiteDb(site);
  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
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

  it('refreshes only new and expired days and ends where a rebuild over the kept rows does', async () => {
    const site = 'rollup-refresh-site';
    const db = testSiteDb(site);
    const stub = siteStoreStub(env as unknown as Env, site);
    const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 5, day, hour, minute); // June; day 31 = July 1
    let id = 0;
    const view = (visit: string, time: number, extra: { path?: string; referrer?: string; name?: string } = {}) =>
      db
        .prepare(
          `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, referrer_domain, event_type, event_name)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(`refresh-e${++id}`, site, `s-${visit}`, visit, time, extra.path ?? '/', extra.referrer ?? '', extra.name ? EVENT_TYPE.customEvent : EVENT_TYPE.pageView, extra.name ?? null)
        .run();
    const chunk = (visit: string, index: number, time: number) =>
      db
        .prepare(
          `INSERT INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at, click_count)
           VALUES (?1, ?2, ?3, ?4, ?5, X'', 3, ?6, ?7, ?6, 1)`,
        )
        .bind(`${visit}-${index}`, site, `s-${visit}`, visit, index, time, time + 60_000)
        .run();
    for (const [visit, browser] of [['a', 'Chrome'], ['b', 'Safari'], ['c', 'Firefox'], ['d', 'Chrome'], ['e', 'Edge'], ['f', 'Safari'], ['g', 'Chrome']]) {
      await db
        .prepare(`INSERT INTO session (session_id, website_id, browser, os, country, created_at) VALUES (?1, ?2, ?3, 'macOS', 'DE', ?4)`)
        .bind(`s-${visit}`, site, browser, at(27, 0))
        .run();
    }

    // Already stored: June 28 to July 3, rolled up like production before the change.
    await view('a', at(28, 10), { path: '/expired', referrer: 'old.example' }); // only on days that expire
    await view('a', at(28, 10, 5), { name: 'expired-signup' });
    await chunk('a', 0, at(28, 10));
    await view('b', at(29, 12)); // expires from June, stays in July and 2026
    await view('b', at(32, 9), { path: '/pricing' });
    await view('c', at(29, 20)); // keeps a June pageview on June 30
    await view('c', at(30, 8));
    await view('d', at(30, 23, 50), { path: '/late' }); // crosses midnight into July
    await view('d', at(31, 0, 20), { path: '/early' });
    await view('e', at(32, 14), { referrer: 'google.com' });
    await view('e', at(32, 14, 5), { name: 'signup' });
    await chunk('e', 0, at(32, 14));
    await view('g', at(33, 23, 55)); // continues on the new day
    await stub.rebuildRollups(site);

    // The generator adds July 4 and refreshes, keeping June 30 on, before the retention job has
    // removed the older rows.
    await view('g', at(34, 0, 5), { path: '/next' });
    await view('f', at(34, 9), { referrer: 'news.example' });
    await view('f', at(34, 9, 1), { name: 'signup' });
    await chunk('f', 0, at(34, 9));
    await chunk('f', 1, at(34, 9, 2));
    const refreshed = await stub.refreshRollups(site, { since: at(34, 0), keepFrom: at(30, 6) });
    const visits = async (unit: string, bucket: string) =>
      (
        await db
          .prepare('SELECT visit_id FROM rollup_series_bucket WHERE unit = ?1 AND bucket = ?2 ORDER BY visit_id')
          .bind(unit, bucket)
          .all<{ visit_id: string }>()
      ).results.map((row) => row.visit_id);
    expect(await visits('month', '2026-06')).toEqual(['c', 'd']);
    expect(await visits('month', '2026-07')).toEqual(['b', 'd', 'e', 'f', 'g']);
    expect(await visits('year', '2026')).toEqual(['b', 'c', 'd', 'e', 'f', 'g']);

    // After the retention job, a rebuild over the kept rows lands on the same rollups.
    for (const table of ['website_event', 'session_replay']) {
      await db.prepare(`DELETE FROM ${table} WHERE created_at < ?1`).bind(at(30, 0)).run();
    }
    await db.prepare('DELETE FROM session_replay_summary WHERE started_at < ?1').bind(at(30, 0)).run();
    const tables = [...ROLLUP_TABLES, 'session_replay_summary'];
    const incremental = await snapshot(site, tables);
    const rebuilt = await stub.rebuildRollups(site);
    expect(await snapshot(site, tables)).toEqual(incremental);
    expect(refreshed.rowsWritten).toBeGreaterThan(0);
    expect(refreshed.rowsWritten).toBeLessThan(rebuilt.rowsWritten);
  });
});
