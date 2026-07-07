import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 18, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function insertSession(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(id, TEST_WEBSITE_ID, BASE)
    .run();
}

async function insertLog(id: string, message: string, createdAt: number, level = 'info') {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, 'logs-tail-session', 'logs-tail-session', ?3, '/checkout', ?4, 'log')`,
  )
    .bind(id, TEST_WEBSITE_ID, createdAt, EVENT_TYPE.log)
    .run();

  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES
       (?1, ?2, ?3, 'level', ?4, 1, ?8),
       (?5, ?2, ?3, 'message', ?6, 1, ?8),
       (?7, ?2, ?3, 'environment', 'production', 1, ?8)`,
  )
    .bind(
      `${id}-level`,
      TEST_WEBSITE_ID,
      id,
      level,
      `${id}-message`,
      message,
      `${id}-environment`,
      createdAt,
    )
    .run();
}

describe('log tail routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertSession('logs-tail-session');
  });

  it('returns new log events after the cursor in chronological order', async () => {
    await insertLog('logs-tail-old', 'Old log', BASE + 1000);
    await insertLog('logs-tail-new-1', 'First new log', BASE + 3000, 'warn');
    await insertLog('logs-tail-new-2', 'Second new log', BASE + 4000, 'error');

    const result = await fetchWorkerJson<{
      cursor: number;
      logs: Array<{ id: string; message: string; level: string; createdAt: number }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/logs/tail?sinceAt=${BASE + 2000}`, {
      headers: await authHeader(),
    });

    expect(result.response.status).toBe(200);
    expect(result.body.cursor).toBe(BASE + 4000);
    expect(result.body.logs.map((row) => ({ id: row.id, message: row.message, level: row.level }))).toEqual([
      { id: 'logs-tail-new-1', message: 'First new log', level: 'warn' },
      { id: 'logs-tail-new-2', message: 'Second new log', level: 'error' },
    ]);
  });
});
