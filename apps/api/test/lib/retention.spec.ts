import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { runRetentionPurge } from '../../src/lib/retention';
import { applyTestMigrations } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const SITE = 'retention-site';
const KEEP_SITE = 'retention-keep-site';
const NOW = Date.UTC(2026, 5, 1, 12);
const OLD = NOW - 40 * 24 * 60 * 60 * 1000;
const RECENT = NOW - 2 * 24 * 60 * 60 * 1000;

async function seedEvent(id: string, websiteId: string, createdAt: number) {
  await testSiteDb(websiteId).prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES (?1, ?2, ?3)`,
  )
    .bind(`sess-${id}`, websiteId, createdAt)
    .run();
  await testSiteDb(websiteId).prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/', ?5, null)`,
  )
    .bind(id, websiteId, `sess-${id}`, createdAt, EVENT_TYPE.pageView)
    .run();
  await testSiteDb(websiteId).prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES (?1, ?2, ?3, 'k', 'v', 1, ?4)`,
  )
    .bind(`data-${id}`, websiteId, id, createdAt)
    .run();
}

async function eventIds(websiteId: string) {
  const rows = await testSiteDb(websiteId).prepare(`SELECT event_id FROM website_event WHERE website_id = ?1 ORDER BY event_id`)
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
    for (const [visit, at] of [['old-visit', OLD], ['recent-visit', RECENT]] as const) {
      await testSiteDb(SITE).prepare(
        `INSERT INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at)
         VALUES (?1, ?2, 'sess-old-1', ?3, 0, x'', 1, ?4, ?4, ?4)`,
      )
        .bind(`replay-${visit}`, SITE, visit, at)
        .run();
      await testSiteDb(SITE).prepare(
        `INSERT INTO session_replay_summary (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks)
         VALUES (?1, ?2, 'sess-old-1', ?3, ?3, 1, 1)`,
      )
        .bind(SITE, visit, at)
        .run();
      await env.REPLAY_BUCKET!.put(`${SITE}/${visit}/0`, '[]');
    }
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

  it('deletes expired session replay recordings from R2 along with their rows and summaries', async () => {
    const visits = async (table: string) =>
      (
        await testSiteDb(SITE).prepare(`SELECT visit_id AS v FROM ${table} WHERE website_id = ?1 ORDER BY visit_id`)
          .bind(SITE)
          .all<{ v: string }>()
      ).results?.map((row) => row.v) ?? [];
    expect(await visits('session_replay')).toEqual(['recent-visit']);
    expect(await visits('session_replay_summary')).toEqual(['recent-visit']);
    expect(await env.REPLAY_BUCKET!.head(`${SITE}/old-visit/0`)).toBeNull();
    expect(await env.REPLAY_BUCKET!.head(`${SITE}/recent-visit/0`)).not.toBeNull();
  });
});

describe('runRetentionPurge on hosted installs', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const FREE_SITE = 'retention-free-site';
  const CLOUD_SITE = 'retention-cloud-site';

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    for (const [userId, planId] of [['retention-free-owner', 'free'], ['retention-cloud-owner', 'cloud']] as const) {
      await env.DB.prepare(`INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (?1, ?1, 'x', 'user', ?2, ?2)`)
        .bind(userId, now)
        .run();
      await env.DB.prepare(`INSERT OR REPLACE INTO user_subscription (user_id, plan_id, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)`)
        .bind(userId, planId, now)
        .run();
    }
    // Free with no setting gets the plan maximum (365 days); Cloud's longer setting is capped at 730.
    await env.DB.prepare(
      `INSERT OR REPLACE INTO website (website_id, name, user_id, retention_days, created_at, updated_at)
       VALUES (?1, 'F', 'retention-free-owner', NULL, ?3, ?3), (?2, 'C', 'retention-cloud-owner', 3650, ?3, ?3)`,
    )
      .bind(FREE_SITE, CLOUD_SITE, now)
      .run();
    await seedEvent('free-400d', FREE_SITE, NOW - 400 * DAY);
    await seedEvent('free-300d', FREE_SITE, NOW - 300 * DAY);
    await seedEvent('cloud-800d', CLOUD_SITE, NOW - 800 * DAY);
    await seedEvent('cloud-700d', CLOUD_SITE, NOW - 700 * DAY);
  });

  it("caps every website's retention at its owner's plan maximum", async () => {
    await runRetentionPurge({ ...env, HOSTED_MODE: 'true' }, NOW);
    expect(await eventIds(FREE_SITE)).toEqual(['free-300d']);
    expect(await eventIds(CLOUD_SITE)).toEqual(['cloud-700d']);
  });
});
