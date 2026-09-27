import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const OWNER_ID = 'stats-reset-owner';
const WEBSITE_ID = 'stats-reset-site';
const START = Date.UTC(2026, 2, 10, 8);
const RESET_AT = START + 2 * 3_600_000;
const END = START + 4 * 3_600_000;

async function pageviews(): Promise<number> {
  const token = await createSecureToken({ userId: OWNER_ID, role: ROLES.user }, env.APP_SECRET);
  const { response, body } = await fetchWorkerJson<{ pageviews: { value: number } }>(
    `/api/websites/${WEBSITE_ID}/stats?startAt=${START}&endAt=${END}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.status).toBe(200);
  return body.pageviews.value;
}

describe('statistics reset', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'stats-reset-owner', 'hash', ?2, ?3, ?3)`,
    )
      .bind(OWNER_ID, ROLES.user, START)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Reset', 'reset.example', ?2, ?3, ?3)`,
    )
      .bind(WEBSITE_ID, OWNER_ID, START)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('stats-reset-session', ?1, ?2)`,
    )
      .bind(WEBSITE_ID, START)
      .run();
    const times = [START + 60_000, START + 3_600_000, RESET_AT + 60_000];
    for (const [i, at] of times.entries()) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type)
         VALUES (?1, ?2, 'stats-reset-session', ?3, ?4, '/', ?5)`,
      )
        .bind(`stats-reset-${i}`, WEBSITE_ID, `stats-reset-visit-${i}`, at, EVENT_TYPE.pageView)
        .run();
    }
  });

  it('counts every event before a reset is set', async () => {
    expect(await pageviews()).toBe(3);
  });

  it('excludes events before resetAt once it is set', async () => {
    await env.DB.prepare('UPDATE website SET reset_at = ?1 WHERE website_id = ?2').bind(RESET_AT, WEBSITE_ID).run();
    await env.CACHE.delete(`website:${WEBSITE_ID}`);
    expect(await pageviews()).toBe(1);
  });
});
