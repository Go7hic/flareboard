import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getFeatureFlagExposureSummary } from '../../src/lib/feature-flags';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 8, 12);

async function insertSession(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(id, TEST_WEBSITE_ID, BASE)
    .run();
}

async function insertExposure(
  id: string,
  sessionId: string,
  flagKey: string,
  variant: string,
  createdAt: number,
  release = '1.0.0',
  environment = 'production',
) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/', ?5, '$feature_flag_called')`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.customEvent)
    .run();

  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES
       (?1, ?2, ?3, '$feature_flag', ?4, 1, ?8),
       (?5, ?2, ?3, '$feature_flag_response', ?6, 1, ?8),
       (?7, ?2, ?3, ?9, ?6, 1, ?8)`,
  )
    .bind(
      `${id}-flag`,
      TEST_WEBSITE_ID,
      id,
      flagKey,
      `${id}-variant`,
      variant,
      `${id}-feature`,
      createdAt,
      `$feature/${flagKey}`,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, data_type, created_at)
     VALUES
       (?1, ?2, ?3, 'release', ?4, 1, ?6),
       (?5, ?2, ?3, 'environment', ?7, 1, ?6)`,
  )
    .bind(
      `${id}-release`,
      TEST_WEBSITE_ID,
      id,
      release,
      `${id}-environment`,
      createdAt,
      environment,
    )
    .run();
}

describe('feature flag exposure summaries', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('counts exposures, sessions, and variants for a flag', async () => {
    await insertSession('flag-session-a');
    await insertSession('flag-session-b');
    await insertExposure('flag-exp-1', 'flag-session-a', 'checkout.flow', 'control', BASE + 1000);
    await insertExposure('flag-exp-2', 'flag-session-b', 'checkout.flow', 'variant_a', BASE + 2000);
    await insertExposure('flag-exp-3', 'flag-session-b', 'checkout.flow', 'variant_a', BASE + 3000);

    const summary = await getFeatureFlagExposureSummary(env, TEST_WEBSITE_ID, 'checkout.flow');

    expect(summary).toEqual({
      exposures: 3,
      sessions: 2,
      lastCalledAt: BASE + 3000,
      health: {
        status: 'healthy',
        dominantVariant: 'variant_a',
        dominantShare: 66.67,
        issues: [],
      },
      variants: [
        { variant: 'variant_a', exposures: 2, sessions: 1, percentage: 66.67 },
        { variant: 'control', exposures: 1, sessions: 1, percentage: 33.33 },
      ],
      trend: [{ date: '2026-01-08', exposures: 3, sessions: 2 }],
      releases: [{ release: '1.0.0', exposures: 3, sessions: 2, percentage: 100 }],
      environments: [{ environment: 'production', exposures: 3, sessions: 2, percentage: 100 }],
      recent: [
        {
          id: 'flag-exp-3',
          sessionId: 'flag-session-b',
          urlPath: '/',
          createdAt: BASE + 3000,
          variant: 'variant_a',
          release: '1.0.0',
          environment: 'production',
        },
        {
          id: 'flag-exp-2',
          sessionId: 'flag-session-b',
          urlPath: '/',
          createdAt: BASE + 2000,
          variant: 'variant_a',
          release: '1.0.0',
          environment: 'production',
        },
        {
          id: 'flag-exp-1',
          sessionId: 'flag-session-a',
          urlPath: '/',
          createdAt: BASE + 1000,
          variant: 'control',
          release: '1.0.0',
          environment: 'production',
        },
      ],
    });
  });

  it('marks concentrated variant traffic as needing attention', async () => {
    for (let i = 0; i < 10; i++) {
      const sessionId = `flag-concentrated-session-${i}`;
      await insertSession(sessionId);
      await insertExposure(
        `flag-concentrated-exp-${i}`,
        sessionId,
        'checkout.concentrated',
        i === 9 ? 'control' : 'variant_a',
        BASE + 10_000 + i,
      );
    }

    const summary = await getFeatureFlagExposureSummary(env, TEST_WEBSITE_ID, 'checkout.concentrated');

    expect(summary.health).toEqual({
      status: 'needs_attention',
      dominantVariant: 'variant_a',
      dominantShare: 90,
      issues: ['traffic_concentrated'],
    });
  });
});
