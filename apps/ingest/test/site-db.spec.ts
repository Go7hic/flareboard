import { env } from 'cloudflare:workers';
import { upsertPerson } from '@flareboard/db';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { writeSiteTables } from '../src/lib/site-db';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { testSiteDb } from './helpers/site-db';

const baseEnv = env as unknown as Env;

async function personIn(db: D1Database, distinctId: string) {
  return db
    .prepare(`SELECT distinct_id AS id FROM person WHERE website_id = ?1 AND distinct_id = ?2`)
    .bind(TEST_WEBSITE_ID, distinctId)
    .first<{ id: string }>();
}

describe('ingest writes to website analytics tables', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('writes to D1 and the website store while migrating (dual)', async () => {
    const dual = { ...baseEnv, EVENT_STORE: 'dual' };
    await writeSiteTables(dual, TEST_WEBSITE_ID, (db) =>
      upsertPerson(db, { websiteId: TEST_WEBSITE_ID, distinctId: 'dual-user', seenAt: Date.now() }),
    );
    expect(await personIn(env.DB, 'dual-user')).toEqual({ id: 'dual-user' });
    expect(await personIn(testSiteDb(TEST_WEBSITE_ID), 'dual-user')).toEqual({ id: 'dual-user' });
  });

  it('writes only to D1 in legacy mode and only to the store in do mode', async () => {
    await writeSiteTables({ ...baseEnv, EVENT_STORE: 'd1' }, TEST_WEBSITE_ID, (db) =>
      upsertPerson(db, { websiteId: TEST_WEBSITE_ID, distinctId: 'd1-user', seenAt: Date.now() }),
    );
    expect(await personIn(env.DB, 'd1-user')).toEqual({ id: 'd1-user' });
    expect(await personIn(testSiteDb(TEST_WEBSITE_ID), 'd1-user')).toBeNull();

    await writeSiteTables({ ...baseEnv, EVENT_STORE: 'do' }, TEST_WEBSITE_ID, (db) =>
      upsertPerson(db, { websiteId: TEST_WEBSITE_ID, distinctId: 'do-user', seenAt: Date.now() }),
    );
    expect(await personIn(env.DB, 'do-user')).toBeNull();
    expect(await personIn(testSiteDb(TEST_WEBSITE_ID), 'do-user')).toEqual({ id: 'do-user' });
  });
});
