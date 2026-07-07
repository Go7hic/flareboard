import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import {
  createLogAlertRule,
  evaluateLogAlertRules,
  getLogEvents,
  getLogStats,
  getServiceSummaries,
  getTraceDetail,
  getTraceSummaries,
} from '../../src/lib/logs';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 3, 12);
const DAY = 24 * 60 * 60 * 1000;

async function insertSession(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(id, TEST_WEBSITE_ID, BASE)
    .run();
}

async function insertLog(
  id: string,
  sessionId: string,
  level: string,
  message: string,
  createdAt: number,
  release = '1.0.0',
  environment = 'production',
  extra: Record<string, string | number> = {},
) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/checkout', ?5, 'log')`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.log)
    .run();

  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES
       (?1, ?2, ?3, 'level', ?4, 1, ?6),
       (?5, ?2, ?3, 'message', ?7, 1, ?6),
       (?8, ?2, ?3, 'release', ?9, 1, ?6),
       (?10, ?2, ?3, 'environment', ?11, 1, ?6)`,
  )
    .bind(
      `${id}-level`,
      TEST_WEBSITE_ID,
      id,
      level,
      `${id}-message`,
      createdAt,
      message,
      `${id}-release`,
      release,
      `${id}-environment`,
      environment,
    )
    .run();

  for (const [key, value] of Object.entries(extra)) {
    await env.DB.prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        `${id}-${key}`,
        TEST_WEBSITE_ID,
        id,
        key,
        typeof value === 'string' ? value : null,
        typeof value === 'number' ? value : null,
        typeof value === 'number' ? 2 : 1,
        createdAt,
      )
      .run();
  }
}

describe('logs query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('returns recent logs and counts them by level', async () => {
    await insertSession('log-session-a');
    await insertSession('log-session-b');
    await insertLog('log-1', 'log-session-a', 'info', 'Checkout started', BASE + 1000);
    await insertLog('log-2', 'log-session-a', 'warn', 'Coupon rejected', BASE + 2000);
    await insertLog('log-3', 'log-session-b', 'error', 'Payment provider timeout', BASE + 3000);

    const [stats, rows] = await Promise.all([
      getLogStats(env, TEST_WEBSITE_ID, BASE, BASE + 4000),
      getLogEvents(env, TEST_WEBSITE_ID, BASE, BASE + 4000),
    ]);

    expect(stats).toEqual({
      logs: 3,
      sessions: 2,
      levels: [
        { level: 'error', logs: 1 },
        { level: 'info', logs: 1 },
        { level: 'warn', logs: 1 },
      ],
      trend: [{ date: '2026-01-03', logs: 3, sessions: 2 }],
      releases: [{ release: '1.0.0', logs: 3 }],
      environments: [{ environment: 'production', logs: 3 }],
      lastSeenAt: BASE + 3000,
    });
    expect(rows.map((row) => ({ message: row.message, level: row.level }))).toEqual([
      { message: 'Payment provider timeout', level: 'error' },
      { message: 'Coupon rejected', level: 'warn' },
      { message: 'Checkout started', level: 'info' },
    ]);
  });

  it('filters logs and stats by level and message search', async () => {
    await insertSession('log-search-session-a');
    await insertSession('log-search-session-b');
    await insertLog(
      'log-search-1',
      'log-search-session-a',
      'error',
      'Payment provider timeout',
      BASE + 5000,
    );
    await insertLog(
      'log-search-2',
      'log-search-session-b',
      'error',
      'Payment card declined',
      BASE + 6000,
    );
    await insertLog(
      'log-search-3',
      'log-search-session-b',
      'warn',
      'Payment retry scheduled',
      BASE + 7000,
    );

    const [stats, rows] = await Promise.all([
      getLogStats(env, TEST_WEBSITE_ID, BASE + 4500, BASE + 8000, {
        level: 'error',
        search: 'provider',
      }),
      getLogEvents(env, TEST_WEBSITE_ID, BASE + 4500, BASE + 8000, {
        level: 'error',
        search: 'provider',
      }),
    ]);

    expect(stats).toEqual({
      logs: 1,
      sessions: 1,
      levels: [{ level: 'error', logs: 1 }],
      trend: [{ date: '2026-01-03', logs: 1, sessions: 1 }],
      releases: [{ release: '1.0.0', logs: 1 }],
      environments: [{ environment: 'production', logs: 1 }],
      lastSeenAt: BASE + 5000,
    });
    expect(rows.map((row) => ({ message: row.message, level: row.level }))).toEqual([
      { message: 'Payment provider timeout', level: 'error' },
    ]);
  });

  it('returns daily log trend for multi-day ranges', async () => {
    const later = BASE + DAY * 2;

    await insertSession('log-trend-session-a');
    await insertSession('log-trend-session-b');
    await insertLog('log-trend-1', 'log-trend-session-a', 'info', 'First day log', later + 1000);
    await insertLog('log-trend-2', 'log-trend-session-b', 'error', 'Second day log', later + DAY + 1000);

    const stats = await getLogStats(env, TEST_WEBSITE_ID, later, later + DAY + 2000);

    expect(stats.trend).toEqual([
      { date: '2026-01-05', logs: 1, sessions: 1 },
      { date: '2026-01-06', logs: 1, sessions: 1 },
    ]);
  });

  it('filters logs by release and environment', async () => {
    const later = BASE + DAY * 4;

    await insertSession('log-filter-session-a');
    await insertSession('log-filter-session-b');
    await insertSession('log-filter-session-c');
    await insertLog(
      'log-filter-1',
      'log-filter-session-a',
      'error',
      'Production release issue',
      later + 1000,
      '2.0.0',
      'production',
    );
    await insertLog(
      'log-filter-2',
      'log-filter-session-b',
      'error',
      'Preview release issue',
      later + 2000,
      '2.0.0',
      'preview',
    );
    await insertLog(
      'log-filter-3',
      'log-filter-session-c',
      'warn',
      'Old production issue',
      later + 3000,
      '1.9.0',
      'production',
    );

    const filters = { release: '2.0.0', environment: 'production' };
    const [stats, rows] = await Promise.all([
      getLogStats(env, TEST_WEBSITE_ID, later, later + 4000, filters),
      getLogEvents(env, TEST_WEBSITE_ID, later, later + 4000, filters),
    ]);

    expect(stats).toMatchObject({
      logs: 1,
      sessions: 1,
      releases: [{ release: '2.0.0', logs: 1 }],
      environments: [{ environment: 'production', logs: 1 }],
      lastSeenAt: later + 1000,
    });
    expect(rows.map((row) => row.id)).toEqual(['log-filter-1']);
  });

  it('groups log spans into traces and returns span detail in chronological order', async () => {
    const later = BASE + DAY * 6;

    await insertSession('log-trace-session-a');
    await insertLog(
      'log-trace-root',
      'log-trace-session-a',
      'info',
      'GET /checkout',
      later + 1000,
      '3.0.0',
      'production',
      {
        traceId: 'trace-checkout-1',
        spanId: 'span-root',
        service: 'web',
        operation: 'GET /checkout',
        durationMs: 120,
        status: 'ok',
      },
    );
    await insertLog(
      'log-trace-child',
      'log-trace-session-a',
      'error',
      'POST /payments failed',
      later + 2000,
      '3.0.0',
      'production',
      {
        traceId: 'trace-checkout-1',
        spanId: 'span-payment',
        parentSpanId: 'span-root',
        service: 'payments',
        operation: 'POST /payments',
        durationMs: 380,
        status: 'error',
      },
    );

    const summaries = await getTraceSummaries(env, TEST_WEBSITE_ID, later, later + 3000);
    expect(summaries).toEqual([
      expect.objectContaining({
        traceId: 'trace-checkout-1',
        spans: 2,
        services: 2,
        durationMs: 1000,
        maxSpanDurationMs: 380,
        hasError: true,
      }),
    ]);

    const detail = await getTraceDetail(env, TEST_WEBSITE_ID, 'trace-checkout-1');
    expect(detail).toMatchObject({
      traceId: 'trace-checkout-1',
      spans: [
        {
          id: 'log-trace-root',
          spanId: 'span-root',
          parentSpanId: null,
          service: 'web',
          operation: 'GET /checkout',
          durationMs: 120,
          status: 'ok',
        },
        {
          id: 'log-trace-child',
          spanId: 'span-payment',
          parentSpanId: 'span-root',
          service: 'payments',
          operation: 'POST /payments',
          durationMs: 380,
          status: 'error',
        },
      ],
    });
  });

  it('summarizes logs and traces by service', async () => {
    const later = BASE + DAY * 8;

    await insertSession('log-service-session-a');
    await insertSession('log-service-session-b');
    await insertLog(
      'log-service-web-1',
      'log-service-session-a',
      'info',
      'Web request',
      later + 1000,
      '4.0.0',
      'production',
      {
        traceId: 'trace-service-1',
        spanId: 'span-web-1',
        service: 'web',
        durationMs: 100,
        status: 'ok',
      },
    );
    await insertLog(
      'log-service-payments-1',
      'log-service-session-a',
      'error',
      'Payment failed',
      later + 2000,
      '4.0.0',
      'production',
      {
        traceId: 'trace-service-1',
        spanId: 'span-payments-1',
        service: 'payments',
        durationMs: 400,
        status: 'error',
      },
    );
    await insertLog(
      'log-service-payments-2',
      'log-service-session-b',
      'warn',
      'Payment retry',
      later + 3000,
      '4.0.0',
      'production',
      {
        traceId: 'trace-service-2',
        spanId: 'span-payments-2',
        service: 'payments',
        durationMs: 200,
        status: 'ok',
      },
    );

    const services = await getServiceSummaries(env, TEST_WEBSITE_ID, later, later + 4000);

    expect(services).toEqual([
      {
        service: 'payments',
        logs: 2,
        errors: 1,
        traces: 2,
        avgDurationMs: 300,
        maxDurationMs: 400,
        lastSeenAt: later + 3000,
      },
      {
        service: 'web',
        logs: 1,
        errors: 0,
        traces: 1,
        avgDurationMs: 100,
        maxDurationMs: 100,
        lastSeenAt: later + 1000,
      },
    ]);
  });

  it('records triggered log alert rules when matching logs cross the threshold', async () => {
    const later = BASE + DAY * 10;

    await insertSession('log-alert-session-a');
    await insertSession('log-alert-session-b');
    await insertLog(
      'log-alert-1',
      'log-alert-session-a',
      'error',
      'Payment timeout',
      later + 1000,
      '5.0.0',
      'production',
      { service: 'payments' },
    );
    await insertLog(
      'log-alert-2',
      'log-alert-session-b',
      'error',
      'Payment timeout retry',
      later + 2000,
      '5.0.0',
      'production',
      { service: 'payments' },
    );

    const rule = await createLogAlertRule(env, TEST_WEBSITE_ID, {
      name: 'Payment log spike',
      enabled: true,
      threshold: 2,
      windowMinutes: 10,
      level: 'error',
      service: 'payments',
      search: 'timeout',
      channel: 'record',
    });

    const triggered = await evaluateLogAlertRules(env, TEST_WEBSITE_ID, later + 2000);

    expect(triggered).toEqual([
      expect.objectContaining({
        alertRuleId: rule.id,
        count: 2,
        threshold: 2,
      }),
    ]);

    const stored = await env.DB.prepare(
      `SELECT alert_rule_id as alertRuleId, count, threshold
       FROM log_alert_event
       WHERE website_id = ?1 AND alert_rule_id = ?2`,
    )
      .bind(TEST_WEBSITE_ID, rule.id)
      .all<{ alertRuleId: string; count: number; threshold: number }>();

    expect(stored.results).toEqual([
      {
        alertRuleId: rule.id,
        count: 2,
        threshold: 2,
      },
    ]);
  });
});
