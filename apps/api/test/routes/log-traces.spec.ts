import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 19, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function insertSession() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES ('log-trace-route-session', ?1, ?2)`,
  )
    .bind(TEST_WEBSITE_ID, BASE)
    .run();
}

async function insertSpan(id: string, spanId: string, parentSpanId: string | null, service: string, createdAt: number) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, 'log-trace-route-session', 'log-trace-route-session', ?3, '/checkout', ?4, 'log')`,
  )
    .bind(id, TEST_WEBSITE_ID, createdAt, EVENT_TYPE.log)
    .run();

  const props: Array<[string, string | number | null, number]> = [
    ['message', `${service} span`, 1],
    ['level', service === 'payments' ? 'error' : 'info', 1],
    ['traceId', 'trace-route-1', 1],
    ['spanId', spanId, 1],
    ['parentSpanId', parentSpanId, 1],
    ['service', service, 1],
    ['operation', `${service}.work`, 1],
    ['durationMs', service === 'payments' ? 240 : 80, 2],
    ['status', service === 'payments' ? 'error' : 'ok', 1],
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

describe('log trace routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertSession();
  });

  it('returns trace summaries and span detail', async () => {
    await insertSpan('log-trace-route-root', 'route-root', null, 'web', BASE + 1000);
    await insertSpan('log-trace-route-child', 'route-payments', 'route-root', 'payments', BASE + 2000);

    const summaries = await fetchWorkerJson<{
      traces: Array<{ traceId: string; spans: number; services: number; hasError: boolean }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/traces?startAt=${BASE}&endAt=${BASE + 3000}`, {
      headers: await authHeader(),
    });

    expect(summaries.response.status).toBe(200);
    expect(summaries.body.traces).toEqual([
      expect.objectContaining({
        traceId: 'trace-route-1',
        spans: 2,
        services: 2,
        hasError: true,
      }),
    ]);

    const detail = await fetchWorkerJson<{
      traceId: string;
      spans: Array<{ id: string; spanId: string; parentSpanId: string | null; service: string }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/traces/trace-route-1`, {
      headers: await authHeader(),
    });

    expect(detail.response.status).toBe(200);
    expect(detail.body).toMatchObject({
      traceId: 'trace-route-1',
      spans: [
        { id: 'log-trace-route-root', spanId: 'route-root', parentSpanId: null, service: 'web' },
        {
          id: 'log-trace-route-child',
          spanId: 'route-payments',
          parentSpanId: 'route-root',
          service: 'payments',
        },
      ],
    });
  });
});
