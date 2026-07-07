import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { syncWarehouseDataSource } from '../../src/lib/warehouse';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

describe('syncWarehouseDataSource', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('imports http_json rows into warehouse_import with idempotent upsert', async () => {
    const now = Date.UTC(2026, 0, 21, 12);
    const dataSourceId = 'warehouse-source-json';
    await env.DB.prepare(
      `INSERT INTO warehouse_data_source
       (data_source_id, website_id, name, type, enabled, config_json, created_at, updated_at)
       VALUES (?1, ?2, 'CRM users', 'http_json', 1, ?3, ?4, ?4)`,
    )
      .bind(
        dataSourceId,
        TEST_WEBSITE_ID,
        JSON.stringify({ url: 'https://example.com/users.json', primaryKey: 'userId' }),
        now,
      )
      .run();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { userId: 'u-1', email: 'one@example.com' },
          { userId: 'u-2', email: 'two@example.com' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const first = await syncWarehouseDataSource(env, TEST_WEBSITE_ID, dataSourceId, now);
    expect(first).toMatchObject({ ok: true, skipped: false, imported: 2 });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ userId: 'u-1', email: 'one-updated@example.com' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const second = await syncWarehouseDataSource(env, TEST_WEBSITE_ID, dataSourceId, now + 60_000);
    expect(second).toMatchObject({ ok: true, skipped: false, imported: 1 });

    const row = await env.DB.prepare(
      `SELECT payload_json as payloadJson
       FROM warehouse_import
       WHERE website_id = ?1 AND data_source_id = ?2 AND primary_key = 'u-1'
       LIMIT 1`,
    )
      .bind(TEST_WEBSITE_ID, dataSourceId)
      .first<{ payloadJson: string }>();

    expect(JSON.parse(row!.payloadJson)).toEqual({ userId: 'u-1', email: 'one-updated@example.com' });
    fetchMock.mockRestore();
  });

  it('imports http_csv rows into warehouse_import with header parsing', async () => {
    const now = Date.UTC(2026, 0, 22, 12);
    const dataSourceId = 'warehouse-source-csv';
    await env.DB.prepare(
      `INSERT INTO warehouse_data_source
       (data_source_id, website_id, name, type, enabled, config_json, created_at, updated_at)
       VALUES (?1, ?2, 'CRM CSV', 'http_csv', 1, ?3, ?4, ?4)`,
    )
      .bind(
        dataSourceId,
        TEST_WEBSITE_ID,
        JSON.stringify({ url: 'https://example.com/users.csv', primaryKey: 'userId' }),
        now,
      )
      .run();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('userId,email\nu-1,one@example.com\nu-2,two@example.com\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      }),
    );

    const result = await syncWarehouseDataSource(env, TEST_WEBSITE_ID, dataSourceId, now);
    expect(result).toMatchObject({ ok: true, skipped: false, imported: 2 });

    const row = await env.DB.prepare(
      `SELECT payload_json as payloadJson
       FROM warehouse_import
       WHERE website_id = ?1 AND data_source_id = ?2 AND primary_key = 'u-2'
       LIMIT 1`,
    )
      .bind(TEST_WEBSITE_ID, dataSourceId)
      .first<{ payloadJson: string }>();

    expect(JSON.parse(row!.payloadJson)).toEqual({ userId: 'u-2', email: 'two@example.com' });
    fetchMock.mockRestore();
  });
});
