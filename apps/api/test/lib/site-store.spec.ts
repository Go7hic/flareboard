import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createDb, schema } from '@flareboard/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../../src/env';
import { eventStoreMode, siteDb, siteStoreStub } from '../../src/lib/site-db';

const typedEnv = env as unknown as Env;
let counter = 0;
function freshSite() {
  counter += 1;
  return `store-spec-${counter}-${crypto.randomUUID()}`;
}

async function seedEvent(db: D1Database, websiteId: string, eventId: string, createdAt: number) {
  await db
    .prepare(
      `INSERT INTO session (session_id, website_id, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(session_id) DO NOTHING`,
    )
    .bind(`s-${eventId}`, websiteId, createdAt)
    .run();
  return db
    .prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, url_path, created_at, event_type, event_name)
       VALUES (?1, ?2, ?3, ?3, '/', ?4, 2, 'signup')`,
    )
    .bind(eventId, websiteId, `s-${eventId}`, createdAt)
    .run();
}

describe('per-website analytics store (siteDb facade)', () => {
  it('runs in Durable Object mode in tests', () => {
    expect(eventStoreMode(typedEnv)).toBe('do');
  });

  it('supports numbered and repeated parameters, first(), raw() and run() like D1', async () => {
    const site = freshSite();
    const db = siteDb(typedEnv, site);
    const inserted = await seedEvent(db, site, 'e1', 1000);
    expect(inserted.meta.changes).toBe(1);

    const again = await db
      .prepare(
        `INSERT INTO website_event (event_id, website_id, session_id, visit_id, url_path, created_at)
         VALUES (?1, ?2, 's-e1', 's-e1', '/', 1) ON CONFLICT(event_id) DO NOTHING`,
      )
      .bind('e1', site)
      .run();
    expect(again.meta.changes).toBe(0);

    const row = await db
      .prepare('SELECT event_id, ?2 AS echoed FROM website_event WHERE website_id = ?1 AND event_id = ?2')
      .bind(site, 'e1')
      .first<{ event_id: string; echoed: string }>();
    expect(row).toEqual({ event_id: 'e1', echoed: 'e1' });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM website_event').first('n')).toBe(1);
    expect(await db.prepare('SELECT 1 WHERE 0').first()).toBeNull();

    const raw = await db.prepare('SELECT event_id, created_at FROM website_event').raw({ columnNames: true });
    expect(raw).toEqual([['event_id', 'created_at'], ['e1', 1000]]);
  });

  it('keeps websites isolated from each other', async () => {
    const a = freshSite();
    const b = freshSite();
    await seedEvent(siteDb(typedEnv, a), a, 'same-id', 1);
    await seedEvent(siteDb(typedEnv, b), b, 'same-id', 1);
    expect(await siteDb(typedEnv, a).prepare('SELECT COUNT(*) AS n FROM website_event').first('n')).toBe(1);
    expect(await siteDb(typedEnv, b).prepare('SELECT website_id FROM website_event').first('website_id')).toBe(b);
  });

  it('rolls back a whole batch when one statement fails', async () => {
    const site = freshSite();
    const db = siteDb(typedEnv, site);
    await expect(
      db.batch([
        db.prepare(`INSERT INTO session (session_id, website_id, created_at) VALUES ('ok', ?1, 1)`).bind(site),
        db.prepare(`INSERT INTO session (session_id, website_id, created_at) VALUES (NULL, ?1, 1)`).bind(site),
      ]),
    ).rejects.toThrow();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM session').first('n')).toBe(0);

    const results = await db.batch([
      db.prepare(`INSERT INTO session (session_id, website_id, created_at) VALUES ('a', ?1, 1)`).bind(site),
      db.prepare(`SELECT session_id FROM session`),
    ]);
    expect(results[0]!.meta.changes).toBe(1);
    expect(results[1]!.results).toEqual([{ session_id: 'a' }]);
  });

  it('stores properties as JSON but still exposes (and accepts) event_data rows', async () => {
    const site = freshSite();
    const db = siteDb(typedEnv, site);
    await seedEvent(db, site, 'ev', 5000);
    const insert = db.prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
       VALUES (?1, ?2, 'ev', ?3, ?4, ?5, ?6, 5000)`,
    );
    await db.batch([
      insert.bind('d1', site, 'plan', 'pro', null, 1),
      insert.bind('d2', site, 'amount', null, 42.5, 2),
      insert.bind('d3', site, 'trial', 'true', null, 3),
      insert.bind('d4', site, 'odd "key".with dots', 'ok', null, 1),
    ]);

    const props = await db.prepare(`SELECT properties FROM website_event WHERE event_id = 'ev'`).first<string>('properties');
    expect(JSON.parse(props!)).toEqual({ plan: 'pro', amount: 42.5, trial: true, 'odd "key".with dots': 'ok' });

    const rows = await db
      .prepare(
        `SELECT data_key, string_value, number_value, data_type FROM event_data
         WHERE website_id = ?1 AND website_event_id = 'ev' ORDER BY data_key`,
      )
      .bind(site)
      .all();
    expect(rows.results).toEqual([
      { data_key: 'amount', string_value: null, number_value: 42.5, data_type: 2 },
      { data_key: 'odd "key".with dots', string_value: 'ok', number_value: null, data_type: 1 },
      { data_key: 'plan', string_value: 'pro', number_value: null, data_type: 1 },
      { data_key: 'trial', string_value: 'true', number_value: null, data_type: 3 },
    ]);

    await db.prepare(`DELETE FROM event_data WHERE website_event_id = 'ev' AND data_key = 'plan'`).run();
    const after = await db.prepare(`SELECT properties FROM website_event WHERE event_id = 'ev'`).first<string>('properties');
    expect(JSON.parse(after!)).not.toHaveProperty('plan');
  });

  it('converts booleans, undefined and binary parameters and round-trips blobs', async () => {
    const site = freshSite();
    const db = siteDb(typedEnv, site);
    const bytes = new TextEncoder().encode('[{"type":2}]');
    await db
      .prepare(
        `INSERT INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at)
         VALUES ('r', ?1, 's', 'v', 0, ?2, 1, ?3, ?3, ?4)`,
      )
      .bind(site, bytes, 1, undefined)
      .run();
    const row = await db.prepare(`SELECT events, created_at FROM session_replay`).first<{ events: ArrayBuffer; created_at: null }>();
    expect(new TextDecoder().decode(row!.events)).toBe('[{"type":2}]');
    expect(row!.created_at).toBeNull();
    expect(await db.prepare('SELECT ?1 AS t, ?2 AS f').bind(true, false).first()).toEqual({ t: 1, f: 0 });
  });

  it('supports window functions and JSON queries used by insights', async () => {
    const site = freshSite();
    const db = siteDb(typedEnv, site);
    for (let i = 0; i < 3; i++) await seedEvent(db, site, `w${i}`, 100 + i);
    const ranked = await db
      .prepare(`SELECT event_id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rank FROM website_event ORDER BY rank`)
      .all<{ event_id: string; rank: number }>();
    expect(ranked.results.map((r) => r.event_id)).toEqual(['w2', 'w1', 'w0']);
  });

  it('works with drizzle through the facade', async () => {
    const site = freshSite();
    const store = siteDb(typedEnv, site);
    await seedEvent(store, site, 'dz', 7);
    const db = createDb(store);
    const rows = await db
      .select({ id: schema.websiteEvent.eventId, name: schema.websiteEvent.eventName })
      .from(schema.websiteEvent)
      .where(eq(schema.websiteEvent.websiteId, site));
    expect(rows).toEqual([{ id: 'dz', name: 'signup' }]);
  });

  it('purges expired heatmap dedup ids in its daily alarm', async () => {
    const site = freshSite();
    const db = siteDb(typedEnv, site);
    const now = Date.now();
    await db.batch([
      db.prepare(`INSERT INTO heatmap_ingest_dedup (id, website_id, created_at) VALUES ('old', ?1, ?2)`).bind(site, now - 3 * 86_400_000),
      db.prepare(`INSERT INTO heatmap_ingest_dedup (id, website_id, created_at) VALUES ('new', ?1, ?2)`).bind(site, now),
    ]);
    const stub = siteStoreStub(typedEnv, site);
    const { runDurableObjectAlarm } = await import('cloudflare:test');
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const ids = await db.prepare('SELECT id FROM heatmap_ingest_dedup ORDER BY id').all<{ id: string }>();
    expect(ids.results.map((r) => r.id)).toEqual(['new']);
  });

  it('refuses to serve a store under a different website id and can erase itself', async () => {
    const site = freshSite();
    const stub = siteStoreStub(typedEnv, site);
    await seedEvent(siteDb(typedEnv, site), site, 'x', 1);
    let mismatch: unknown = null;
    try {
      await stub.query('another-site', { sql: 'SELECT 1', params: [], mode: 'all' });
    } catch (err) {
      mismatch = err;
    }
    expect(String(mismatch)).toMatch(/addressed as/);

    const info = await stub.info();
    expect(info).toMatchObject({ websiteId: site, events: 1 });
    expect(info.sizeBytes).toBeGreaterThan(0);

    await stub.erase();
    expect(await siteDb(typedEnv, site).prepare('SELECT COUNT(*) AS n FROM website_event').first('n')).toBe(0);
  });
});
