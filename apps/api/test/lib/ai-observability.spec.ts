import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@flareboard/shared';
import { getAiEvents, getAiStats } from '../../src/lib/ai-observability';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 5, 12);
const DAY = 24 * 60 * 60 * 1000;

async function insertSession(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO session (session_id, website_id, created_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(id, TEST_WEBSITE_ID, BASE)
    .run();
}

async function insertAiEvent(
  id: string,
  sessionId: string,
  createdAt: number,
  data: Record<string, string | number>,
) {
  await env.DB.prepare(
    `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
     VALUES (?1, ?2, ?3, ?3, ?4, '/chat', ?5, 'ai_generation')`,
  )
    .bind(id, TEST_WEBSITE_ID, sessionId, createdAt, EVENT_TYPE.ai)
    .run();

  let index = 0;
  for (const [key, value] of Object.entries(data)) {
    const isNumber = typeof value === 'number';
    await env.DB.prepare(
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

    expect(stats).toEqual({
      calls: 2,
      sessions: 2,
      tokens: 420,
      costUsd: 0.011,
      errors: 1,
      avgLatencyMs: 1060,
      models: [
        {
          model: 'claude-3.5-sonnet',
          calls: 1,
          tokens: 280,
          costUsd: 0.008,
          errors: 1,
          avgLatencyMs: 1300,
          errorRate: 100,
        },
        {
          model: 'gpt-4.1-mini',
          calls: 1,
          tokens: 140,
          costUsd: 0.003,
          errors: 0,
          avgLatencyMs: 820,
          errorRate: 0,
        },
      ],
      statuses: [
        { status: 'error', calls: 1 },
        { status: 'success', calls: 1 },
      ],
      providers: [
        { provider: 'anthropic', calls: 1, costUsd: 0.008, errors: 1 },
        { provider: 'openai', calls: 1, costUsd: 0.003, errors: 0 },
      ],
      qualities: [
        { quality: 'bad', calls: 1 },
        { quality: 'good', calls: 1 },
      ],
      releases: [{ release: '1.0.0', calls: 2, costUsd: 0.011, errors: 1 }],
      environments: [{ environment: 'production', calls: 2, costUsd: 0.011, errors: 1 }],
      trend: [
        {
          date: '2026-01-05',
          calls: 2,
          sessions: 2,
          tokens: 420,
          costUsd: 0.011,
          errors: 1,
          avgLatencyMs: 1060,
        },
      ],
    });
    expect(events.map((event) => ({ model: event.model, status: event.status }))).toEqual([
      { model: 'claude-3.5-sonnet', status: 'error' },
      { model: 'gpt-4.1-mini', status: 'success' },
    ]);

    const [filteredStats, filteredEvents] = await Promise.all([
      getAiStats(env, TEST_WEBSITE_ID, BASE, BASE + 3000, {
        model: 'claude-3.5-sonnet',
        status: 'error',
        provider: 'anthropic',
        quality: 'bad',
        release: '1.0.0',
        environment: 'production',
      }),
      getAiEvents(env, TEST_WEBSITE_ID, BASE, BASE + 3000, {
        model: 'claude-3.5-sonnet',
        status: 'error',
        provider: 'anthropic',
        quality: 'bad',
        release: '1.0.0',
        environment: 'production',
      }),
    ]);
    expect(filteredStats.calls).toBe(1);
    expect(filteredStats.errors).toBe(1);
    expect(filteredStats.providers).toEqual([{ provider: 'anthropic', calls: 1, costUsd: 0.008, errors: 1 }]);
    expect(filteredStats.qualities).toEqual([{ quality: 'bad', calls: 1 }]);
    expect(filteredStats.releases).toEqual([{ release: '1.0.0', calls: 1, costUsd: 0.008, errors: 1 }]);
    expect(filteredStats.environments).toEqual([{ environment: 'production', calls: 1, costUsd: 0.008, errors: 1 }]);
    expect(filteredStats.trend).toEqual([
      {
        date: '2026-01-05',
        calls: 1,
        sessions: 1,
        tokens: 280,
        costUsd: 0.008,
        errors: 1,
        avgLatencyMs: 1300,
      },
    ]);
    expect(filteredEvents.map((event) => event.model)).toEqual(['claude-3.5-sonnet']);
  });

  it('returns daily AI trend for multi-day ranges', async () => {
    const later = BASE + DAY * 2;

    await insertSession('ai-trend-session-a');
    await insertSession('ai-trend-session-b');
    await insertAiEvent('ai-trend-1', 'ai-trend-session-a', later + 1000, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      totalTokens: 100,
      costUsd: 0.002,
      latencyMs: 500,
      status: 'success',
      release: '1.1.0',
      environment: 'production',
    });
    await insertAiEvent('ai-trend-2', 'ai-trend-session-b', later + DAY + 1000, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      totalTokens: 150,
      costUsd: 0.004,
      latencyMs: 900,
      status: 'error',
      release: '1.1.0',
      environment: 'production',
    });

    const stats = await getAiStats(env, TEST_WEBSITE_ID, later, later + DAY + 2000);

    expect(stats.trend).toEqual([
      {
        date: '2026-01-07',
        calls: 1,
        sessions: 1,
        tokens: 100,
        costUsd: 0.002,
        errors: 0,
        avgLatencyMs: 500,
      },
      {
        date: '2026-01-08',
        calls: 1,
        sessions: 1,
        tokens: 150,
        costUsd: 0.004,
        errors: 1,
        avgLatencyMs: 900,
      },
    ]);
  });

  it('filters AI calls by release and environment', async () => {
    const later = BASE + DAY * 5;

    await insertSession('ai-release-session-a');
    await insertSession('ai-release-session-b');
    await insertSession('ai-release-session-c');
    await insertAiEvent('ai-release-1', 'ai-release-session-a', later + 1000, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      totalTokens: 120,
      costUsd: 0.003,
      latencyMs: 600,
      status: 'success',
      quality: 'good',
      release: '2.0.0',
      environment: 'production',
    });
    await insertAiEvent('ai-release-2', 'ai-release-session-b', later + 2000, {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      totalTokens: 80,
      costUsd: 0.002,
      latencyMs: 450,
      status: 'success',
      quality: 'good',
      release: '2.0.0',
      environment: 'preview',
    });
    await insertAiEvent('ai-release-3', 'ai-release-session-c', later + 3000, {
      provider: 'anthropic',
      model: 'claude-3.5-sonnet',
      totalTokens: 200,
      costUsd: 0.007,
      latencyMs: 1100,
      status: 'error',
      quality: 'bad',
      release: '1.9.0',
      environment: 'production',
    });

    const filters = { release: '2.0.0', environment: 'production' };
    const [stats, events] = await Promise.all([
      getAiStats(env, TEST_WEBSITE_ID, later, later + 4000, filters),
      getAiEvents(env, TEST_WEBSITE_ID, later, later + 4000, filters),
    ]);

    expect(stats.calls).toBe(1);
    expect(stats.tokens).toBe(120);
    expect(stats.releases).toEqual([{ release: '2.0.0', calls: 1, costUsd: 0.003, errors: 0 }]);
    expect(stats.environments).toEqual([{ environment: 'production', calls: 1, costUsd: 0.003, errors: 0 }]);
    expect(events.map((event) => ({ release: event.release, environment: event.environment }))).toEqual([
      { release: '2.0.0', environment: 'production' },
    ]);
  });
});
