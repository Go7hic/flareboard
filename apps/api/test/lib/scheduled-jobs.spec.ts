import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { runScheduledAlertChecks, runScheduledWarehouseQueries } from '../../src/lib/scheduled-jobs';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 24, 12);

describe('scheduled maintenance jobs', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('runs due warehouse schedules across websites', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
       VALUES ('scheduled-warehouse-session', ?1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES ('scheduled-warehouse-event', ?1, 'scheduled-warehouse-session', 'scheduled-warehouse-session', ?2, '/pricing', ?3, 'view_pricing')`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, EVENT_TYPE.customEvent)
      .run();
    await env.DB.prepare(
      `INSERT INTO warehouse_scheduled_query
         (scheduled_query_id, website_id, user_id, name, description, sql, enabled, interval_minutes, next_run_at, created_at, updated_at)
       VALUES ('scheduled-warehouse-query', ?1, '00000000-0000-0000-0000-000000000001', 'Hourly pricing', '', ?2, 1, 60, ?3, ?4, ?4)`,
    )
      .bind(
        TEST_WEBSITE_ID,
        `SELECT event_name FROM website_event WHERE website_id = ?1 LIMIT 5`,
        BASE - 1000,
        BASE,
      )
      .run();

    const result = await runScheduledWarehouseQueries(env, BASE);
    expect(result.executed).toBe(1);

    const row = await env.DB.prepare(
      `SELECT last_status as lastStatus, last_row_count as lastRowCount
       FROM warehouse_scheduled_query
       WHERE scheduled_query_id = 'scheduled-warehouse-query'`,
    ).first<{ lastStatus: string; lastRowCount: number }>();

    expect(row).toEqual({
      lastStatus: 'success',
      lastRowCount: expect.any(Number),
    });
    expect(row!.lastRowCount).toBeGreaterThan(0);
  });

  it('evaluates alert rules during scheduled alert checks', async () => {
    const later = BASE + 60_000;
    await env.DB.prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES ('scheduled-alert-event-1', ?1, 'scheduled-warehouse-session', 'scheduled-warehouse-session', ?2, '/app', ?3, 'TypeError')`,
    )
      .bind(TEST_WEBSITE_ID, later, EVENT_TYPE.error)
      .run();
    await env.DB.prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
       VALUES ('scheduled-alert-data-1', ?1, 'scheduled-alert-event-1', 'severity', 'error', 1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, later)
      .run();
    await env.DB.prepare(
      `INSERT INTO error_alert_rule
         (alert_rule_id, website_id, name, enabled, threshold, window_minutes, severity, channel, created_at, updated_at)
       VALUES ('scheduled-alert-rule', ?1, 'Error spike', 1, 1, 10, 'error', 'record', ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, later)
      .run();

    const result = await runScheduledAlertChecks(env, later + 1000);
    expect(result.errorAlerts).toBeGreaterThanOrEqual(1);
  });
});
