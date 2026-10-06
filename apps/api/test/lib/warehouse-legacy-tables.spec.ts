import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { createWarehouseDataSource, deleteWarehouseDataSource, getWarehouseDataSource } from '../../src/lib/warehouse';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const testEnv = env as unknown as Env;

/** D1 without its old analytics tables, as after the store migration's final cleanup. */
function withoutLegacyTables(error = 'D1_ERROR: no such table: warehouse_import: SQLITE_ERROR'): Env {
  const db = testEnv.DB;
  const legacy = {
    bind: () => legacy,
    run: () => Promise.reject(new Error(error)),
  };
  const DB = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql: string) => (/DELETE FROM warehouse_import/.test(sql) ? legacy : target.prepare(sql));
      }
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...testEnv, DB } as Env;
}

describe('deleting a data source after the old D1 analytics tables are gone', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  const create = (name: string) =>
    createWarehouseDataSource(testEnv, TEST_WEBSITE_ID, null, {
      name,
      type: 'http_json',
      enabled: false,
      config: { url: 'https://example.com/export.json' },
    });

  it('still deletes it', async () => {
    const source = await create('legacy-table-dropped');
    expect(await deleteWarehouseDataSource(withoutLegacyTables(), TEST_WEBSITE_ID, source.id)).toBe(true);
    expect(await getWarehouseDataSource(testEnv, TEST_WEBSITE_ID, source.id)).toBeNull();
  });

  it('does not hide other database errors', async () => {
    const source = await create('legacy-table-broken');
    await expect(
      deleteWarehouseDataSource(withoutLegacyTables('D1_ERROR: database is locked'), TEST_WEBSITE_ID, source.id),
    ).rejects.toThrow('database is locked');
  });
});
