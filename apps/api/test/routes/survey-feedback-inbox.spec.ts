import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 21, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('survey feedback inbox route', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('returns text feedback with sentiment and theme filters', async () => {
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, created_at, updated_at)
       VALUES ('route-feedback-survey', ?1, 'Route feedback', 'What happened?', 'text', 1, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES
       ('route-feedback-1', 'route-feedback-survey', ?1, 'route-feedback-session-a', 'route-feedback-visit-a', 'Route inbox price is expensive', '/pricing', ?2),
       ('route-feedback-2', 'route-feedback-survey', ?1, 'route-feedback-session-b', 'route-feedback-visit-b', 'Route inbox works great', '/checkout', ?3)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, BASE + 2000)
      .run();

    const result = await fetchWorkerJson<{
      summary: { total: number };
      items: Array<{ id: string; sentiment: string; theme: string; answer: string }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/surveys/feedback?sentiment=negative&q=Route%20inbox`, {
      headers: await authHeader(),
    });

    expect(result.response.status).toBe(200);
    expect(result.body.summary.total).toBe(1);
    expect(result.body.items).toEqual([
      expect.objectContaining({
        id: 'route-feedback-1',
        sentiment: 'negative',
        theme: 'price',
        answer: 'Route inbox price is expensive',
      }),
    ]);
  });
});
