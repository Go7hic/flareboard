import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { runRetentionPurge } from '../../src/lib/retention';
import { applyTestMigrations } from '../helpers/migrations';

const SITE = 'retention-site';
const KEEP_SITE = 'retention-keep-site';
const NOW = Date.UTC(2026, 5, 1, 12);
const OLD = NOW - 40 * 24 * 60 * 60 * 1000;
const RECENT = NOW - 2 * 24 * 60 * 60 * 1000;

async function seedEvent(id: string, websiteId: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES (?1, ?2, ?3)`,
  )
    .bind(`sess-${id}`, websiteId, createdAt)
    .run();
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/', ?5, null)`,
  )
    .bind(id, websiteId, `sess-${id}`, createdAt, EVENT_TYPE.pageView)
    .run();
  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES (?1, ?2, ?3, 'k', 'v', 1, ?4)`,
  )
    .bind(`data-${id}`, websiteId, id, createdAt)
    .run();
}

async function eventIds(websiteId: string) {
  const rows = await env.DB.prepare(`SELECT event_id FROM website_event WHERE website_id = ?1 ORDER BY event_id`)
    .bind(websiteId)
    .all<{ event_id: string }>();
  return (rows.results ?? []).map((r) => r.event_id);
}

describe('runRetentionPurge', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO website (website_id, name, retention_days, created_at, updated_at) VALUES (?1, 'R', 7, ?2, ?2)`,
    )
      .bind(SITE, now)
      .run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO website (website_id, name, retention_days, created_at, updated_at) VALUES (?1, 'K', NULL, ?2, ?2)`,
    )
      .bind(KEEP_SITE, now)
      .run();
    await seedEvent('old-1', SITE, OLD);
    await seedEvent('recent-1', SITE, RECENT);
    await seedEvent('keep-old-1', KEEP_SITE, OLD);
  });

  it('purges rows past the retention window and leaves opted-out sites untouched', async () => {
    const result = await runRetentionPurge(env, NOW);
    expect(result.deleted).toBeGreaterThanOrEqual(2);

    expect(await eventIds(SITE)).toEqual(['recent-1']);
    expect(await eventIds(KEEP_SITE)).toEqual(['keep-old-1']);

    const orphanData = await env.DB.prepare(
      `SELECT event_data_id FROM event_data WHERE website_event_id = 'old-1'`,
    ).all();
    expect(orphanData.results ?? []).toHaveLength(0);
  });
});
