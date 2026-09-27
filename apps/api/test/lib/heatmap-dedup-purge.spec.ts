import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { runRetentionPurge } from '../../src/lib/retention';
import { applyTestMigrations } from '../helpers/migrations';

const NOW = Date.UTC(2026, 6, 1, 12);
const DAY = 86_400_000;

describe('heatmap dedup pruning', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO heatmap_ingest_dedup (id, website_id, created_at)
       VALUES ('dedup-old', 'site', ?1), ('dedup-fresh', 'site', ?2)`,
    )
      .bind(NOW - 5 * DAY, NOW - 60_000)
      .run();
  });

  it('drops ids older than the redelivery window and keeps recent ones', async () => {
    await runRetentionPurge(env, NOW);
    const rows = await env.DB.prepare('SELECT id FROM heatmap_ingest_dedup ORDER BY id').all<{ id: string }>();
    expect((rows.results ?? []).map((r) => r.id)).toEqual(['dedup-fresh']);
  });
});
