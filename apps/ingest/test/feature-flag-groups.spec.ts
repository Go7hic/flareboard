import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { upsertPerson } from '@flareboard/db';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerJson } from './helpers/fetch-worker';
import { testSiteDb } from './helpers/site-db';

const NOW = Date.UTC(2026, 2, 1);

async function insertFlag(
  id: string,
  key: string,
  fields: {
    conditionGroups?: unknown;
    variants?: unknown;
    payload?: unknown;
    earlyAccess?: { name: string; description: string };
  },
) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO feature_flag
       (flag_id, website_id, key, name, description, enabled, rollout, variants, condition_groups, payload,
        early_access, early_access_name, early_access_description, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?3, '', 1, 100, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
  )
    .bind(
      id,
      TEST_WEBSITE_ID,
      key,
      fields.variants ? JSON.stringify(fields.variants) : null,
      fields.conditionGroups ? JSON.stringify(fields.conditionGroups) : null,
      fields.payload === undefined ? null : JSON.stringify(fields.payload),
      fields.earlyAccess ? 1 : 0,
      fields.earlyAccess?.name ?? '',
      fields.earlyAccess?.description ?? '',
      NOW,
    )
    .run();
}

async function evaluate(keys: string[], context: Record<string, unknown>) {
  return fetchWorkerJson<{ results: Record<string, string | boolean>; payloads: Record<string, unknown> }>(
    '/api/feature-flags/evaluate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website: TEST_WEBSITE_ID, keys, context }),
    },
  );
}

describe('feature flags for the tracker', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertFlag('ff-plain', 'tracker.plain', {
      conditionGroups: [{ conditions: [], rollout: 70 }],
      payload: { banner: 'Spring sale' },
    });
    await insertFlag('ff-variants', 'tracker.variants', {
      variants: [
        { key: 'a', name: 'A', weight: 50, payload: 'copy-a' },
        { key: 'b', name: 'B', weight: 50 },
      ],
      conditionGroups: [{ conditions: [], rollout: 100 }],
    });
    await insertFlag('ff-groups', 'tracker.groups', {
      conditionGroups: [
        { conditions: [{ field: 'path', operator: 'equals', value: '/a' }], rollout: 100 },
        { conditions: [{ field: 'person', key: 'plan', operator: 'equals', value: 'pro' }], rollout: 100 },
      ],
      payload: ['x', 1],
    });
    await insertFlag('ff-early', 'tracker.early', {
      conditionGroups: [{ conditions: [], rollout: 0 }],
      earlyAccess: { name: 'New editor', description: 'Try it first.' },
    });
  });

  it('adds payloads, early access features and server-evaluation hints to tracker config', async () => {
    await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);
    const { response, body } = await fetchWorkerJson<{
      featureFlags: Array<Record<string, unknown>>;
      earlyAccessFeatures: Array<Record<string, unknown>>;
    }>(`/api/tracker-config?website=${TEST_WEBSITE_ID}`);
    expect(response.status).toBe(200);

    const byKey = Object.fromEntries(body.featureFlags.map((flag) => [flag.key, flag]));
    expect(byKey['tracker.plain']).toEqual({
      key: 'tracker.plain',
      enabled: true,
      rollout: 70,
      variants: [],
      targeted: false,
      payload: { banner: 'Spring sale' },
    });
    expect(byKey['tracker.variants']).toEqual({
      key: 'tracker.variants',
      enabled: true,
      rollout: 100,
      variants: [
        { key: 'a', name: 'A', weight: 50, payload: 'copy-a' },
        { key: 'b', name: 'B', weight: 50 },
      ],
      targeted: false,
    });
    expect(byKey['tracker.groups']).toMatchObject({ targeted: true });
    expect(byKey['tracker.groups']).not.toHaveProperty('conditionGroups');
    expect(byKey['tracker.early']).toMatchObject({ targeted: true });
    expect(body.earlyAccessFeatures).toEqual([
      { flagKey: 'tracker.early', name: 'New editor', description: 'Try it first.' },
    ]);
  });

  it('evaluates condition groups against stored person properties and returns payloads', async () => {
    await upsertPerson(testSiteDb(TEST_WEBSITE_ID), {
      websiteId: TEST_WEBSITE_ID,
      distinctId: 'tracker-pro',
      properties: { plan: 'pro', '$feature_enrollment/tracker.early': true },
      seenAt: NOW,
    });

    const pro = await evaluate(['tracker.groups', 'tracker.early'], { distinctId: 'tracker-pro', path: '/home' });
    expect(pro.response.status).toBe(200);
    expect(pro.body.results).toEqual({ 'tracker.groups': 'test', 'tracker.early': 'test' });
    expect(pro.body.payloads).toEqual({ 'tracker.groups': ['x', 1] });

    const byPath = await evaluate(['tracker.groups'], { distinctId: 'someone-else', path: '/a' });
    expect(byPath.body.results['tracker.groups']).toBe('test');

    const neither = await evaluate(['tracker.groups', 'tracker.early', 'tracker.unknown'], {
      distinctId: 'someone-else',
      path: '/home',
    });
    expect(neither.body.results).toEqual({
      'tracker.groups': 'control',
      'tracker.early': 'control',
      'tracker.unknown': false,
    });
    expect(neither.body.payloads).toEqual({});
  });
});
