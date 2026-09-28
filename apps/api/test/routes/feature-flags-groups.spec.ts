import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { upsertPerson, upsertPersonGroupMembership } from '@flareboard/db';
import { createSecureToken, EVENT_TYPE, rolloutBucket } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 2, 1, 12);
const flagsUrl = `/api/websites/${TEST_WEBSITE_ID}/feature-flags`;

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type Flag = {
  id: string;
  key: string;
  enabled: boolean;
  rollout: number;
  targetingRules: unknown[];
  conditionGroups: Array<{ conditions: unknown[]; rollout: number; variant?: string }>;
  variants: Array<{ key: string; name: string; weight: number; payload?: unknown }>;
  payload: unknown;
  earlyAccess: { name: string; description: string } | null;
};

async function api<T>(path: string, method = 'GET', body?: unknown) {
  return fetchWorkerJson<T>(path, {
    method,
    headers: await authHeader(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createFlag(body: Record<string, unknown>) {
  const created = await api<Flag & { message?: string }>(flagsUrl, 'POST', { name: String(body.key), ...body });
  expect(created.response.status, created.body.message).toBe(201);
  return created.body;
}

type Decision = {
  distinctId: string;
  featureFlags: Record<string, string | boolean>;
  featureFlagPayloads: Record<string, unknown>;
  flags: Record<string, { enabled: boolean; reason: string; conditionGroup: number | null; payload: unknown }>;
};

async function evaluateAll(body: Record<string, unknown>) {
  const result = await api<Decision>(`${flagsUrl}/evaluate-all`, 'POST', body);
  expect(result.response.status).toBe(200);
  return result.body;
}

async function seedSessionEvent(sessionId: string, distinctId: string | null, eventName: string, createdAt = BASE) {
  const db = testSiteDb(TEST_WEBSITE_ID);
  await db
    .prepare(
      `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(sessionId, TEST_WEBSITE_ID, distinctId, createdAt)
    .run();
  await db
    .prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, ?3, ?3, ?4, '/', ?5, ?6)`,
    )
    .bind(`${sessionId}-${eventName}`, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.customEvent, eventName)
    .run();
}

describe('feature flag condition groups, payloads and history', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates a flag with groups and payloads and mirrors the first group into the legacy fields', async () => {
    const flag = await createFlag({
      key: 'groups.create',
      variants: [
        { key: 'a', name: 'A', weight: 50, payload: { color: 'red' } },
        { key: 'b', name: 'B', weight: 50, payload: null },
      ],
      conditionGroups: [
        { conditions: [{ field: 'path', operator: 'contains', value: '/pricing' }], rollout: 40, variant: 'a' },
        { conditions: [], rollout: 10 },
      ],
    });

    expect(flag.conditionGroups).toEqual([
      { conditions: [{ field: 'path', operator: 'contains', value: '/pricing' }], rollout: 40, variant: 'a' },
      { conditions: [], rollout: 10 },
    ]);
    expect(flag.variants).toEqual([
      { key: 'a', name: 'A', weight: 50, payload: { color: 'red' } },
      { key: 'b', name: 'B', weight: 50 },
    ]);
    expect(flag.rollout).toBe(40);
    expect(flag.targetingRules).toEqual([{ field: 'path', operator: 'contains', value: '/pricing' }]);

    const stored = await env.DB.prepare(`SELECT rollout, targeting_rules FROM feature_flag WHERE flag_id = ?1`)
      .bind(flag.id)
      .first<{ rollout: number; targeting_rules: string }>();
    expect(stored?.rollout).toBe(40);
    expect(JSON.parse(stored!.targeting_rules)).toHaveLength(1);
  });

  it('accepts the legacy rollout / targetingRules shorthand as one group', async () => {
    const flag = await createFlag({
      key: 'groups.legacy_body',
      rollout: 25,
      targetingRules: [{ field: 'language', operator: 'starts_with', value: 'en' }],
      payload: 'plain string payload',
    });
    expect(flag.conditionGroups).toEqual([
      { conditions: [{ field: 'language', operator: 'starts_with', value: 'en' }], rollout: 25 },
    ]);
    expect(flag.payload).toBe('plain string payload');

    const patched = await api<Flag>(`${flagsUrl}/${flag.id}`, 'PATCH', { rollout: 60 });
    expect(patched.response.status).toBe(200);
    expect(patched.body.conditionGroups).toEqual([
      { conditions: [{ field: 'language', operator: 'starts_with', value: 'en' }], rollout: 60 },
    ]);
  });

  it('rejects inconsistent flags', async () => {
    const base = { key: 'groups.invalid', name: 'Invalid' };
    const unknownVariant = await api<{ message: string }>(flagsUrl, 'POST', {
      ...base,
      variants: [{ key: 'a', name: 'A', weight: 100 }],
      conditionGroups: [{ conditions: [], rollout: 100, variant: 'b' }],
    });
    expect(unknownVariant.response.status).toBe(400);
    expect(unknownVariant.body.message).toContain('unknown variant "b"');

    const payloadWithVariants = await api<{ message: string }>(flagsUrl, 'POST', {
      ...base,
      variants: [{ key: 'a', name: 'A', weight: 100 }],
      payload: { nope: true },
    });
    expect(payloadWithVariants.response.status).toBe(400);

    const tooBig = await api<{ message: string }>(flagsUrl, 'POST', { ...base, payload: 'x'.repeat(17 * 1024) });
    expect(tooBig.response.status).toBe(400);
    expect(tooBig.body.message).toContain('16 KB');

    const missingCohort = await api<{ message: string }>(flagsUrl, 'POST', {
      ...base,
      conditionGroups: [{ conditions: [{ field: 'cohort', operator: 'in_cohort', value: 'no-such-cohort' }] }],
    });
    expect(missingCohort.response.status).toBe(400);
    expect(missingCohort.body.message).toContain('Unknown cohort');

    const multi = await createFlag({ key: 'groups.multi', conditionGroups: [{ conditions: [] }, { conditions: [] }] });
    const ambiguous = await api<{ message: string }>(`${flagsUrl}/${multi.id}`, 'PATCH', { rollout: 10 });
    expect(ambiguous.response.status).toBe(400);
    expect(ambiguous.body.message).toContain('conditionGroups');
  });

  it('records create, update and delete with before/after in the flag history', async () => {
    const flag = await createFlag({ key: 'groups.history', rollout: 20 });
    await api(`${flagsUrl}/${flag.id}`, 'PATCH', {
      conditionGroups: [{ conditions: [], rollout: 80 }],
      payload: { copy: 'v2' },
    });
    // A no-op update is not recorded.
    await api(`${flagsUrl}/${flag.id}`, 'PATCH', { payload: { copy: 'v2' } });

    type History = {
      total: number;
      items: Array<{
        action: string;
        username: string;
        metadata: { changes: string[]; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
      }>;
    };
    const history = await api<History>(`${flagsUrl}/${flag.id}/history`);
    expect(history.response.status).toBe(200);
    expect(history.body.total).toBe(2);
    const [update, create] = history.body.items;
    expect(create).toMatchObject({ action: 'create', username: 'test-user' });
    expect(create.metadata.before).toBeNull();
    expect(create.metadata.after).toMatchObject({ key: 'groups.history', conditionGroups: [{ rollout: 20 }] });
    expect(update.action).toBe('update');
    expect(update.metadata.changes.sort()).toEqual(['conditionGroups', 'payload']);
    expect(update.metadata.before).toMatchObject({ conditionGroups: [{ rollout: 20 }], payload: null });
    expect(update.metadata.after).toMatchObject({ conditionGroups: [{ rollout: 80 }], payload: { copy: 'v2' } });

    const deleted = await api(`${flagsUrl}/${flag.id}`, 'DELETE');
    expect(deleted.response.status).toBe(200);
    const afterDelete = await api<History>(`${flagsUrl}/${flag.id}/history`);
    expect(afterDelete.response.status).toBe(200);
    expect(afterDelete.body.items[0]).toMatchObject({ action: 'delete', metadata: { after: null } });

    const otherSite = await api(`/api/websites/00000000-0000-0000-0000-00000000dead/feature-flags/${flag.id}/history`);
    expect(otherSite.response.status).toBe(404);
  });

  it('refuses to delete a flag an experiment depends on', async () => {
    const flag = await createFlag({ key: 'groups.experiment_owned' });
    await env.DB.prepare(
      `INSERT INTO experiment (experiment_id, website_id, feature_flag_id, name, description, status, goal_event, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-00000000e901', ?1, ?2, 'Owner', '', 'draft', 'signup', ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, flag.id, BASE)
      .run();
    const result = await api<{ message: string }>(`${flagsUrl}/${flag.id}`, 'DELETE');
    expect(result.response.status).toBe(409);
    expect(result.body.message).toContain('Owner');
  });
});

describe('server-side evaluation', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('merges stored person properties under the supplied ones and returns payloads', async () => {
    await createFlag({
      key: 'eval.person',
      payload: { tier: 'enterprise' },
      conditionGroups: [{ conditions: [{ field: 'person', key: 'plan', operator: 'equals', value: 'enterprise' }] }],
    });
    await upsertPerson(testSiteDb(TEST_WEBSITE_ID), {
      websiteId: TEST_WEBSITE_ID,
      distinctId: 'person-enterprise',
      properties: { plan: 'enterprise' },
      seenAt: BASE,
    });

    const stored = await evaluateAll({ distinctId: 'person-enterprise', keys: ['eval.person'] });
    expect(stored.featureFlags['eval.person']).toBe(true);
    expect(stored.featureFlagPayloads['eval.person']).toEqual({ tier: 'enterprise' });
    expect(stored.flags['eval.person']).toMatchObject({ reason: 'match', conditionGroup: 0 });

    const overridden = await evaluateAll({
      distinctId: 'person-enterprise',
      keys: ['eval.person'],
      personProperties: { plan: 'free' },
    });
    expect(overridden.featureFlags['eval.person']).toBe(false);
    expect(overridden.featureFlagPayloads).toEqual({});

    const supplied = await evaluateAll({
      distinctId: 'unknown-person',
      keys: ['eval.person', 'eval.missing'],
      personProperties: { plan: 'enterprise' },
    });
    expect(supplied.featureFlags).toEqual({ 'eval.person': true, 'eval.missing': false });
    expect(supplied.flags['eval.missing'].reason).toBe('missing');
  });

  it('serves the group variant override with that variant payload', async () => {
    await createFlag({
      key: 'eval.variants',
      variants: [
        { key: 'control', name: 'Control', weight: 50 },
        { key: 'new', name: 'New', weight: 50, payload: { headline: 'New!' } },
      ],
      conditionGroups: [
        { conditions: [{ field: 'property', key: 'beta', operator: 'equals', value: 'yes' }], variant: 'new' },
        { conditions: [], rollout: 0 },
      ],
    });
    const beta = await evaluateAll({ distinctId: 'variant-user', keys: ['eval.variants'], properties: { beta: 'yes' } });
    expect(beta.featureFlags['eval.variants']).toBe('new');
    expect(beta.featureFlagPayloads['eval.variants']).toEqual({ headline: 'New!' });

    const rest = await evaluateAll({ distinctId: 'variant-user', keys: ['eval.variants'] });
    expect(rest.featureFlags['eval.variants']).toBe(false);
    expect(rest.flags['eval.variants']).toMatchObject({ reason: 'rollout_miss', conditionGroup: 1 });
  });

  it('targets cohort members through their sessions', async () => {
    const cohortId = '00000000-0000-0000-0000-00000000c001';
    await env.DB.prepare(
      `INSERT INTO cohort (cohort_id, website_id, name, type, value, definition, created_at, updated_at)
       VALUES (?1, ?2, 'Upgraders', 'event', 'upgrade', ?3, ?4, ?4)`,
    )
      .bind(cohortId, TEST_WEBSITE_ID, JSON.stringify({ conditions: [{ field: 'event_name', operator: 'equals', value: 'upgrade' }] }), BASE)
      .run();
    await createFlag({
      key: 'eval.cohort',
      conditionGroups: [{ conditions: [{ field: 'cohort', operator: 'in_cohort', value: cohortId }] }],
    });

    const site = testSiteDb(TEST_WEBSITE_ID);
    await upsertPerson(site, { websiteId: TEST_WEBSITE_ID, distinctId: 'cohort-member', seenAt: BASE });
    await upsertPerson(site, { websiteId: TEST_WEBSITE_ID, distinctId: 'cohort-outsider', seenAt: BASE });
    await seedSessionEvent('cohort-session-1', 'cohort-member', 'upgrade', BASE + 1000);
    await seedSessionEvent('cohort-session-2', 'cohort-outsider', 'browse', BASE + 1000);
    await seedSessionEvent('cohort-anon-session', null, 'upgrade', BASE + 1000);

    expect((await evaluateAll({ distinctId: 'cohort-member', keys: ['eval.cohort'] })).featureFlags['eval.cohort']).toBe(
      true,
    );
    expect(
      (await evaluateAll({ distinctId: 'cohort-outsider', keys: ['eval.cohort'] })).featureFlags['eval.cohort'],
    ).toBe(false);
    // Anonymous visitors are judged on their current session only.
    expect(
      (await evaluateAll({ distinctId: 'anon-visitor', sessionId: 'cohort-anon-session', keys: ['eval.cohort'] }))
        .featureFlags['eval.cohort'],
    ).toBe(true);

    // The answer for identified people is cached per cohort version.
    await seedSessionEvent('cohort-session-3', 'cohort-outsider', 'upgrade', BASE + 2000);
    expect(
      (await evaluateAll({ distinctId: 'cohort-outsider', keys: ['eval.cohort'] })).featureFlags['eval.cohort'],
    ).toBe(false);
    await env.DB.prepare(`UPDATE cohort SET updated_at = ?2 WHERE cohort_id = ?1`).bind(cohortId, BASE + 5000).run();
    expect(
      (await evaluateAll({ distinctId: 'cohort-outsider', keys: ['eval.cohort'] })).featureFlags['eval.cohort'],
    ).toBe(true);
  });

  it('targets stored group keys and group properties', async () => {
    await createFlag({
      key: 'eval.group',
      conditionGroups: [
        {
          conditions: [
            { field: 'group_property', groupType: 'company', key: 'plan', operator: 'equals', value: 'scale' },
          ],
        },
      ],
    });
    const site = testSiteDb(TEST_WEBSITE_ID);
    await upsertPersonGroupMembership(site, {
      websiteId: TEST_WEBSITE_ID,
      distinctId: 'group-member',
      groupType: 'company',
      groupKey: 'acme',
      seenAt: BASE,
    });
    await site
      .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, created_at) VALUES ('group-session', ?1, ?2)`)
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    for (const [index, [key, value]] of [
      ['$group/company', 'acme'],
      ['$group/company/plan', 'scale'],
    ].entries()) {
      await site
        .prepare(
          `INSERT INTO session_data (session_data_id, website_id, session_id, data_key, string_value, data_type, created_at)
           VALUES (?1, ?2, 'group-session', ?3, ?4, 1, ?5)`,
        )
        .bind(`group-data-${index}`, TEST_WEBSITE_ID, key, value, BASE)
        .run();
    }

    expect((await evaluateAll({ distinctId: 'group-member', keys: ['eval.group'] })).featureFlags['eval.group']).toBe(
      true,
    );
    const otherCompany = await evaluateAll({ distinctId: 'group-member', keys: ['eval.group'], groups: { company: 'globex' } });
    expect(otherCompany.featureFlags['eval.group']).toBe(false);
    const supplied = await evaluateAll({
      distinctId: 'nobody',
      keys: ['eval.group'],
      groups: { company: 'initech' },
      groupProperties: { company: { plan: 'scale' } },
    });
    expect(supplied.featureFlags['eval.group']).toBe(true);
  });

  it('returns definitions for local evaluation with cohorts and no secrets', async () => {
    type Definitions = {
      bucketing: { rollout: string; variant: string };
      flags: Array<{
        key: string;
        conditionGroups: unknown[];
        payload: unknown;
        localEvaluation: boolean;
        requires: { cohorts: string[]; personProperties: boolean; groupTypes: string[] };
      }>;
      cohorts: Record<string, { name: string; type: string; definition: { conditions: unknown[] } }>;
    };
    const { response, body } = await api<Definitions>(`${flagsUrl}/definitions`);
    expect(response.status).toBe(200);
    expect(body.bucketing).toMatchObject({ rollout: '{flagKey}:{bucketingId}', variant: '{flagKey}:variant:{bucketingId}' });

    const cohortFlag = body.flags.find((flag) => flag.key === 'eval.cohort')!;
    expect(cohortFlag.localEvaluation).toBe(false);
    const [cohortId] = cohortFlag.requires.cohorts;
    expect(body.cohorts[cohortId]).toMatchObject({ name: 'Upgraders', type: 'behavioral' });

    const personFlag = body.flags.find((flag) => flag.key === 'eval.person')!;
    expect(personFlag).toMatchObject({ localEvaluation: true, payload: { tier: 'enterprise' } });
    expect(personFlag.requires.personProperties).toBe(true);
    expect(body.flags.find((flag) => flag.key === 'eval.group')!.requires.groupTypes).toEqual(['company']);

    const text = JSON.stringify(body);
    expect(text).not.toContain(TEST_USER_ID);
    expect(text).not.toContain('summary');

    // Flag writes invalidate the cached definitions.
    await createFlag({ key: 'eval.after_cache' });
    const fresh = await api<Definitions>(`${flagsUrl}/definitions`);
    expect(fresh.body.flags.some((flag) => flag.key === 'eval.after_cache')).toBe(true);
  });

  it('buckets server-side rollouts with the canonical hash', async () => {
    await createFlag({ key: 'eval.rollout', conditionGroups: [{ conditions: [], rollout: 50 }] });
    for (let i = 0; i < 20; i++) {
      const distinctId = `bucket-${i}`;
      const decision = await evaluateAll({ distinctId, keys: ['eval.rollout'] });
      expect(decision.featureFlags['eval.rollout']).toBe(rolloutBucket('eval.rollout', distinctId) < 50);
    }
  });
});

describe('early access features', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('lists features, stores enrollment as a person property and forces the flag for that person', async () => {
    const flag = await createFlag({
      key: 'beta.dark_mode',
      earlyAccess: { name: 'Dark mode', description: 'Try the new theme.' },
      conditionGroups: [{ conditions: [], rollout: 0 }],
    });
    expect(flag.earlyAccess).toEqual({ name: 'Dark mode', description: 'Try the new theme.' });
    await createFlag({ key: 'beta.not_early' });

    type Features = { features: Array<{ flagKey: string; name: string; enrolled?: boolean | null }> };
    const list = await api<Features>(`${flagsUrl}/early-access?distinctId=early-user`);
    expect(list.body.features).toEqual([
      expect.objectContaining({ flagKey: 'beta.dark_mode', name: 'Dark mode', enrolled: null }),
    ]);

    const before = await evaluateAll({ distinctId: 'early-user', keys: ['beta.dark_mode'] });
    expect(before.featureFlags['beta.dark_mode']).toBe(false);

    const enroll = await api<{ property: string }>(
      `${flagsUrl}/early-access/beta.dark_mode/enrollment`,
      'PUT',
      { distinctId: 'early-user', enrolled: true },
    );
    expect(enroll.response.status).toBe(200);
    expect(enroll.body.property).toBe('$feature_enrollment/beta.dark_mode');

    const person = await testSiteDb(TEST_WEBSITE_ID)
      .prepare(`SELECT properties_json AS props FROM person WHERE website_id = ?1 AND distinct_id = 'early-user'`)
      .bind(TEST_WEBSITE_ID)
      .first<{ props: string }>();
    expect(JSON.parse(person!.props)).toMatchObject({ '$feature_enrollment/beta.dark_mode': true });

    const enrolled = await evaluateAll({ distinctId: 'early-user', keys: ['beta.dark_mode'] });
    expect(enrolled.featureFlags['beta.dark_mode']).toBe(true);
    expect(enrolled.flags['beta.dark_mode'].reason).toBe('early_access_enrolled');
    expect(
      (await api<Features>(`${flagsUrl}/early-access?distinctId=early-user`)).body.features[0].enrolled,
    ).toBe(true);

    await api(`${flagsUrl}/early-access/beta.dark_mode/enrollment`, 'PUT', { distinctId: 'early-user', enrolled: false });
    const optedOut = await evaluateAll({ distinctId: 'early-user', keys: ['beta.dark_mode'] });
    expect(optedOut.flags['beta.dark_mode'].reason).toBe('early_access_opted_out');

    const notEarly = await api(`${flagsUrl}/early-access/beta.not_early/enrollment`, 'PUT', {
      distinctId: 'early-user',
      enrolled: true,
    });
    expect(notEarly.response.status).toBe(404);

    // Turning early access off keeps the flag but drops it from the list.
    await api(`${flagsUrl}/${flag.id}`, 'PATCH', { earlyAccess: null });
    expect((await api<Features>(`${flagsUrl}/early-access`)).body.features).toEqual([]);
  });
});
