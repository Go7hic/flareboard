import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getExperimentResults } from '../../src/lib/experiments';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 1, 12);
const DAY = 24 * 60 * 60 * 1000;

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

describe('getExperimentResults', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('counts exposed sessions and goal conversions by feature flag variant', async () => {
    await insertSession('exp-control-1');
    await insertSession('exp-control-2');
    await insertSession('exp-test-1');
    await insertSession('exp-test-2');

    await insertEvent('exposure-control-1', 'exp-control-1', '$feature_flag_called', BASE, {
      '$feature_flag': 'checkout.new_flow',
      '$feature_flag_response': 'control',
      '$feature/checkout.new_flow': 'control',
    });
    await insertEvent('exposure-test-1', 'exp-test-1', '$feature_flag_called', BASE, {
      '$feature_flag': 'checkout.new_flow',
      '$feature_flag_response': 'test',
      '$feature/checkout.new_flow': 'test',
    });
    await insertEvent('exposure-test-2', 'exp-test-2', '$feature_flag_called', BASE, {
      '$feature_flag': 'checkout.new_flow',
      '$feature_flag_response': 'test',
      '$feature/checkout.new_flow': 'test',
    });
    await insertEvent('conversion-test-1', 'exp-test-1', 'checkout_completed', BASE + 1000, {
      '$feature/checkout.new_flow': 'test',
    });
    await insertEvent('conversion-control-1', 'exp-control-1', 'checkout_completed', BASE + 1000, {
      '$feature/checkout.new_flow': 'control',
    });
    await insertEvent('exposure-control-2', 'exp-control-2', '$feature_flag_called', BASE + DAY, {
      '$feature_flag': 'checkout.new_flow',
      '$feature_flag_response': 'control',
      '$feature/checkout.new_flow': 'control',
    });
    await insertEvent('conversion-control-2', 'exp-control-2', 'checkout_completed', BASE + DAY + 1000, {
      '$feature/checkout.new_flow': 'control',
    });

    const result = await getExperimentResults(
      env,
      TEST_WEBSITE_ID,
      'checkout.new_flow',
      'checkout_completed',
      BASE - 1000,
      BASE + DAY + 2000,
    );

    expect(result.variants).toEqual([
      expect.objectContaining({
        variant: 'control',
        exposures: 2,
        conversions: 2,
        conversionRate: 100,
        lift: null,
        baseline: true,
        confidenceIntervalLow: expect.any(Number),
        confidenceIntervalHigh: expect.any(Number),
        pValue: null,
        confidence: null,
        significant: false,
      }),
      expect.objectContaining({
        variant: 'test',
        exposures: 2,
        conversions: 1,
        conversionRate: 50,
        lift: -50,
        baseline: false,
        confidenceIntervalLow: expect.any(Number),
        confidenceIntervalHigh: expect.any(Number),
        pValue: expect.any(Number),
        confidence: expect.any(Number),
        significant: false,
      }),
    ]);
    expect(result.summary).toMatchObject({
      totalExposures: 4,
      totalConversions: 3,
      conversionRate: 75,
      controlVariant: 'control',
      controlConversionRate: 100,
      leaderVariant: 'control',
      leaderConversionRate: 100,
      leaderLift: null,
      significantVariant: null,
      maxConfidence: expect.any(Number),
      trafficImbalanced: false,
      sampleReady: false,
      decision: 'keep_collecting',
      recommendation: 'collect_more_data',
      diagnostics: [{ code: 'low_sample', level: 'info' }],
      sampleSize: {
        minimumExposuresPerVariant: 30,
        minimumConversions: 10,
        currentMinExposures: 2,
        remainingExposures: 56,
        remainingConversions: 7,
        ready: false,
      },
    });
    expect(result.recent).toEqual([
      {
        id: 'exposure-control-2',
        sessionId: 'exp-control-2',
        variant: 'control',
        urlPath: '/',
        exposedAt: BASE + DAY,
        converted: true,
        convertedAt: BASE + DAY + 1000,
      },
      {
        id: 'exposure-test-2',
        sessionId: 'exp-test-2',
        variant: 'test',
        urlPath: '/',
        exposedAt: BASE,
        converted: false,
        convertedAt: null,
      },
      {
        id: 'exposure-test-1',
        sessionId: 'exp-test-1',
        variant: 'test',
        urlPath: '/',
        exposedAt: BASE,
        converted: true,
        convertedAt: BASE + 1000,
      },
      {
        id: 'exposure-control-1',
        sessionId: 'exp-control-1',
        variant: 'control',
        urlPath: '/',
        exposedAt: BASE,
        converted: true,
        convertedAt: BASE + 1000,
      },
    ]);
    expect(result.trend).toEqual([
      {
        date: '2026-01-01',
        variant: 'control',
        exposures: 1,
        conversions: 1,
        conversionRate: 100,
      },
      {
        date: '2026-01-01',
        variant: 'test',
        exposures: 2,
        conversions: 1,
        conversionRate: 50,
      },
      {
        date: '2026-01-02',
        variant: 'control',
        exposures: 1,
        conversions: 1,
        conversionRate: 100,
      },
    ]);
  });

  it('marks a leading variant as significant when sample and conversion gap are strong', async () => {
    const later = BASE + DAY * 5;

    for (let i = 0; i < 40; i++) {
      const controlSession = `sig-control-${i}`;
      await insertSession(controlSession);
      await insertEvent(`sig-exposure-control-${i}`, controlSession, '$feature_flag_called', later + i, {
        '$feature_flag': 'checkout.significance',
        '$feature_flag_response': 'control',
        '$feature/checkout.significance': 'control',
      });
      if (i < 20) {
        await insertEvent(`sig-conversion-control-${i}`, controlSession, 'checkout_completed', later + 1000 + i, {
          '$feature/checkout.significance': 'control',
        });
      }

      const testSession = `sig-test-${i}`;
      await insertSession(testSession);
      await insertEvent(`sig-exposure-test-${i}`, testSession, '$feature_flag_called', later + 2000 + i, {
        '$feature_flag': 'checkout.significance',
        '$feature_flag_response': 'test',
        '$feature/checkout.significance': 'test',
      });
      if (i < 32) {
        await insertEvent(`sig-conversion-test-${i}`, testSession, 'checkout_completed', later + 3000 + i, {
          '$feature/checkout.significance': 'test',
        });
      }
    }

    const result = await getExperimentResults(
      env,
      TEST_WEBSITE_ID,
      'checkout.significance',
      'checkout_completed',
      later - 1000,
      later + 10_000,
    );

    expect(result.summary).toMatchObject({
      totalExposures: 80,
      totalConversions: 52,
      leaderVariant: 'test',
      significantVariant: 'test',
      sampleReady: true,
      decision: 'ship_variant',
      recommendation: 'variant_leading',
      conclusion: {
        status: 'winner',
        variant: 'test',
        action: 'ship_variant',
        confidence: expect.any(Number),
      },
    });
    expect(result.summary.maxConfidence).toBeGreaterThanOrEqual(95);
    expect(result.summary.diagnostics).toContainEqual({
      code: 'significant_variant',
      level: 'success',
    });
    expect(result.variants.find((variant) => variant.variant === 'test')).toMatchObject({
      exposures: 40,
      conversions: 32,
      conversionRate: 80,
      significant: true,
    });
  });

  it('asks to fix setup when an experiment has no control group', async () => {
    const later = BASE + DAY * 7;
    await insertSession('no-control-session-1');
    await insertEvent('no-control-exposure-1', 'no-control-session-1', '$feature_flag_called', later, {
      '$feature_flag': 'checkout.no_control',
      '$feature_flag_response': 'variant_a',
      '$feature/checkout.no_control': 'variant_a',
    });

    const result = await getExperimentResults(
      env,
      TEST_WEBSITE_ID,
      'checkout.no_control',
      'checkout_completed',
      later - 1000,
      later + 1000,
    );

    expect(result.summary).toMatchObject({
      totalExposures: 1,
      controlVariant: null,
      decision: 'fix_setup',
      recommendation: 'no_control',
      diagnostics: [{ code: 'missing_control', level: 'warning' }],
    });
  });
});
