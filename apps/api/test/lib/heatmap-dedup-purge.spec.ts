import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { siteStoreStub } from '../../src/lib/site-db';
import { runRetentionPurge } from '../../src/lib/retention';
import { testSiteDb } from '../helpers/site-db';
import { applyTestMigrations } from '../helpers/migrations';

const DAY = 86_400_000;
const SITE = 'dedup-purge-site';

// Dedup ids only need to outlive queue redelivery. Each website store prunes its own in a
// daily alarm, so no cron has to walk every website.
describe('heatmap dedup pruning', () => {
  it('drops ids older than the redelivery window and keeps recent ones', async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    await testSiteDb(SITE)
      .prepare(
        `INSERT OR IGNORE INTO heatmap_ingest_dedup (id, website_id, created_at)
         VALUES ('dedup-old', ?1, ?2), ('dedup-fresh', ?1, ?3)`,
      )
      .bind(SITE, now - 5 * DAY, now - 60_000)
      .run();

    // The retention cron leaves per-site dedup ids alone in store mode ...
    await runRetentionPurge(env as unknown as Env, now);
    const before = await testSiteDb(SITE).prepare('SELECT COUNT(*) AS n FROM heatmap_ingest_dedup').first('n');
    expect(before).toBe(2);

    // ... the store's alarm prunes them.
    expect(await runDurableObjectAlarm(siteStoreStub(env as unknown as Env, SITE))).toBe(true);
    const rows = await testSiteDb(SITE).prepare('SELECT id FROM heatmap_ingest_dedup ORDER BY id').all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(['dedup-fresh']);
  });
});
