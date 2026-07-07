import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 20, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function insertSession() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES ('log-service-route-session', ?1, ?2)`,
  )
    .bind(TEST_WEBSITE_ID, BASE)
    .run();
}

async function insertServiceLog(id: string, service: string, level: string, createdAt: number, durationMs: number, traceId: string) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, 'log-service-route-session', 'log-service-route-session', ?3, '/checkout', ?4, 'log')`,
  )
    .bind(id, TEST_WEBSITE_ID, createdAt, EVENT_TYPE.log)
    .run();

  const props: Array<[string, string | number, number]> = [
    ['message', `${service} log`, 1],
    ['level', level, 1],
    ['traceId', traceId, 1],
    ['spanId', `${id}-span`, 1],
    ['service', service, 1],
    ['durationMs', durationMs, 2],
    ['status', level === 'error' ? 'error' : 'ok', 1],
  ];

  for (const [key, value, dataType] of props) {
    await env.DB.prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        `${id}-${key}`,
        TEST_WEBSITE_ID,
        id,
        key,
        dataType === 1 ? value : null,
        dataType === 2 ? value : null,
        dataType,
        createdAt,
      )
      .run();
  }
}

describe('log service routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertSession();
  });

  it('returns service-level observability summaries', async () => {
    await insertServiceLog('log-service-route-web', 'web', 'info', BASE + 1000, 100, 'trace-service-route-1');
    await insertServiceLog('log-service-route-pay-1', 'payments', 'error', BASE + 2000, 500, 'trace-service-route-1');
    await insertServiceLog('log-service-route-pay-2', 'payments', 'warn', BASE + 3000, 300, 'trace-service-route-2');

    const result = await fetchWorkerJson<{
      services: Array<{
        service: string;
        logs: number;
        errors: number;
        traces: number;
        avgDurationMs: number;
        maxDurationMs: number;
      }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/services?startAt=${BASE}&endAt=${BASE + 4000}`, {
      headers: await authHeader(),
    });

    expect(result.response.status).toBe(200);
    expect(result.body.services).toEqual([
      expect.objectContaining({
        service: 'payments',
        logs: 2,
        errors: 1,
        traces: 2,
        avgDurationMs: 400,
        maxDurationMs: 500,
      }),
      expect.objectContaining({
        service: 'web',
        logs: 1,
        errors: 0,
        traces: 1,
        avgDurationMs: 100,
        maxDurationMs: 100,
      }),
    ]);
  });
});
