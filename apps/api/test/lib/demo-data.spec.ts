import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  boardParametersSchema,
  cohortDefinitionSchema,
  createSecureToken,
  DEMO_DOCS_WEBSITE_ID,
  DEMO_TEAM_ID,
  evaluateFeatureFlag,
  EVENT_TYPE,
  hashPassword,
  insightQuerySchema,
  lookupModelPrice,
  PUBLIC_DEMO_WEBSITE_ID,
  surveyQuestionsSchema,
  workflowStepsSchema,
} from '@flareboard/shared';
import type { Env } from '../../src/env';
import { STORE_PROFILE, DOCS_PROFILE } from '../../src/lib/demo-data/catalog';
import { ensureDemoConfig, loadDemoWebsite } from '../../src/lib/demo-data/config';
import { CHECKOUT_FLAG, CUSTOM_MODEL, demoFlags, experimentId, flagId } from '../../src/lib/demo-data/definitions';
import { generateHour, type DemoSite, type HourData } from '../../src/lib/demo-data/generate';
import { demoSite, generateRange, runDemoBackfill, runDemoDataGenerator } from '../../src/lib/demo-data/runner';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const testEnv = env as unknown as Env;
const OWNER_ID = '00000000-0000-4000-8000-0000000000aa';
const MEMBER_ID = '00000000-0000-4000-8000-0000000000ab';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A fixed "now" (mid-afternoon UTC) so generated volumes are stable. */
const NOW = Date.UTC(2026, 8, 30, 15, 20);

const store: DemoSite = { websiteId: PUBLIC_DEMO_WEBSITE_ID, profile: STORE_PROFILE, hostname: 'demo-store.example.com', flags: demoFlags('store') };
const docs: DemoSite = { websiteId: DEMO_DOCS_WEBSITE_ID, profile: DOCS_PROFILE, hostname: 'docs.example.com', flags: demoFlags('docs') };

function hours(site: DemoSite, from: number, count: number, options = { replays: true, otel: true }): HourData[] {
  return Array.from({ length: count }, (_, index) => generateHour(site, from + index * HOUR, options));
}

async function count(websiteId: string, sql: string, ...params: unknown[]) {
  const row = await testSiteDb(websiteId).prepare(sql).bind(...params).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function token(userId: string, role: 'admin' | 'user') {
  return createSecureToken({ userId, role }, testEnv.APP_SECRET);
}

describe('demo data generator', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (?1, 'demo-owner', ?2, 'admin', ?3, ?3)`,
    )
      .bind(OWNER_ID, hashPassword('unused-password', 4), now)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (?1, 'demo-member', ?2, 'user', ?3, ?3)`,
    )
      .bind(MEMBER_ID, hashPassword('unused-password', 4), now)
      .run();
    for (const [id, name, domain] of [
      [PUBLIC_DEMO_WEBSITE_ID, 'Demo Store', 'demo-store.example.com'],
      [DEMO_DOCS_WEBSITE_ID, 'Demo Docs', 'docs.example.com'],
    ] as const) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?5)`,
      )
        .bind(id, name, domain, OWNER_ID, now)
        .run();
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_by, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'Customer site', 'customer.example', ?1, ?1, ?2, ?2)`,
    )
      .bind(OWNER_ID, now)
      .run();
  });

  it('generates identical rows for the same hour and different rows for the next', () => {
    const hour = NOW - 20 * HOUR - (NOW % HOUR);
    const first = generateHour(store, hour, { replays: true, otel: true });
    const second = generateHour(store, hour, { replays: true, otel: true });
    expect(second).toEqual(first);
    expect(first.events.length).toBeGreaterThan(50);
    const next = generateHour(store, hour + HOUR, { replays: true, otel: true });
    expect(next.events[0]?.id).not.toBe(first.events[0]?.id);
    // Stopping at `until` only drops rows: the kept ones are the same rows.
    const partial = generateHour(store, hour, { until: hour + 30 * 60_000 });
    expect(partial.events.every((event) => event.createdAt <= hour + 30 * 60_000)).toBe(true);
    const ids = new Set(first.events.map((event) => event.id));
    expect(partial.events.every((event) => ids.has(event.id))).toBe(true);
  });

  it('keeps volumes in the intended range', () => {
    const day = Math.floor(NOW / DAY) * DAY - DAY;
    for (const [site, min, max] of [
      [store, 400, 900],
      [docs, 150, 300],
    ] as const) {
      const data = hours(site, day, 24, { replays: false, otel: false });
      const visits = new Set(data.flatMap((hour) => hour.events.map((event) => event.visitId)));
      expect(visits.size).toBeGreaterThanOrEqual(min);
      expect(visits.size).toBeLessThanOrEqual(max);
    }
  });

  it('builds a checkout funnel that only narrows', () => {
    const data = hours(store, NOW - 3 * DAY - (NOW % HOUR), 72, { replays: false, otel: false });
    const byStep = (name: string) => new Set(data.flatMap((hour) => hour.events.filter((event) => event.eventName === name).map((event) => event.visitId)));
    const viewed = byStep('product_viewed');
    const added = byStep('add_to_cart');
    const started = byStep('checkout_started');
    const purchased = byStep('purchase');
    expect(purchased.size).toBeGreaterThan(20);
    for (const visit of purchased) expect(started.has(visit)).toBe(true);
    for (const visit of started) expect(added.has(visit)).toBe(true);
    for (const visit of added) expect(viewed.has(visit)).toBe(true);
    expect(viewed.size).toBeGreaterThan(added.size);
    expect(added.size).toBeGreaterThan(started.size);
    expect(started.size).toBeGreaterThan(purchased.size);
    const revenue = data.flatMap((hour) => hour.revenue.filter((row) => row.eventName === 'purchase'));
    expect(revenue.length).toBe(data.flatMap((hour) => hour.events.filter((event) => event.eventName === 'purchase')).length);
    expect(revenue.every((row) => row.revenue > 0 && ['USD', 'EUR', 'GBP'].includes(row.currency))).toBe(true);
  });

  it('exposes every checkout variant with the flag\'s own bucketing, and the test variant converts better', () => {
    const data = hours(store, NOW - 7 * DAY - (NOW % HOUR), 7 * 24, { replays: false, otel: false });
    const flag = store.flags.find((item) => item.key === CHECKOUT_FLAG)!;
    const distinctBySession = new Map<string, string | null>();
    for (const hour of data) for (const session of hour.sessions) if (session.distinctId) distinctBySession.set(session.sessionId, session.distinctId);
    const exposures = data.flatMap((hour) => hour.events.filter((event) => event.eventName === '$feature_flag_called' && event.properties?.$feature_flag === CHECKOUT_FLAG));
    const perVariant: Record<string, Set<string>> = {};
    for (const exposure of exposures) {
      const variant = String(exposure.properties!.$feature_flag_response);
      (perVariant[variant] ??= new Set()).add(exposure.visitId);
      // Anonymous visitors bucket on the session id, identified ones on their distinct id.
      const candidates = [evaluateFeatureFlag(flag, { sessionId: exposure.sessionId }).variant];
      const distinctId = distinctBySession.get(exposure.sessionId);
      if (distinctId) candidates.push(evaluateFeatureFlag(flag, { distinctId, sessionId: exposure.sessionId }).variant);
      expect(candidates).toContain(variant);
    }
    expect(Object.keys(perVariant).sort()).toEqual(['control', 'test']);
    const total = perVariant.control!.size + perVariant.test!.size;
    expect(perVariant.control!.size / total).toBeGreaterThan(0.4);
    expect(perVariant.control!.size / total).toBeLessThan(0.6);
    const purchases = new Set(data.flatMap((hour) => hour.events.filter((event) => event.eventName === 'purchase').map((event) => event.visitId)));
    const rate = (variant: string) => [...perVariant[variant]!].filter((visit) => purchases.has(visit)).length / perVariant[variant]!.size;
    expect(rate('test')).toBeGreaterThan(rate('control') * 1.15);
  });

  it('groups errors into a few issues with stacks, including a weekly new one', () => {
    const data = hours(store, NOW - 14 * DAY - (NOW % HOUR), 14 * 24, { replays: false, otel: false });
    const errors = data.flatMap((hour) => hour.events.filter((event) => event.eventType === EVENT_TYPE.error));
    expect(errors.length).toBeGreaterThan(50);
    const fingerprints = new Set(errors.map((event) => String(event.properties?.$exception_fingerprint)));
    expect(fingerprints.size).toBeGreaterThanOrEqual(4);
    expect(fingerprints.size).toBeLessThanOrEqual(10);
    expect(errors.every((event) => typeof event.properties?.stack === 'string' && /^[0-9a-f]{16}$/.test(String(event.properties?.$exception_fingerprint)))).toBe(true);
    expect(errors.some((event) => String(event.eventName).includes('reading'))).toBe(true);
  });

  it('prices every LLM call', () => {
    const data = hours(store, NOW - 7 * DAY - (NOW % HOUR), 7 * 24, { replays: false, otel: false });
    const calls = data.flatMap((hour) => hour.events.filter((event) => event.eventType === EVENT_TYPE.ai));
    const generations = calls.filter((event) => event.properties?.aiKind === 'generation' || event.properties?.aiKind === 'embedding');
    expect(generations.length).toBeGreaterThan(20);
    for (const call of generations) {
      const model = String(call.properties!.model);
      expect(typeof call.properties!.inputTokens).toBe('number');
      if (model !== CUSTOM_MODEL) expect(lookupModelPrice(model)).not.toBeNull();
    }
    expect(new Set(generations.map((call) => call.properties!.model)).size).toBeGreaterThanOrEqual(3);
    expect(generations.some((call) => call.properties!.status === 'error')).toBe(true);
    // Every generation hangs under a trace of the same visit.
    const traces = new Set(calls.filter((event) => event.properties?.aiKind === 'trace').map((event) => event.properties!.traceId));
    expect(generations.every((call) => traces.has(call.properties!.traceId))).toBe(true);
  });

  it('seeds configuration idempotently without touching objects it did not create', async () => {
    const website = (await loadDemoWebsite(testEnv, PUBLIC_DEMO_WEBSITE_ID))!;
    const now = Date.now();
    // Someone else's flags: one with a key the demo also uses, one unrelated.
    await env.DB.prepare(
      `INSERT INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, created_at, updated_at)
       VALUES ('foreign-flag-1', ?1, 'holiday-theme', 'Mine', 'hands off', 1, 100, ?2, ?2),
              ('foreign-flag-2', ?1, 'my-own-flag', 'Also mine', '', 0, 100, ?2, ?2)`,
    )
      .bind(PUBLIC_DEMO_WEBSITE_ID, now)
      .run();

    // The demo team (created by the demo sign-in) is how the demo account sees boards.
    await env.DB.prepare(`INSERT OR IGNORE INTO team (team_id, name, created_at, updated_at) VALUES (?1, 'Flareboard Demo', ?2, ?2)`).bind(DEMO_TEAM_ID, now).run();
    const first = await ensureDemoConfig(testEnv, website, NOW, { force: true });
    expect(first.skipped).toEqual(['flag:holiday-theme']);
    const tables = ['feature_flag', 'experiment', 'survey', 'workflow', 'action_definition', 'cohort', 'insight', 'notebook', 'annotation', 'error_alert_rule', 'log_alert_rule'];
    const snapshot = async () => {
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE website_id = ?1`).bind(PUBLIC_DEMO_WEBSITE_ID).first<{ n: number }>();
        counts[table] = Number(row?.n ?? 0);
      }
      return counts;
    };
    const before = await snapshot();
    const again = await ensureDemoConfig(testEnv, website, NOW, { force: true });
    expect(again.ensured).toBe(true);
    expect(await snapshot()).toEqual(before);
    // Without force the second call the same day is a no-op.
    expect((await ensureDemoConfig(testEnv, website, NOW)).ensured).toBe(false);

    expect(before.feature_flag).toBe(demoFlags('store').length - 1 + 2);
    expect(before.experiment).toBe(1);
    expect(before.insight).toBeGreaterThanOrEqual(5);
    expect(before.annotation).toBeGreaterThan(10);

    const foreign = await env.DB.prepare(`SELECT name, description, enabled FROM feature_flag WHERE flag_id IN ('foreign-flag-1', 'foreign-flag-2') ORDER BY flag_id`).all();
    expect(foreign.results).toEqual([
      { name: 'Mine', description: 'hands off', enabled: 1 },
      { name: 'Also mine', description: '', enabled: 0 },
    ]);

    // Stored shapes pass the product's own validators.
    const surveys = await env.DB.prepare(`SELECT questions FROM survey WHERE website_id = ?1`).bind(PUBLIC_DEMO_WEBSITE_ID).all<{ questions: string }>();
    for (const row of surveys.results ?? []) expect(surveyQuestionsSchema.safeParse(JSON.parse(row.questions)).success).toBe(true);
    const workflows = await env.DB.prepare(`SELECT steps, action_type FROM workflow WHERE website_id = ?1`).bind(PUBLIC_DEMO_WEBSITE_ID).all<{ steps: string; action_type: string }>();
    for (const row of workflows.results ?? []) {
      const steps = workflowStepsSchema.parse(JSON.parse(row.steps));
      expect(steps.every((step) => step.type === 'delay' || step.type === 'condition')).toBe(true);
      expect(row.action_type).toBe('record');
    }
    const insights = await env.DB.prepare(`SELECT query FROM insight WHERE website_id = ?1`).bind(PUBLIC_DEMO_WEBSITE_ID).all<{ query: string }>();
    for (const row of insights.results ?? []) expect(insightQuerySchema.safeParse(JSON.parse(row.query)).success).toBe(true);
    const cohorts = await env.DB.prepare(`SELECT definition FROM cohort WHERE website_id = ?1`).bind(PUBLIC_DEMO_WEBSITE_ID).all<{ definition: string }>();
    for (const row of cohorts.results ?? []) expect(cohortDefinitionSchema.safeParse(JSON.parse(row.definition)).success).toBe(true);
    const board = await env.DB.prepare(`SELECT parameters, team_id AS teamId FROM board WHERE user_id = ?1`).bind(OWNER_ID).first<{ parameters: string; teamId: string | null }>();
    expect(board!.teamId).toBe(DEMO_TEAM_ID);
    expect(boardParametersSchema.safeParse(JSON.parse(board!.parameters)).success).toBe(true);
    // Alert rules never deliver.
    const channels = await env.DB.prepare(
      `SELECT channel, target FROM error_alert_rule WHERE website_id = ?1 UNION ALL SELECT channel, target FROM log_alert_rule WHERE website_id = ?1`,
    )
      .bind(PUBLIC_DEMO_WEBSITE_ID)
      .all<{ channel: string; target: string | null }>();
    expect(channels.results).toEqual([
      { channel: 'record', target: null },
      { channel: 'record', target: null },
    ]);
    const price = await env.DB.prepare(`SELECT input_per_million AS input FROM llm_model_price WHERE website_id = ?1 AND model = ?2`).bind(PUBLIC_DEMO_WEBSITE_ID, CUSTOM_MODEL).first();
    expect(price).not.toBeNull();
    const website2 = await env.DB.prepare(`SELECT retention_days FROM website WHERE website_id = ?1`).bind(PUBLIC_DEMO_WEBSITE_ID).first<{ retention_days: number }>();
    expect(website2!.retention_days).toBe(90);
  });

  it('writes an hour twice without duplicates, with playable replays', async () => {
    const website = (await loadDemoWebsite(testEnv, DEMO_DOCS_WEBSITE_ID))!;
    await ensureDemoConfig(testEnv, website, NOW, { force: true });
    const site = demoSite(website);
    const from = NOW - (NOW % HOUR) - 5 * HOUR;
    const budget = { deadline: Date.now() + 60_000, maxHours: 3, maxReplayChunks: 500 };
    const first = await generateRange(testEnv, site, from, NOW, budget);
    expect(first.hours).toBe(3);
    expect(first.cursor).toBe(from + 3 * HOUR);
    const snapshot = async () => ({
      events: await count(DEMO_DOCS_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM website_event'),
      sessions: await count(DEMO_DOCS_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM session'),
      replays: await count(DEMO_DOCS_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM session_replay'),
      heatmap: await count(DEMO_DOCS_WEBSITE_ID, 'SELECT COALESCE(SUM(count), 0) AS n FROM heatmap_cell'),
      responses: Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM survey_response WHERE website_id = ?1').bind(DEMO_DOCS_WEBSITE_ID).first<{ n: number }>())?.n),
    });
    const once = await snapshot();
    expect(once.events).toBe(first.events);
    await generateRange(testEnv, site, from, NOW, budget);
    expect(await snapshot()).toEqual(once);

    const chunks = await testSiteDb(DEMO_DOCS_WEBSITE_ID)
      .prepare('SELECT visit_id AS visitId, chunk_index AS chunkIndex, event_count AS eventCount FROM session_replay ORDER BY visit_id, chunk_index')
      .all<{ visitId: string; chunkIndex: number; eventCount: number }>();
    expect(chunks.results?.length).toBeGreaterThan(0);
    for (const chunk of chunks.results ?? []) {
      const object = await testEnv.REPLAY_BUCKET!.get(`${DEMO_DOCS_WEBSITE_ID}/${chunk.visitId}/${chunk.chunkIndex}`);
      expect(object).not.toBeNull();
      const events = (await object!.json()) as Array<{ type: number; timestamp: number; data: Record<string, unknown> }>;
      expect(events.length).toBe(chunk.eventCount);
      expect(events[0]!.type).toBe(4);
      expect(events[1]!.type).toBe(2);
      expect(JSON.stringify(events).length).toBeLessThan(80_000);
      for (let i = 1; i < events.length; i++) expect(events[i]!.timestamp).toBeGreaterThanOrEqual(events[i - 1]!.timestamp);
    }
    // Every replay has analytics events in its visit (the replay list joins on visit_id).
    const orphan = await count(
      DEMO_DOCS_WEBSITE_ID,
      'SELECT COUNT(*) AS n FROM session_replay r WHERE NOT EXISTS (SELECT 1 FROM website_event e WHERE e.visit_id = r.visit_id)',
    );
    expect(orphan).toBe(0);
  });

  it('cron step generates the hours since the watermark and rebuilds rollups', async () => {
    const first = await runDemoDataGenerator(testEnv, NOW, { maxHoursPerSite: 4 });
    const storeResult = first.websites.find((row) => row.websiteId === PUBLIC_DEMO_WEBSITE_ID)!;
    expect(storeResult.error).toBeUndefined();
    expect(storeResult.hours).toBe(4);
    expect(await count(PUBLIC_DEMO_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM rollup_stats_daily')).toBeGreaterThan(0);
    expect(await count(PUBLIC_DEMO_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM rollup_event_daily')).toBeGreaterThan(0);
    const watermark = Number(await testEnv.CACHE.get(`demo-data:watermark:${PUBLIC_DEMO_WEBSITE_ID}`));
    expect(watermark).toBe(NOW - (NOW % HOUR) - 6 * HOUR + 4 * HOUR);

    // Catch up, then a second tick at the same moment only regenerates the hour in progress.
    await runDemoDataGenerator(testEnv, NOW, { maxHoursPerSite: 12 });
    const events = await count(PUBLIC_DEMO_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM website_event');
    const again = await runDemoDataGenerator(testEnv, NOW, { maxHoursPerSite: 12 });
    expect(again.websites.find((row) => row.websiteId === PUBLIC_DEMO_WEBSITE_ID)!.hours).toBe(1);
    expect(await count(PUBLIC_DEMO_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM website_event')).toBe(events);
    expect(await count(PUBLIC_DEMO_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM website_event WHERE created_at > ?1', NOW)).toBe(0);

    // The 5-minute live tick fills the rest of the hour in progress, up to its own moment.
    const later = NOW + 20 * 60_000;
    const live = await runDemoDataGenerator(testEnv, later, { live: true });
    expect(live.websites.find((row) => row.websiteId === PUBLIC_DEMO_WEBSITE_ID)!.error).toBeUndefined();
    expect(await count(PUBLIC_DEMO_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM website_event')).toBeGreaterThan(events);
    expect(await count(PUBLIC_DEMO_WEBSITE_ID, 'SELECT COUNT(*) AS n FROM website_event WHERE created_at > ?1', later)).toBe(0);

    // Sessions active in the last five minutes appear on the realtime page, as ingest would record them.
    const active = await count(
      PUBLIC_DEMO_WEBSITE_ID,
      'SELECT COUNT(DISTINCT session_id) AS n FROM website_event WHERE created_at >= ?1 AND created_at <= ?2',
      later - 5 * 60_000,
      later,
    );
    expect(active).toBeGreaterThan(0);
    const keys = await testEnv.CACHE.list<{ u?: number }>({ prefix: `rt:${PUBLIC_DEMO_WEBSITE_ID}:s:` });
    expect(keys.keys.filter((key) => key.metadata?.u === later).length).toBe(active);
  });

  it('cron step skips when the store is not in do mode or DEMO_DATA is off', async () => {
    expect(await runDemoDataGenerator({ ...testEnv, EVENT_STORE: 'd1' }, NOW)).toEqual({ skipped: 'store-mode', websites: [] });
    expect(await runDemoDataGenerator({ ...testEnv, EVENT_STORE: 'dual' }, NOW)).toEqual({ skipped: 'store-mode', websites: [] });
    expect(await runDemoDataGenerator({ ...testEnv, DEMO_DATA: 'off' }, NOW)).toEqual({ skipped: 'disabled', websites: [] });
  });

  it('admin endpoint refuses non-admins and non-demo websites', async () => {
    const member = await token(MEMBER_ID, 'user');
    const denied = await fetchWorkerJson('/api/admin/demo/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    });
    expect(denied.response.status).toBe(403);
    const admin = await token(OWNER_ID, 'admin');
    const foreign = await fetchWorkerJson('/api/admin/demo/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true, websiteId: '11111111-1111-4111-8111-111111111111' }),
    });
    expect(foreign.response.status).toBe(400);
    await expect(runDemoBackfill(testEnv, { websiteIds: ['11111111-1111-4111-8111-111111111111'], reset: true })).resolves.toMatchObject({ done: true, websites: [] });
  });

  it('reset wipes old data and backfills in resumable steps', async () => {
    const id = PUBLIC_DEMO_WEBSITE_ID;
    // Leftovers of an older seed: a replay object and an event far outside the generator's ids.
    await testEnv.REPLAY_BUCKET!.put(`${id}/old-visit/0`, '[]');
    await testSiteDb(id).prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type) VALUES ('old-seed-event', ?1, 's', 'v', ?2, '/', 1)`,
    )
      .bind(id, NOW - 40 * DAY)
      .run();

    const steps = [];
    let result = await runDemoBackfill(testEnv, { websiteIds: [id], reset: true, days: 1, now: NOW, maxHours: 8 });
    steps.push(result);
    for (let i = 0; i < 10 && !result.done; i++) {
      result = await runDemoBackfill(testEnv, { websiteIds: [id], reset: true, days: 1, now: NOW, maxHours: 8 });
      steps.push(result);
    }
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0]!.done).toBe(false);
    expect(result.done).toBe(true);
    // `until` only moves forward while the job runs.
    for (let i = 1; i < steps.length; i++) expect(Date.parse(steps[i]!.until)).toBeGreaterThanOrEqual(Date.parse(steps[i - 1]!.until));

    expect(await testEnv.REPLAY_BUCKET!.head(`${id}/old-visit/0`)).toBeNull();
    expect(await count(id, `SELECT COUNT(*) AS n FROM website_event WHERE event_id = 'old-seed-event'`)).toBe(0);
    const oldest = await count(id, 'SELECT MIN(created_at) AS n FROM website_event');
    expect(oldest).toBeGreaterThanOrEqual(NOW - (NOW % HOUR) - DAY);
    expect(await count(id, 'SELECT COUNT(*) AS n FROM website_event')).toBeGreaterThan(1000);
    expect(await count(id, 'SELECT COUNT(*) AS n FROM rollup_stats_daily')).toBeGreaterThan(0);
    // Configuration survived the wipe.
    const experiment = await env.DB.prepare('SELECT status FROM experiment WHERE experiment_id = ?1').bind(experimentId(id)).first<{ status: string }>();
    expect(experiment?.status).toBe('running');
    expect(await env.DB.prepare('SELECT 1 AS ok FROM feature_flag WHERE flag_id = ?1').bind(flagId(id, CHECKOUT_FLAG)).first()).not.toBeNull();

    // The product's own read paths see the data.
    const admin = await token(OWNER_ID, 'admin');
    const headers = { Authorization: `Bearer ${admin}` };
    const range = `startAt=${NOW - DAY - HOUR}&endAt=${NOW}`;
    const errors = await fetchWorkerJson<unknown>(`/api/websites/${id}/errors?${range}`, { headers });
    expect(errors.response.status).toBe(200);
    expect(JSON.stringify(errors.body)).toContain('Cannot read properties');
    const ai = await fetchWorkerJson<unknown>(`/api/websites/${id}/ai-observability?${range}`, { headers });
    expect(ai.response.status).toBe(200);
    expect(JSON.stringify(ai.body)).toContain('claude-');
    const services = await fetchWorkerJson<unknown>(`/api/websites/${id}/logs/services?${range}`, { headers });
    expect(JSON.stringify(services.body)).toContain('checkout-service');
    const replays = await fetchWorkerJson<unknown>(`/api/websites/${id}/replays?${range}`, { headers });
    expect(replays.response.status).toBe(200);
    const results = await fetchWorkerJson<unknown>(`/api/websites/${id}/experiments/${experimentId(id)}/results`, { headers });
    expect(results.response.status).toBe(200);
    expect(JSON.stringify(results.body)).toContain('"test"');
  });
});
