import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE, serializeAiContent } from '@flareboard/shared';
import { getAiEvents, getAiStats, getAiTrace, getAiTraces, getAiUsers } from '../../src/lib/ai-observability';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const BASE = Date.UTC(2026, 0, 5, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NO_OVERRIDES = { overrides: new Map() };

async function insertSession(id: string, distinctId: string | null = null) {
  await testSiteDb(TEST_WEBSITE_ID).prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, TEST_WEBSITE_ID, distinctId, BASE)
    .run();
}

async function insertAiEvent(
  id: string,
  sessionId: string,
  createdAt: number,
  data: Record<string, string | number>,
  eventName = 'ai_generation',
) {
  await testSiteDb(TEST_WEBSITE_ID).prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/chat', ?5, ?6)`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.ai, eventName)
    .run();

  let index = 0;
  for (const [key, value] of Object.entries(data)) {
    const isNumber = typeof value === 'number';
    await testSiteDb(TEST_WEBSITE_ID).prepare(
      `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        `${id}-data-${index++}`,
        TEST_WEBSITE_ID,
        id,
        key,
        isNumber ? null : String(value),
        isNumber ? value : null,
        isNumber ? 2 : 1,
        createdAt,
      )
      .run();
  }
}

describe('AI observability query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('summarizes AI calls by model and returns recent events', async () => {
    await insertSession('ai-session-a');
    await insertSession('ai-session-b');
    await insertAiEvent('ai-1', 'ai-session-a', BASE + 1000, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      costUsd: 0.003,
      latencyMs: 820,
      status: 'success',
      quality: 'good',
      release: '1.0.0',
      environment: 'production',
    });
    await insertAiEvent('ai-2', 'ai-session-b', BASE + 2000, {
      provider: 'anthropic',
      model: 'claude-3.5-sonnet',
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
      costUsd: 0.008,
      latencyMs: 1300,
      status: 'error',
      quality: 'bad',
      release: '1.0.0',
      environment: 'production',
    });

    const [stats, events] = await Promise.all([
      getAiStats(env, TEST_WEBSITE_ID, BASE, BASE + 3000),
      getAiEvents(env, TEST_WEBSITE_ID, BASE, BASE + 3000),
    ]);

    expect(stats).toMatchObject({
      unit: 'hour',
      calls: 2,
      sessions: 2,
      users: 2,
      traces: 2,
      tokens: 420,
      inputTokens: 300,
      outputTokens: 120,
      errors: 1,
      errorRate: 50,
      unpricedCalls: 0,
      avgLatencyMs: 1060,
      p50LatencyMs: 820,
      p95LatencyMs: 1300,
    });
    expect(stats.costUsd).toBeCloseTo(0.011, 10);
    expect(stats.models.map((row) => [row.model, row.calls, row.tokens, row.errors, row.errorRate, row.avgLatencyMs])).toEqual([
      ['claude-3.5-sonnet', 1, 280, 1, 100, 1300],
      ['gpt-4.1-mini', 1, 140, 0, 0, 820],
    ]);
    expect(stats.models[0]).toMatchObject({ provider: 'anthropic', costUsd: 0.008 });
    expect(stats.statuses).toEqual([
      { status: 'error', calls: 1 },
      { status: 'success', calls: 1 },
    ]);
    expect(stats.providers.map((row) => [row.provider, row.calls, row.costUsd, row.errors])).toEqual([
      ['anthropic', 1, 0.008, 1],
      ['openai', 1, 0.003, 0],
    ]);
    expect(stats.qualities).toEqual([
      { quality: 'bad', calls: 1 },
      { quality: 'good', calls: 1 },
    ]);
    expect(stats.releases).toEqual([{ release: '1.0.0', calls: 2, costUsd: 0.011, errors: 1 }]);
    expect(stats.environments).toEqual([{ environment: 'production', calls: 2, costUsd: 0.011, errors: 1 }]);
    expect(stats.trend).toHaveLength(1);
    expect(stats.trend[0]).toMatchObject({
      date: '2026-01-05T12:00:00Z',
      calls: 2,
      sessions: 2,
      tokens: 420,
      errors: 1,
      avgLatencyMs: 1060,
      p50LatencyMs: 820,
      p95LatencyMs: 1300,
    });
    expect(events.map((event) => ({ model: event.model, status: event.status, costSource: event.costSource }))).toEqual([
      { model: 'claude-3.5-sonnet', status: 'error', costSource: 'reported' },
      { model: 'gpt-4.1-mini', status: 'success', costSource: 'reported' },
    ]);

    const filters = {
      model: 'claude-3.5-sonnet',
      status: 'error',
      provider: 'anthropic',
      quality: 'bad',
      release: '1.0.0',
      environment: 'production',
    };
    const [filteredStats, filteredEvents] = await Promise.all([
      getAiStats(env, TEST_WEBSITE_ID, BASE, BASE + 3000, filters),
      getAiEvents(env, TEST_WEBSITE_ID, BASE, BASE + 3000, filters),
    ]);
    expect(filteredStats).toMatchObject({ calls: 1, errors: 1, costUsd: 0.008 });
    expect(filteredStats.releases).toEqual([{ release: '1.0.0', calls: 1, costUsd: 0.008, errors: 1 }]);
    expect(filteredEvents.map((event) => event.model)).toEqual(['claude-3.5-sonnet']);
  });

  it('returns a daily trend in the website timezone for multi-day ranges', async () => {
    const later = BASE + DAY * 2;
    await insertSession('ai-trend-session-a');
    await insertSession('ai-trend-session-b');
    await insertAiEvent('ai-trend-1', 'ai-trend-session-a', later + 1000, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      totalTokens: 100,
      costUsd: 0.002,
      latencyMs: 500,
    });
    await insertAiEvent('ai-trend-2', 'ai-trend-session-b', later + DAY + 1000, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      totalTokens: 150,
      costUsd: 0.004,
      latencyMs: 900,
      status: 'error',
    });

    const utc = await getAiStats(env, TEST_WEBSITE_ID, later - DAY, later + DAY * 2, {}, NO_OVERRIDES);
    expect(utc.unit).toBe('day');
    expect(utc.trend.map((row) => [row.date, row.calls, row.errors, row.p95LatencyMs])).toEqual([
      ['2026-01-07', 1, 0, 500],
      ['2026-01-08', 1, 1, 900],
    ]);
    // 12:00 UTC is already 02:00 the next day in Kiritimati (UTC+14).
    const ahead = await getAiStats(env, TEST_WEBSITE_ID, later - DAY, later + DAY * 2, {}, { ...NO_OVERRIDES, timezone: 'Pacific/Kiritimati' });
    expect(ahead.trend.map((row) => row.date)).toEqual(['2026-01-08', '2026-01-09']);
  });

  it('prices calls without a reported cost from the table, overrides, or marks them unpriced', async () => {
    const at = BASE + DAY * 10;
    await insertSession('ai-price-session');
    await insertAiEvent('ai-price-openai', 'ai-price-session', at + 1000, {
      provider: 'openai',
      model: 'gpt-4o-2024-08-06',
      inputTokens: 1000,
      cacheReadTokens: 200,
      outputTokens: 100,
    });
    await insertAiEvent('ai-price-anthropic', 'ai-price-session', at + 2000, {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 1000,
      cacheReadTokens: 5000,
      cacheWriteTokens: 2000,
      outputTokens: 100,
    });
    await insertAiEvent('ai-price-custom', 'ai-price-session', at + 3000, {
      model: 'my-finetune',
      inputTokens: 100,
      outputTokens: 10,
    });

    const openAi = (800 * 2.5 + 200 * 1.25 + 100 * 10) / 1e6;
    const anthropic = (1000 * 3 + 5000 * 0.3 + 2000 * 3.75 + 100 * 15) / 1e6;
    const stats = await getAiStats(env, TEST_WEBSITE_ID, at, at + 4000, {}, NO_OVERRIDES);
    expect(stats.unpricedCalls).toBe(1);
    expect(stats.costUsd).toBeCloseTo(openAi + anthropic, 12);
    const byModel = Object.fromEntries(stats.models.map((row) => [row.model, row]));
    expect(byModel['gpt-4o-2024-08-06']).toMatchObject({ priceSource: 'builtin', unpricedCalls: 0 });
    expect(byModel['my-finetune']).toMatchObject({ priceSource: null, unpricedCalls: 1, costUsd: 0 });

    const events = await getAiEvents(env, TEST_WEBSITE_ID, at, at + 4000, {}, 10, NO_OVERRIDES);
    expect(events.find((event) => event.id === 'ai-price-custom')).toMatchObject({ costUsd: null, costSource: null });
    expect(events.find((event) => event.id === 'ai-price-openai')!.costUsd).toBeCloseTo(openAi, 12);

    const overridden = await getAiStats(env, TEST_WEBSITE_ID, at, at + 4000, {}, {
      overrides: new Map([['my-finetune', { input: 1, output: 2 }], ['gpt-4o', { input: 10, output: 10 }]]),
    });
    expect(overridden.unpricedCalls).toBe(0);
    expect(overridden.costUsd).toBeCloseTo((100 * 1 + 10 * 2) / 1e6 + (800 * 10 + 200 * 10 + 100 * 10) / 1e6 + anthropic, 12);
  });

  it('computes latency percentiles by nearest rank', async () => {
    const at = BASE + DAY * 12;
    await insertSession('ai-latency-session');
    for (let i = 1; i <= 10; i++) {
      await insertAiEvent(`ai-latency-${i}`, 'ai-latency-session', at + i * 1000, { model: 'gpt-4o', latencyMs: i * 100, costUsd: 0 });
    }
    const stats = await getAiStats(env, TEST_WEBSITE_ID, at, at + 20_000, {}, NO_OVERRIDES);
    expect(stats).toMatchObject({ calls: 10, p50LatencyMs: 500, p95LatencyMs: 1000, avgLatencyMs: 550 });
  });

  describe('traces and users', () => {
    const at = BASE + DAY * 20;
    const TRACE = 'trace-support-bot';

    beforeAll(async () => {
      await insertSession('ai-user-alice', 'alice');
      await insertSession('ai-user-anon');
      // trace → retriever span → generation; plus a failed generation straight under the trace.
      await insertAiEvent('tr-root', 'ai-user-alice', at + 3000, {
        aiKind: 'trace',
        traceId: TRACE,
        spanId: TRACE,
        spanName: 'support-bot',
        latencyMs: 2900,
        aiInput: '{"question":"refund?"}',
        aiOutput: '{"answer":"yes"}',
      }, '$ai_trace');
      await insertAiEvent('tr-span', 'ai-user-alice', at + 1000, {
        aiKind: 'span',
        traceId: TRACE,
        spanId: 'retrieve',
        parentSpanId: TRACE,
        spanName: 'retriever',
        latencyMs: 800,
      }, '$ai_span');
      await insertAiEvent('tr-gen-1', 'ai-user-alice', at + 900, {
        aiKind: 'generation',
        traceId: TRACE,
        spanId: 'gen-embed',
        parentSpanId: 'retrieve',
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 0,
        latencyMs: 300,
        aiInput: serializeAiContent('x'.repeat(40_000))!,
      }, '$ai_generation');
      await insertAiEvent('tr-gen-2', 'ai-user-alice', at + 2800, {
        aiKind: 'generation',
        traceId: TRACE,
        spanId: 'gen-answer',
        parentSpanId: TRACE,
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 2000,
        outputTokens: 500,
        latencyMs: 1500,
        status: 'error',
        httpStatus: 500,
        aiError: 'upstream failed',
        aiOutput: '[{"role":"assistant","content":"partial"}]',
        conversation_id: 'conv-1',
      }, '$ai_generation');
      // A lone call without a trace id is a trace of its own.
      await insertAiEvent('lone-call', 'ai-user-anon', at + 5000, {
        provider: 'openai',
        model: 'gpt-4o-mini',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.5,
        latencyMs: 200,
      });
    });

    const traceCost = (1000 * 2.5 + (2000 * 2.5 + 500 * 10)) / 1e6;

    it('lists traces with totals and filters', async () => {
      const { traces, total } = await getAiTraces(env, TEST_WEBSITE_ID, at, at + 10_000, {}, 100, NO_OVERRIDES);
      expect(total).toBe(2);
      expect(traces.map((trace) => trace.traceId)).toEqual(['lone-call', TRACE]);
      const support = traces[1]!;
      expect(support).toMatchObject({
        name: 'support-bot',
        generations: 2,
        spans: 1,
        errors: 1,
        tokens: 3500,
        models: ['gpt-4o'],
        distinctId: 'alice',
        startedAt: at + 100,
        lastAt: at + 3000,
        latencyMs: 2900,
      });
      expect(support.costUsd).toBeCloseTo(traceCost, 12);
      expect(traces[0]).toMatchObject({ name: 'gpt-4o-mini', generations: 1, costUsd: 0.5, distinctId: null });

      const list = (filters: Parameters<typeof getAiTraces>[4]) =>
        getAiTraces(env, TEST_WEBSITE_ID, at, at + 10_000, filters, 100, NO_OVERRIDES).then((result) =>
          result.traces.map((trace) => trace.traceId),
        );
      expect(await list({ error: true })).toEqual([TRACE]);
      expect(await list({ error: false })).toEqual(['lone-call']);
      expect(await list({ minCostUsd: 0.1 })).toEqual(['lone-call']);
      expect(await list({ maxCostUsd: 0.1 })).toEqual([TRACE]);
      expect(await list({ distinctId: 'alice' })).toEqual([TRACE]);
      expect(await list({ model: 'gpt-4o-mini' })).toEqual(['lone-call']);
    });

    it('builds the trace tree with timings, costs and content', async () => {
      const trace = (await getAiTrace(env, TEST_WEBSITE_ID, TRACE, at - DAY, at + DAY, NO_OVERRIDES))!;
      expect(trace).toMatchObject({ traceId: TRACE, name: 'support-bot', distinctId: 'alice', generations: 2, errors: 1, tokens: 3500 });
      expect(trace.costUsd).toBeCloseTo(traceCost, 12);
      const root = trace.tree;
      expect(root.event?.id).toBe('tr-root');
      expect(root.event?.input).toBe('{"question":"refund?"}');
      expect(root.children.map((child) => child.event?.id)).toEqual(['tr-span', 'tr-gen-2']);
      const span = root.children[0]!;
      expect(span).toMatchObject({ depth: 1, startMs: at + 200, endMs: at + 1000 });
      expect(span.children.map((child) => child.event?.id)).toEqual(['tr-gen-1']);
      const embed = span.children[0]!.event!;
      expect(embed).toMatchObject({ name: 'gpt-4o', inputTruncated: true, costSource: 'builtin', startMs: at + 600, endMs: at + 900 });
      const answer = root.children[1]!.event!;
      expect(answer).toMatchObject({
        isError: true,
        error: 'upstream failed',
        httpStatus: 500,
        output: '[{"role":"assistant","content":"partial"}]',
        properties: { conversation_id: 'conv-1' },
      });
      expect(root).toMatchObject({ startMs: at + 100, endMs: at + 3000 });

      const lone = (await getAiTrace(env, TEST_WEBSITE_ID, 'lone-call', at - DAY, at + DAY, NO_OVERRIDES))!;
      expect(lone.tree.event).toBeNull();
      expect(lone.tree.children.map((child) => child.event?.id)).toEqual(['lone-call']);
      expect(lone.costUsd).toBe(0.5);

      expect(await getAiTrace(env, TEST_WEBSITE_ID, 'missing', at - DAY, at + DAY, NO_OVERRIDES)).toBeNull();
    });

    it('aggregates cost per user', async () => {
      const { users } = await getAiUsers(env, TEST_WEBSITE_ID, at, at + 10_000, {}, 100, NO_OVERRIDES);
      expect(users.map((user) => [user.distinctId, user.calls, user.traces, user.errors])).toEqual([
        [null, 1, 1, 0],
        ['alice', 2, 1, 1],
      ]);
      expect(users[0]).toMatchObject({ sessionId: 'ai-user-anon', costUsd: 0.5, models: ['gpt-4o-mini'] });
      expect(users[1]!.costUsd).toBeCloseTo(traceCost, 12);
    });

    it('counts only generations and embeddings as calls', async () => {
      const stats = await getAiStats(env, TEST_WEBSITE_ID, at, at + 10_000, {}, NO_OVERRIDES);
      expect(stats).toMatchObject({ calls: 3, traces: 2, users: 2, errors: 1 });
    });
  });
});
