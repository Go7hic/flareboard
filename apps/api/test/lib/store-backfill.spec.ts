import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { backfillWebsite, getBackfillState, resetBackfill, verifyWebsiteStore } from '../../src/lib/store-backfill';
import { testSiteDb } from '../helpers/site-db';
import { applyTestMigrations } from '../helpers/migrations';

const SITE = 'backfill-site';
const typedEnv = env as unknown as Env;
const T0 = Date.UTC(2026, 4, 1, 10);
const EVENTS = 230; // more than one 200-row chunk

// Legacy data lives in the shared D1 tables; the backfill copies it into the website store.
async function seedLegacyD1() {
  const d1 = env.DB;
  await d1.prepare(`INSERT INTO website (website_id, name, created_at, updated_at) VALUES (?1, 'Backfill', ?2, ?2)`).bind(SITE, T0).run();
  await d1
    .prepare(`INSERT INTO session (session_id, website_id, browser, country, created_at) VALUES ('bs1', ?1, 'Chrome', 'DE', ?2)`)
    .bind(SITE, T0)
    .run();
  const statements = [];
  for (let i = 0; i < EVENTS; i++) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
           VALUES (?1, ?2, 'bs1', 'bv1', ?3, ?4, ?5, ?6)`,
        )
        .bind(`be${i}`, SITE, T0 + i * 1000, i % 2 ? '/a' : '/b', i % 5 ? EVENT_TYPE.pageView : EVENT_TYPE.customEvent, i % 5 ? null : 'signup'),
    );
  }
  for (let i = 0; i < statements.length; i += 50) await d1.batch(statements.slice(i, i + 50));
  await d1
    .prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at) VALUES
         ('bd1', ?1, 'be0', 'plan', 'pro', NULL, 1, ?2),
         ('bd2', ?1, 'be0', 'amount', NULL, 19.5, 2, ?2),
         ('bd3', ?1, 'be0', 'trial', 'false', NULL, 3, ?2)`,
    )
    .bind(SITE, T0)
    .run();
  await d1
    .prepare(
      `INSERT INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at)
       VALUES ('br1', ?1, 'bs1', 'bv1', 0, ?2, 3, ?3, ?3, ?3)`,
    )
    .bind(SITE, new TextEncoder().encode('[1,2,3]'), T0)
    .run();
  await d1
    .prepare(`INSERT INTO person (person_id, website_id, distinct_id, properties_json, created_at, updated_at) VALUES ('bp1', ?1, 'user-1', '{"plan":"pro"}', ?2, ?2)`)
    .bind(SITE, T0)
    .run();
  await d1
    .prepare(
      `INSERT INTO heatmap_cell (website_id, url_path, day, kind, norm_x, norm_y, device_class, viewport_w, viewport_h, count)
       VALUES (?1, '/a', '2026-05-01', 'click', 10, 20, 'desktop', 1440, 900, 7)`,
    )
    .bind(SITE)
    .run();
}

describe('D1 -> website store backfill', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedLegacyD1();
  });

  it('copies every table in resumable chunks and rebuilds rollups', async () => {
    // Two chunks per call: the copy needs several calls and resumes from KV each time.
    let state = await backfillWebsite(typedEnv, SITE, 2);
    expect(state.done).toBe(false);
    for (let i = 0; i < 20 && !state.done; i++) state = await backfillWebsite(typedEnv, SITE, 2);
    expect(state.done).toBe(true);
    expect(state.copied.website_event).toBe(EVENTS);
    expect(state.rollupsRebuiltAt).not.toBeNull();

    const verification = await verifyWebsiteStore(typedEnv, SITE);
    expect(verification.complete).toBe(true);
    for (const row of verification.tables) expect(row.store).toBe(row.d1);

    const store = testSiteDb(SITE);
    const props = await store.prepare(`SELECT properties FROM website_event WHERE event_id = 'be0'`).first<string>('properties');
    expect(JSON.parse(props!)).toEqual({ plan: 'pro', amount: 19.5, trial: false });

    const replay = await store.prepare(`SELECT events FROM session_replay WHERE replay_id = 'br1'`).first<ArrayBuffer>('events');
    expect(new TextDecoder().decode(replay!)).toBe('[1,2,3]');

    const pageviews = await store.prepare(`SELECT SUM(pageviews) AS n FROM rollup_stats_daily`).first<number>('n');
    expect(pageviews).toBe(EVENTS - Math.ceil(EVENTS / 5));
    expect(await store.prepare(`SELECT count FROM rollup_event_daily WHERE event_name = 'signup'`).first('count')).toBe(Math.ceil(EVENTS / 5));
  });

  it('is idempotent and keeps the larger heatmap count when re-run', async () => {
    const store = testSiteDb(SITE);
    await store.prepare(`UPDATE heatmap_cell SET count = 9 WHERE url_path = '/a'`).run();
    await resetBackfill(typedEnv, SITE);
    expect((await getBackfillState(typedEnv, SITE)).done).toBe(false);

    let state = await backfillWebsite(typedEnv, SITE, 50);
    for (let i = 0; i < 5 && !state.done; i++) state = await backfillWebsite(typedEnv, SITE, 50);
    expect(state.done).toBe(true);

    expect(await store.prepare('SELECT COUNT(*) AS n FROM website_event').first('n')).toBe(EVENTS);
    expect(await store.prepare('SELECT COUNT(*) AS n FROM person').first('n')).toBe(1);
    expect(await store.prepare(`SELECT count FROM heatmap_cell WHERE url_path = '/a'`).first('count')).toBe(9);
  });
});
