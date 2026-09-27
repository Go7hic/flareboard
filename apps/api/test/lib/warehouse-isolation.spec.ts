import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { runWarehouseQuery } from '../../src/lib/warehouse';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const OTHER_WEBSITE_ID = '00000000-0000-0000-0000-0000000000f7';
const OTHER_USER_ID = 'warehouse-isolation-victim';
const SECRET_HASH = 'victim-password-hash';
const BASE = Date.UTC(2026, 0, 6, 12);

/** Runs a query and returns everything it produced, or [] if it was rejected. */
async function leakedValues(sql: string): Promise<string[]> {
  try {
    const result = await runWarehouseQuery(env, TEST_WEBSITE_ID, sql);
    return result.rows.flatMap((row) => Object.values(row).map(String));
  } catch {
    return [];
  }
}

describe('warehouse tenant isolation', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'warehouse-victim', ?2, 'user', ?3, ?3)`,
    )
      .bind(OTHER_USER_ID, SECRET_HASH, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Victim', 'victim.example', ?2, ?3, ?3)`,
    )
      .bind(OTHER_WEBSITE_ID, OTHER_USER_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('victim-session', ?1, ?2)`,
    )
      .bind(OTHER_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES ('victim-event', ?1, 'victim-session', 'victim-session', ?2, '/victim-secret', ?3, 'victim_event')`,
    )
      .bind(OTHER_WEBSITE_ID, BASE, EVENT_TYPE.customEvent)
      .run();
  });

  it.each([
    ['always-true predicate', `SELECT url_path FROM website_event WHERE website_id = ?1 OR 2 > 1`],
    ['scope only in a subquery', `SELECT url_path, (SELECT 1 WHERE website_id = ?1) AS s FROM website_event`],
    ['scope only in a join condition', `SELECT b.url_path FROM website_event a JOIN website_event b ON a.website_id = ?1`],
    ['case expression', `SELECT url_path FROM website_event WHERE website_id = ?1 OR CASE WHEN 1 THEN 1 END`],
  ])('does not return other websites’ events: %s', async (_label, sql) => {
    expect(await leakedValues(sql)).not.toContain('/victim-secret');
  });

  it.each([
    ['double-quoted table', `SELECT (SELECT password FROM "user" LIMIT 1) AS p FROM website_event WHERE website_id = ?1`],
    ['bracket-quoted table', `SELECT (SELECT password FROM [user] LIMIT 1) AS p FROM website_event WHERE website_id = ?1`],
    ['backtick-quoted table', 'SELECT (SELECT password FROM `user` LIMIT 1) AS p FROM website_event WHERE website_id = ?1'],
    ['parenthesized table', `SELECT (SELECT password FROM (user) LIMIT 1) AS p FROM website_event WHERE website_id = ?1`],
    ['schema-qualified table', `SELECT (SELECT password FROM main.user LIMIT 1) AS p FROM website_event WHERE website_id = ?1`],
    ['schema-qualified allowlisted table', `SELECT url_path AS p FROM main.website_event WHERE website_id = ?1 OR 1`],
  ])('does not read tables outside the allowlist: %s', async (_label, sql) => {
    const values = await leakedValues(sql);
    expect(values).not.toContain(SECRET_HASH);
    expect(values).not.toContain('/victim-secret');
  });

  it('still answers normal scoped queries, including user CTEs', async () => {
    const result = await runWarehouseQuery(
      env,
      TEST_WEBSITE_ID,
      `WITH recent AS (SELECT event_id FROM website_event WHERE website_id = ?1)
       SELECT COUNT(*) AS n FROM recent`,
    );
    expect(result.columns).toEqual(['n']);
  });
});
