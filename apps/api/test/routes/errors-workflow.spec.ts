import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 12, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function insertError() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES ('error-route-session', ?1, ?2)`,
  )
    .bind(TEST_WEBSITE_ID, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO website_event
       (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES ('error-route-1', ?1, 'error-route-session', 'error-route-session', ?2, '/checkout', ?3, ?4)`,
  )
    .bind(TEST_WEBSITE_ID, BASE + 1000, EVENT_TYPE.error, 'Assigned route issue')
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO event_data
       (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES
       ('error-route-name', ?1, 'error-route-1', 'name', 'TypeError', 1, ?2),
       ('error-route-message', ?1, 'error-route-1', 'message', 'Assigned route issue', 1, ?2)`,
  )
    .bind(TEST_WEBSITE_ID, BASE + 1000)
    .run();
}

describe('error issue workflow routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('updates assignment and appends issue comments', async () => {
    await insertError();
    const fingerprint = 'TypeError|Assigned route issue';

    const state = await fetchWorkerJson<{ assigneeUserId: string; note: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/errors/issues`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({
          fingerprint,
          status: 'open',
          note: 'Needs frontend owner',
          assigneeUserId: TEST_USER_ID,
        }),
      },
    );

    expect(state.response.status).toBe(200);
    expect(state.body).toMatchObject({
      note: 'Needs frontend owner',
      assigneeUserId: TEST_USER_ID,
    });

    const comment = await fetchWorkerJson<{ body: string; userId: string }>(
      `/api/websites/${TEST_WEBSITE_ID}/errors/issues/comments`,
      {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({
          fingerprint,
          body: 'Checking the minified stack trace.',
        }),
      },
    );

    expect(comment.response.status).toBe(201);
    expect(comment.body).toMatchObject({
      userId: TEST_USER_ID,
      body: 'Checking the minified stack trace.',
    });

    const list = await fetchWorkerJson<{
      issues: Array<{ fingerprint: string; assigneeUserId: string | null; comments: Array<{ body: string }> }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/errors?startAt=${BASE}&endAt=${BASE + 2000}`, {
      headers: await authHeader(),
    });

    expect(list.body.issues[0]).toMatchObject({
      fingerprint,
      assigneeUserId: TEST_USER_ID,
      comments: [{ body: 'Checking the minified stack trace.' }],
    });
  });
});
