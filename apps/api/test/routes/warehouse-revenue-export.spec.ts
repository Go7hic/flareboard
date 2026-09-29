import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const WEBSITE_ID = 'export-site-0000-0000-000000000042';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 3, 1);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function parseCsv(text: string) {
  return text
    .trim()
    .split('\n')
    .map((line) => line.split(','));
}

describe('warehouse and revenue CSV exports', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Export', 'export.test', ?2, 0, 0)`,
    )
      .bind(WEBSITE_ID, TEST_USER_ID)
      .run();
    const db = testSiteDb(WEBSITE_ID);
    // 1,205 revenue rows: more than one export page (1,000) and more than the interactive cap.
    const statements = [];
    for (let i = 0; i < 1205; i++) {
      statements.push(
        db
          .prepare(
            `INSERT INTO revenue (revenue_id, website_id, session_id, event_id, event_name, currency, revenue, created_at)
             VALUES (?1, ?2, 's-1', ?1, ?3, 'USD', ?4, ?5)`,
          )
          .bind(`rev-${String(i).padStart(4, '0')}`, WEBSITE_ID, i === 0 ? '=cmd()' : 'purchase', 1 + (i % 3), T0 + (i % 10) * 1000),
      );
    }
    for (let offset = 0; offset < statements.length; offset += 200) {
      await db.batch(statements.slice(offset, offset + 200));
    }
    await db
      .prepare(
        `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, utm_source, event_type)
         VALUES ('pv-1', ?1, 's-1', 'v-1', ?2, '/', 'newsletter', 1)`,
      )
      .bind(WEBSITE_ID, T0 - 1000)
      .run();
  });

  it('streams every revenue transaction in the range as CSV, newest first, across export pages', async () => {
    const response = await fetchWorker(
      `/api/websites/${WEBSITE_ID}/revenue/export?table=transactions&startAt=${T0 - DAY}&endAt=${T0 + DAY}`,
      { headers: await authHeader() },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('x-row-cap')).toBe('50000');
    const rows = parseCsv(await response.text());
    expect(rows[0]).toEqual(['createdAt', 'source', 'eventName', 'currency', 'amount', 'sessionId', 'distinctId', 'transactionId']);
    const body = rows.slice(1);
    expect(body).toHaveLength(1205);
    expect(new Set(body.map((row) => row[7])).size).toBe(1205);
    expect(body[0]![0]).toBe(new Date(T0 + 9000).toISOString());
    // Spreadsheet formulas coming from event names are neutralized.
    expect(body.find((row) => row[7] === 'rev-0000')![2]).toBe("'=cmd()");
  });

  it('exports attribution and MRR tables and validates the table name', async () => {
    const headers = await authHeader();
    const attribution = await fetchWorker(
      `/api/websites/${WEBSITE_ID}/revenue/export?table=attribution&dimension=utm_source&startAt=${T0 - DAY}&endAt=${T0 + DAY}`,
      { headers },
    );
    const rows = parseCsv(await attribution.text());
    expect(rows[0]).toEqual(['utm_source', 'currency', 'total', 'transactions', 'customers']);
    expect(rows[1]!.slice(0, 2)).toEqual(['newsletter', 'USD']);
    expect(rows[1]![3]).toBe('1205');

    const mrr = await fetchWorker(`/api/websites/${WEBSITE_ID}/revenue/export?table=mrr`, { headers });
    expect(mrr.status).toBe(200);
    expect((await mrr.text()).split('\n')[0]).toContain('month,currency,mrr,arr,subscribers');

    const bad = await fetchWorker(`/api/websites/${WEBSITE_ID}/revenue/export?table=users`, { headers });
    expect(bad.status).toBe(400);
  });

  it('serves attribution and subscription metrics as JSON', async () => {
    const headers = await authHeader();
    const attribution = await fetchWorkerJson<{ dimension: string; rows: Array<{ value: string; total: number }> }>(
      `/api/websites/${WEBSITE_ID}/revenue/attribution?dimension=utm_source&startAt=${T0 - DAY}&endAt=${T0 + DAY}`,
      { headers },
    );
    expect(attribution.body.rows[0]).toMatchObject({ value: 'newsletter', total: 2409 });
    const invalid = await fetchWorker(`/api/websites/${WEBSITE_ID}/revenue/attribution?dimension=country`, { headers });
    expect(invalid.status).toBe(400);
    const subscriptions = await fetchWorkerJson<{ currencies: string[]; series: unknown[] }>(
      `/api/websites/${WEBSITE_ID}/revenue/subscriptions`,
      { headers },
    );
    expect(subscriptions.response.status).toBe(200);
    expect(subscriptions.body).toEqual({ currencies: [], latest: [], series: [] });
  });

  it('exports warehouse query results beyond the interactive row cap', async () => {
    const response = await fetchWorker(`/api/websites/${WEBSITE_ID}/warehouse/query/export`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        sql: 'SELECT revenue_id AS id, revenue FROM revenue WHERE website_id = ?1 ORDER BY revenue_id',
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-row-cap')).toBe('10000');
    expect(response.headers.get('x-truncated')).toBe('false');
    const rows = parseCsv(await response.text());
    expect(rows[0]).toEqual(['id', 'revenue']);
    // Without LIMIT an interactive query returns 100 rows; the export returns them all.
    expect(rows).toHaveLength(1206);
    expect(rows[1]).toEqual(['rev-0000', '1']);

    const failed = await fetchWorkerJson<{ message: string }>(`/api/websites/${WEBSITE_ID}/warehouse/query/export`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ sql: 'SELECT * FROM user WHERE website_id = ?1' }),
    });
    expect(failed.response.status).toBe(400);
    expect(failed.body.message).toMatch(/Table not allowed/);
  });

  it('lists imported sources with their fields and the query limits in the schema', async () => {
    const headers = await authHeader();
    const created = await fetchWorkerJson<{ id: string }>(`/api/websites/${WEBSITE_ID}/warehouse/data-sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'CRM', type: 'http_json', config: { url: 'https://example.com/crm.json' } }),
    });
    await testSiteDb(WEBSITE_ID)
      .prepare(
        `INSERT INTO warehouse_import (import_row_id, website_id, data_source_id, primary_key, payload_json, imported_at)
         VALUES (?1, ?2, ?3, 'a-1', '{"plan":"pro","seats":3}', ?4)`,
      )
      .bind(`${created.body.id}:a-1`, WEBSITE_ID, created.body.id, T0)
      .run();

    const schema = await fetchWorkerJson<{
      tables: Array<{ name: string }>;
      limits: { maxUserLimit: number; exportRowCap: number; timeoutMs: number; maxRowsRead: number };
      importedSources: Array<{ id: string; tables: Array<{ name: string; rowCount: number; columns: string[] }>; exampleSql: string }>;
    }>(`/api/websites/${WEBSITE_ID}/warehouse/schema`, { headers });
    expect(schema.body.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['revenue', 'stripe_charge', 'stripe_invoice_line', 'stripe_subscription']),
    );
    expect(schema.body.limits).toMatchObject({ maxUserLimit: 1000, exportRowCap: 10000, timeoutMs: 10000, maxRowsRead: 100000 });
    const imported = schema.body.importedSources.find((source) => source.id === created.body.id)!;
    expect(imported.tables).toEqual([{ name: 'warehouse_import', rowCount: 1, columns: ['plan', 'seats'] }]);

    // The example query for the source runs as-is.
    const run = await fetchWorkerJson<{ rows: Array<Record<string, unknown>> }>(`/api/websites/${WEBSITE_ID}/warehouse/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sql: imported.exampleSql }),
    });
    expect(run.body.rows).toEqual([{ primary_key: 'a-1', plan: 'pro', seats: 3, imported_at: T0 }]);
  });

  it('creates Stripe sources without echoing the key and rejects removed connector types', async () => {
    const headers = await authHeader();
    const stripe = await fetchWorkerJson<{ type: string; config: Record<string, unknown> }>(
      `/api/websites/${WEBSITE_ID}/warehouse/data-sources`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Stripe', type: 'stripe', config: { apiKey: 'rk_test_51RouteKey77777777' } }),
      },
    );
    expect(stripe.response.status).toBe(201);
    expect(stripe.body.config).toEqual({ apiKeyHint: 'rk_test_…7777' });
    expect(JSON.stringify(stripe.body)).not.toContain('RouteKey');

    const missingKey = await fetchWorker(`/api/websites/${WEBSITE_ID}/warehouse/data-sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Stripe', type: 'stripe', config: {} }),
    });
    expect(missingKey.status).toBe(400);

    for (const type of ['postgres', 'mysql', 'd1', 'r2_json']) {
      const removed = await fetchWorker(`/api/websites/${WEBSITE_ID}/warehouse/data-sources`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Old', type, config: {} }),
      });
      expect(removed.status).toBe(400);
    }
  });
});
