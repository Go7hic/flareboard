import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 10, 12);

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

async function insertEvent(
  id: string,
  sessionId: string,
  eventName: string,
  createdAt: number,
  data: Record<string, string>,
) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/', ?5, ?6)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.customEvent, eventName)
    .run();

  let index = 0;
  for (const [key, value] of Object.entries(data)) {
    await env.DB.prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
    )
      .bind(`${id}-data-${index++}`, TEST_WEBSITE_ID, id, key, value, createdAt)
      .run();
  }
}

describe('POST /api/websites/:websiteId/experiments/:experimentId/apply', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('ships a significant winning variant back to its feature flag', async () => {
    const flagId = '00000000-0000-0000-0000-00000000e101';
    const experimentId = '00000000-0000-0000-0000-00000000e102';
    const flagKey = 'checkout.apply_winner';
    const now = BASE;

    await env.DB.prepare(
      `INSERT OR REPLACE INTO feature_flag
        (flag_id, website_id, key, name, description, enabled, rollout, variants, targeting_rules, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, '', 1, 100, ?5, ?6, ?7, ?7)`,
    )
      .bind(
        flagId,
        TEST_WEBSITE_ID,
        flagKey,
        'Checkout apply winner',
        JSON.stringify([
          { key: 'variant_a', name: 'Variant A', weight: 50 },
          { key: 'variant_b', name: 'Variant B', weight: 50 },
        ]),
        JSON.stringify([]),
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO experiment
        (experiment_id, website_id, feature_flag_id, name, description, status, goal_event, started_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, '', 'running', 'checkout_completed', ?5, ?5, ?5)`,
    )
      .bind(experimentId, TEST_WEBSITE_ID, flagId, 'Checkout experiment', now)
      .run();

    for (let i = 0; i < 40; i++) {
      const controlSession = `apply-control-${i}`;
      await insertSession(controlSession);
      await insertEvent(`apply-exposure-control-${i}`, controlSession, '$feature_flag_called', BASE + i, {
        '$feature_flag': flagKey,
        '$feature_flag_response': 'control',
        [`$feature/${flagKey}`]: 'control',
      });
      if (i < 20) {
        await insertEvent(`apply-conversion-control-${i}`, controlSession, 'checkout_completed', BASE + 1000 + i, {
          [`$feature/${flagKey}`]: 'control',
        });
      }

      const variantSession = `apply-variant-${i}`;
      await insertSession(variantSession);
      await insertEvent(`apply-exposure-variant-${i}`, variantSession, '$feature_flag_called', BASE + 2000 + i, {
        '$feature_flag': flagKey,
        '$feature_flag_response': 'variant_a',
        [`$feature/${flagKey}`]: 'variant_a',
      });
      if (i < 32) {
        await insertEvent(`apply-conversion-variant-${i}`, variantSession, 'checkout_completed', BASE + 3000 + i, {
          [`$feature/${flagKey}`]: 'variant_a',
        });
      }
    }

    const { response, body } = await fetchWorkerJson<{
      appliedVariant: string;
      experiment: { status: string; endedAt: number | null };
      featureFlag: { rollout: number; variants: Array<{ key: string; weight: number }> };
    }>(
      `/api/websites/${TEST_WEBSITE_ID}/experiments/${experimentId}/apply?startAt=${BASE - 1000}&endAt=${BASE + 10000}`,
      {
        method: 'POST',
        headers: await authHeader(),
      },
    );

    expect(response.status).toBe(200);
    expect(body.appliedVariant).toBe('variant_a');
    expect(body.experiment.status).toBe('completed');
    expect(body.experiment.endedAt).toEqual(expect.any(Number));
    expect(body.featureFlag.rollout).toBe(100);
    expect(body.featureFlag.variants).toEqual([
      { key: 'variant_a', name: 'Variant A', weight: 100 },
      { key: 'variant_b', name: 'Variant B', weight: 0 },
    ]);
  });
});
