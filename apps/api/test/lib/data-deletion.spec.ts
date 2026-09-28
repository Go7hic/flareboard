import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_TYPE, ROLES } from '@flareboard/shared';
import { DELETION_GRACE_DAYS, runDataDeletion, websiteScopedTables } from '../../src/lib/data-deletion';
import { applyTestMigrations } from '../helpers/migrations';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28, 12);
const LONG_AGO = NOW - (DELETION_GRACE_DAYS + 1) * DAY;
const RECENT = NOW - 5 * DAY;

const OWNER = 'dd-owner';
const GONE_USER = 'dd-gone-user';
const TEAMMATE = 'dd-teammate';
const LIVE_TEAM = '5e0c1d2a-7b3f-4c9e-8a1d-000000000d01';
const PURGED_SITE = 'dd-site-purged';
const GRACE_SITE = 'dd-site-grace';
const LIVE_SITE = 'dd-site-live';
const TEAM_SITE = 'dd-site-team';
const GONE_USER_SITE = 'dd-site-gone-user';

async function run(sql: string, ...binds: unknown[]) {
  await env.DB.prepare(sql).bind(...binds).run();
}

async function count(sql: string, ...binds: unknown[]) {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

/** One of every foreign-key chain that hangs off a website, plus a replay object in R2. */
async function seedWebsiteData(websiteId: string) {
  const s = `${websiteId}-session`;
  const e = `${websiteId}-event`;
  const flag = `${websiteId}-flag`;
  const survey = `${websiteId}-survey`;
  await run(`INSERT INTO session (session_id, website_id, created_at) VALUES (?1, ?2, ?3)`, s, websiteId, LONG_AGO);
  await run(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, url_path, created_at)
     VALUES (?1, ?2, ?3, 'visit-1', '/', ?4)`,
    e,
    websiteId,
    s,
    LONG_AGO,
  );
  await run(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, data_type, created_at)
     VALUES (?1, ?2, ?3, 'plan', 1, ?4)`,
    `${websiteId}-data`,
    websiteId,
    e,
    LONG_AGO,
  );
  await run(
    `INSERT INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at)
     VALUES (?1, ?2, ?3, 'visit-1', 0, x'', 1, ?4, ?4, ?4)`,
    `${websiteId}-replay`,
    websiteId,
    s,
    LONG_AGO,
  );
  await env.REPLAY_BUCKET!.put(`${websiteId}/visit-1/0`, '[]');
  await run(`INSERT INTO feature_flag (flag_id, website_id, key, name) VALUES (?1, ?2, 'beta', 'Beta')`, flag, websiteId);
  await run(
    `INSERT INTO experiment (experiment_id, website_id, feature_flag_id, name, goal_event) VALUES (?1, ?2, ?3, 'Exp', 'signup')`,
    `${websiteId}-exp`,
    websiteId,
    flag,
  );
  await run(`INSERT INTO survey (survey_id, website_id, name, question) VALUES (?1, ?2, 'S', 'Q?')`, survey, websiteId);
  await run(
    `INSERT INTO survey_response (response_id, survey_id, website_id, answer) VALUES (?1, ?2, ?3, 'yes')`,
    `${websiteId}-resp`,
    survey,
    websiteId,
  );
  await run(
    `INSERT INTO rollup_stats_daily (website_id, day, pageviews, visitors, visits, bounces, totaltime_sec)
     VALUES (?1, '2026-08-01', 1, 1, 1, 0, 0)`,
    websiteId,
  );
  await run(
    `INSERT INTO share (share_id, entity_id, name, share_type, slug, parameters) VALUES (?1, ?2, 'Public', ?3, ?4, '{}')`,
    `${websiteId}-share`,
    websiteId,
    ENTITY_TYPE.website,
    `${websiteId}-slug`,
  );
  await run(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at) VALUES (?1, ?2, 'create', 'website', ?3, ?4)`,
    `${websiteId}-audit`,
    OWNER,
    websiteId,
    LONG_AGO,
  );
  // Feature flag history outlives the flag and names its website in the metadata.
  await run(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, metadata, created_at)
     VALUES (?1, ?2, 'delete', 'feature_flag', ?3, ?4, ?5)`,
    `${websiteId}-flag-audit`,
    OWNER,
    `${websiteId}-deleted-flag`,
    JSON.stringify({ websiteId, key: 'old', before: { key: 'old' }, after: null }),
    LONG_AGO,
  );
}

async function flagHistoryRows(websiteId: string) {
  return count(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'feature_flag' AND entity_id = ?1`, `${websiteId}-deleted-flag`);
}

async function websiteRows(websiteId: string) {
  let total = 0;
  for (const table of await websiteScopedTables(env)) {
    total += await count(`SELECT COUNT(*) AS n FROM ${table} WHERE website_id = ?1`, websiteId);
  }
  return total;
}

describe('scheduled data deletion', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await run(
      `INSERT INTO user (user_id, username, password, role, created_at, updated_at, deleted_at)
       VALUES (?1, 'dd-owner', 'x', ?4, ?5, ?5, NULL),
              (?2, 'dd-gone@example.com', 'x', ?4, ?5, ?5, ?6),
              (?3, 'dd-teammate', 'x', ?4, ?5, ?5, NULL)`,
      OWNER,
      GONE_USER,
      TEAMMATE,
      ROLES.user,
      LONG_AGO,
      LONG_AGO,
    );
    await run(`INSERT INTO team (team_id, name, access_code, created_at, updated_at) VALUES (?1, 'Live team', 'ddlive', ?2, ?2)`, LIVE_TEAM, LONG_AGO);
    await run(
      `INSERT INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
       VALUES ('dd-tu-gone', ?1, ?2, ?4, ?5, ?5), ('dd-tu-mate', ?1, ?3, ?4, ?5, ?5)`,
      LIVE_TEAM,
      GONE_USER,
      TEAMMATE,
      ROLES.teamOwner,
      LONG_AGO,
    );
    await run(
      `INSERT INTO website (website_id, name, user_id, team_id, created_by, created_at, updated_at, deleted_at) VALUES
         (?1, 'Purged', ?6, NULL, ?6, ?8, ?8, ?8),
         (?2, 'Grace', ?6, NULL, ?6, ?8, ?8, ?9),
         (?3, 'Live', ?6, NULL, ?6, ?8, ?8, NULL),
         (?4, 'Team', ?7, ?10, ?7, ?8, ?8, NULL),
         (?5, 'Gone user personal', ?7, NULL, ?7, ?8, ?8, NULL)`,
      PURGED_SITE,
      GRACE_SITE,
      LIVE_SITE,
      TEAM_SITE,
      GONE_USER_SITE,
      OWNER,
      GONE_USER,
      LONG_AGO,
      RECENT,
      LIVE_TEAM,
    );
    for (const site of [PURGED_SITE, GRACE_SITE, LIVE_SITE, GONE_USER_SITE]) await seedWebsiteData(site);

    // The deleted user's own content, and team content they authored.
    await run(`INSERT INTO link (link_id, name, url, slug, user_id) VALUES ('dd-link', 'L', 'https://x.test', 'dd-link', ?1)`, GONE_USER);
    await run(
      `INSERT INTO link_pixel_hit (hit_id, source_type, source_id, visitor_id, created_at) VALUES ('dd-hit', 'link', 'dd-link', 'v', ?1)`,
      LONG_AGO,
    );
    await run(
      `INSERT INTO board (board_id, type, name, description, parameters, user_id, team_id) VALUES
         ('dd-board-own', 'custom', 'Mine', '', '{}', ?1, NULL),
         ('dd-board-team', 'custom', 'Team board', '', '{}', ?1, ?2)`,
      GONE_USER,
      LIVE_TEAM,
    );
    await run(
      `INSERT INTO share (share_id, entity_id, name, share_type, slug, parameters) VALUES ('dd-board-share', 'dd-board-own', 'B', ?1, 'dd-board-share', '{}')`,
      ENTITY_TYPE.board,
    );
    await run(
      `INSERT INTO insight (insight_id, website_id, user_id, type, name, query) VALUES ('dd-insight', ?1, ?2, 'trend', 'I', '{}')`,
      TEAM_SITE,
      GONE_USER,
    );
    await run(`INSERT INTO user_subscription (user_id, plan_id, status) VALUES (?1, 'cloud', 'canceled')`, GONE_USER);
    await run(
      `INSERT INTO user_oauth_identity (provider, provider_user_id, user_id, created_at) VALUES ('github', 'dd-gh', ?1, ?2)`,
      GONE_USER,
      LONG_AGO,
    );
    await run(
      `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at) VALUES ('dd-audit-user', ?1, 'login', 'user', ?1, ?2)`,
      GONE_USER,
      LONG_AGO,
    );

    await run(
      `INSERT INTO dead_event (dead_event_id, queue, payload_json, created_at) VALUES ('dd-dead-old', 'q', '{}', ?1), ('dd-dead-new', 'q', '{}', ?2)`,
      LONG_AGO,
      RECENT,
    );

    // Two ticks: the first soft-deletes the gone user's personal site, the second erases it and the user.
    await runDataDeletion(env, NOW);
    await runDataDeletion(env, NOW);
  });

  it('orders website tables so children are deleted before the tables they reference', async () => {
    const order = await websiteScopedTables(env);
    const before = (child: string, parent: string) => order.indexOf(child) < order.indexOf(parent);
    expect(before('event_data', 'website_event')).toBe(true);
    expect(before('website_event', 'session')).toBe(true);
    expect(before('experiment', 'feature_flag')).toBe(true);
    expect(before('survey_response', 'survey')).toBe(true);
    expect(order).not.toContain('website');
  });

  it('erases a website deleted more than the grace period ago, including R2 replays and shares', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM website WHERE website_id = ?1', PURGED_SITE)).toBe(0);
    expect(await websiteRows(PURGED_SITE)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM share WHERE entity_id = ?1', PURGED_SITE)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'website' AND entity_id = ?1`, PURGED_SITE)).toBe(0);
    expect(await flagHistoryRows(PURGED_SITE)).toBe(0);
    expect((await env.REPLAY_BUCKET!.list({ prefix: `${PURGED_SITE}/` })).objects).toHaveLength(0);
  });

  it('keeps websites still inside the grace period and live websites untouched', async () => {
    for (const site of [GRACE_SITE, LIVE_SITE]) {
      expect(await count('SELECT COUNT(*) AS n FROM website WHERE website_id = ?1', site)).toBe(1);
      expect(await websiteRows(site)).toBeGreaterThan(5);
      expect(await flagHistoryRows(site)).toBe(1);
      expect((await env.REPLAY_BUCKET!.list({ prefix: `${site}/` })).objects).toHaveLength(1);
    }
  });

  it('erases a deleted account, its personal websites and its own links, boards and records', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM user WHERE user_id = ?1', GONE_USER)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM website WHERE website_id = ?1', GONE_USER_SITE)).toBe(0);
    expect(await websiteRows(GONE_USER_SITE)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM link WHERE link_id = 'dd-link'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM link_pixel_hit WHERE source_id = 'dd-link'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM board WHERE board_id = 'dd-board-own'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM share WHERE share_id = 'dd-board-share'`)).toBe(0);
    for (const table of ['insight', 'user_subscription', 'user_oauth_identity', 'audit_log', 'team_user']) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`, GONE_USER)).toBe(0);
    }
  });

  it('keeps shared team content with the deleted author cleared', async () => {
    const teamSite = await env.DB.prepare('SELECT user_id AS userId, created_by AS createdBy, deleted_at AS deletedAt FROM website WHERE website_id = ?1')
      .bind(TEAM_SITE)
      .first<{ userId: string | null; createdBy: string | null; deletedAt: number | null }>();
    expect(teamSite).toEqual({ userId: null, createdBy: null, deletedAt: null });
    const board = await env.DB.prepare(`SELECT user_id AS userId FROM board WHERE board_id = 'dd-board-team'`).first<{ userId: string | null }>();
    expect(board).toEqual({ userId: null });
    expect(await count(`SELECT COUNT(*) AS n FROM team_user WHERE user_id = ?1`, TEAMMATE)).toBe(1);
  });

  it('prunes failed queue payloads older than the grace period only', async () => {
    expect(await count(`SELECT COUNT(*) AS n FROM dead_event WHERE dead_event_id = 'dd-dead-old'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM dead_event WHERE dead_event_id = 'dd-dead-new'`)).toBe(1);
  });
});
