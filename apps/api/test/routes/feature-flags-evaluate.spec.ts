import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('POST /api/websites/:websiteId/feature-flags/evaluate', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('evaluates a flag for server-side callers and records call history', async () => {
    const now = Date.now();
    const flagId = '00000000-0000-0000-0000-00000000f101';
    await env.DB.prepare(
      `INSERT OR REPLACE INTO feature_flag
        (flag_id, website_id, key, name, description, enabled, rollout, variants, targeting_rules, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, 100, ?6, ?7, ?8, ?8)`,
    )
      .bind(
        flagId,
        TEST_WEBSITE_ID,
        'checkout.server',
        'Server checkout',
        '',
        JSON.stringify([{ key: 'variant_a', name: 'Variant A', weight: 100 }]),
        JSON.stringify([{ field: 'environment', operator: 'equals', value: 'production' }]),
        now,
      )
      .run();

    const { response, body } = await fetchWorkerJson<{
      key: string;
      variant: string;
      enabled: boolean;
      reason: string;
    }>(`/api/websites/${TEST_WEBSITE_ID}/feature-flags/evaluate`, {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({
        key: 'checkout.server',
        distinctId: 'server-user-1',
        sessionId: 'server-session-1',
        environment: 'production',
        release: '2.2.0',
        path: '/checkout',
      }),
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      key: 'checkout.server',
      variant: 'variant_a',
      enabled: true,
      reason: 'match',
    });

    const history = await fetchWorkerJson<{
      summary: {
        exposures: number;
        recent: Array<{ sessionId: string; variant: string | null; release: string | null; environment: string | null }>;
      };
    }>(`/api/websites/${TEST_WEBSITE_ID}/feature-flags/${flagId}`, {
      headers: await authHeader(),
    });

    expect(history.body.summary.exposures).toBeGreaterThanOrEqual(1);
    expect(history.body.summary.recent[0]).toMatchObject({
      sessionId: 'server-session-1',
      variant: 'variant_a',
      release: '2.2.0',
      environment: 'production',
    });
  });
});
