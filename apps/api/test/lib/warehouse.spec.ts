import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { analyzeWarehouseQuery, getWarehouseSchema, runWarehouseQuery } from '../../src/lib/warehouse';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 6, 12);

describe('runWarehouseQuery', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('runs scoped read-only queries against analytics tables', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES ('warehouse-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES ('warehouse-event', ?1, 'warehouse-session', 'warehouse-session', ?2, '/pricing', ?3, 'signup')`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, EVENT_TYPE.customEvent)
      .run();

    const result = await runWarehouseQuery(
      env,
      TEST_WEBSITE_ID,
      `SELECT event_name as eventName, url_path as urlPath
       FROM website_event
       WHERE website_id = ?1
       ORDER BY created_at DESC`,
    );

    expect(result.columns).toEqual(['eventName', 'urlPath']);
    expect(result.rows[0]).toEqual({ eventName: 'signup', urlPath: '/pricing' });
    expect(result.analysis).toMatchObject({
      valid: true,
      hasLimit: false,
      autoLimit: 100,
    });
    expect(result.analysis.diagnostics).toEqual([
      {
        code: 'missing_limit',
        level: 'warning',
        message: 'No LIMIT detected; results will be capped at 100 rows',
      },
      { code: 'ready', level: 'success', message: 'Query is ready to run' },
    ]);
  });

  it('rejects mutation queries and unscoped reads', async () => {
    await expect(runWarehouseQuery(env, TEST_WEBSITE_ID, 'DELETE FROM website_event')).rejects.toThrow(
      /read-only/i,
    );
    await expect(
      runWarehouseQuery(env, TEST_WEBSITE_ID, 'SELECT * FROM website_event LIMIT 10'),
    ).rejects.toThrow(/website_id/i);
  });

  it('rejects reads from tables outside the warehouse allowlist', async () => {
    await expect(
      runWarehouseQuery(env, TEST_WEBSITE_ID, 'SELECT username, password FROM user WHERE website_id = ?1'),
    ).rejects.toThrow(/table not allowed/i);
    await expect(
      runWarehouseQuery(
        env,
        TEST_WEBSITE_ID,
        'SELECT u.password FROM website_event e JOIN user u ON 1 = 1 WHERE e.website_id = ?1',
      ),
    ).rejects.toThrow(/table not allowed/i);
    await expect(
      runWarehouseQuery(
        env,
        TEST_WEBSITE_ID,
        'SELECT t.access_code FROM website_event e, team t WHERE e.website_id = ?1',
      ),
    ).rejects.toThrow(/table not allowed/i);
    await expect(
      runWarehouseQuery(
        env,
        TEST_WEBSITE_ID,
        `SELECT (SELECT password FROM user LIMIT 1) FROM website_event WHERE website_id = ?1`,
      ),
    ).rejects.toThrow(/table not allowed/i);
  });

  it('allows CTE names while still blocking non-allowlisted tables inside them', () => {
    expect(
      analyzeWarehouseQuery(
        `WITH recent AS (SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 50)
         SELECT * FROM recent LIMIT 50`,
      ).valid,
    ).toBe(true);
    expect(
      analyzeWarehouseQuery(
        `WITH leak AS (SELECT password FROM user)
         SELECT * FROM leak, website_event WHERE website_id = ?1 LIMIT 10`,
      ).valid,
    ).toBe(false);
  });

  it('caps user-supplied LIMIT values', () => {
    const small = analyzeWarehouseQuery(
      'SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 10',
    );
    expect(small.executableSql).toBe('SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 10');

    const huge = analyzeWarehouseQuery(
      'SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 1000000',
    );
    expect(huge.valid).toBe(true);
    expect(huge.executableSql).toBe(
      'SELECT * FROM (SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 1000000) LIMIT 1000',
    );
  });

  it('exposes queryable tables and scoped example queries', () => {
    const schema = getWarehouseSchema();

    expect(schema.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['website_event', 'event_data', 'session']),
    );
    expect(schema.examples.length).toBeGreaterThan(0);
    for (const example of schema.examples) {
      expect(example.sql).toMatch(/^SELECT/i);
      expect(example.sql).toContain('website_id = ?1');
      expect(example.category).toBeTruthy();
    }
  });

  it('analyzes query safety without executing SQL', () => {
    expect(
      analyzeWarehouseQuery(`SELECT event_name FROM website_event WHERE website_id = ?1`),
    ).toMatchObject({
      valid: true,
      hasLimit: false,
      autoLimit: 100,
      executableSql:
        'SELECT * FROM (SELECT event_name FROM website_event WHERE website_id = ?1) LIMIT 100',
    });

    expect(analyzeWarehouseQuery('SELECT * FROM website_event LIMIT 10')).toMatchObject({
      valid: false,
      hasLimit: true,
      autoLimit: null,
      executableSql: null,
      diagnostics: [
        {
          code: 'missing_website_scope',
          level: 'error',
          message: 'Warehouse queries must scope reads with website_id = ?1',
        },
      ],
    });
  });
});
