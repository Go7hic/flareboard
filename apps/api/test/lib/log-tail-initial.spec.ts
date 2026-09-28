import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getLogTail } from '../../src/lib/logs';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const BASE = Date.UTC(2026, 4, 2, 9);

describe('log tail', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await testSiteDb(TEST_WEBSITE_ID).prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('tail-initial-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    for (let i = 0; i < 4; i++) {
      await testSiteDb(TEST_WEBSITE_ID).prepare(
        `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
         VALUES (?1, ?2, 'tail-initial-session', 'tail-initial-session', ?3, '/', ?4, 'log')`,
      )
        .bind(`tail-initial-${i}`, TEST_WEBSITE_ID, BASE + i * 1000, EVENT_TYPE.log)
        .run();
    }
  });

  it('opens on the newest lines, oldest first', async () => {
    const rows = await getLogTail(env, TEST_WEBSITE_ID, 0, {}, 2);
    expect(rows.map((r) => r.id).filter((id) => id.startsWith('tail-initial-'))).toEqual([
      'tail-initial-2',
      'tail-initial-3',
    ]);
  });

  it('pages forward from a cursor without skipping', async () => {
    const rows = await getLogTail(env, TEST_WEBSITE_ID, BASE, {}, 2);
    expect(rows.map((r) => r.id)).toEqual(['tail-initial-1', 'tail-initial-2']);
  });
});
