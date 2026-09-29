import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, EVENT_TYPE, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const OWNER_ID = 'llm-routes-owner';
const NOW = Date.now();

async function headers() {
  const token = await createSecureToken({ userId: OWNER_ID, role: ROLES.user }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type Settings = {
  captureContent: boolean;
  priceOverrides: Array<{ model: string; inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion: number | null }>;
  builtInPrices: Array<{ model: string }>;
  pricesReviewedAt: string;
};

async function seedCall(websiteId: string, id: string, createdAt: number, data: Record<string, string | number>) {
  const db = testSiteDb(websiteId);
  await db
    .prepare(`INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, created_at) VALUES ('llm-s1', ?1, 'dana', ?2)`)
    .bind(websiteId, createdAt)
    .run();
  await db
    .prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, 'llm-s1', 'llm-s1', ?3, '/', ?4, '$ai_generation')`,
    )
    .bind(id, websiteId, createdAt, EVENT_TYPE.ai)
    .run();
  let i = 0;
  for (const [key, value] of Object.entries(data)) {
    const isNumber = typeof value === 'number';
    await db
      .prepare(
        `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(`${id}-${i++}`, websiteId, id, key, isNumber ? null : value, isNumber ? value : null, isNumber ? 2 : 1, createdAt)
      .run();
  }
}

describe('LLM analytics routes', () => {
  let websiteId = '';

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'llm-routes-owner', 'hash', ?2, ?3, ?3)`,
    )
      .bind(OWNER_ID, ROLES.user, NOW)
      .run();
    const created = await fetchWorkerJson<{ id: string }>('/api/websites', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ name: 'LLM app', domain: 'llm-app.example' }),
    });
    websiteId = created.body.id;
    await seedCall(websiteId, 'llm-call-1', NOW - 60_000, {
      aiKind: 'generation',
      traceId: 'trace-route-1',
      model: 'acme-large',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      latencyMs: 1200,
    });
  });

  it('reads default settings with the built-in price table', async () => {
    const { response, body } = await fetchWorkerJson<Settings>(`/api/websites/${websiteId}/ai-observability/settings`, {
      headers: await headers(),
    });
    expect(response.status).toBe(200);
    expect(body.captureContent).toBe(true);
    expect(body.priceOverrides).toEqual([]);
    expect(body.pricesReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.builtInPrices.some((price) => price.model === 'gpt-4o')).toBe(true);
  });

  it('turns content capture off and clears the ingest cache', async () => {
    await env.CACHE.put(`llm-settings:${websiteId}`, '{"captureContent":true}');
    const { response, body } = await fetchWorkerJson<Settings>(`/api/websites/${websiteId}/ai-observability/settings`, {
      method: 'PUT',
      headers: await headers(),
      body: JSON.stringify({ captureContent: false }),
    });
    expect(response.status).toBe(200);
    expect(body.captureContent).toBe(false);
    expect(await env.CACHE.get(`llm-settings:${websiteId}`)).toBeNull();
    const row = await env.DB.prepare(`SELECT capture_content AS v FROM llm_website_setting WHERE website_id = ?1`)
      .bind(websiteId)
      .first<{ v: number }>();
    expect(row?.v).toBe(0);
  });

  it('rejects invalid settings', async () => {
    for (const body of [{ captureContent: 'no' }, { priceOverrides: [{ model: 'x', inputPerMillion: -1, outputPerMillion: 1 }] }, { other: 1 }]) {
      const { response } = await fetchWorkerJson(`/api/websites/${websiteId}/ai-observability/settings`, {
        method: 'PUT',
        headers: await headers(),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it('prices an unknown model once the website overrides it', async () => {
    const range = `startAt=${NOW - 3_600_000}&endAt=${NOW}`;
    const before = await fetchWorkerJson<{ stats: { costUsd: number; unpricedCalls: number } }>(
      `/api/websites/${websiteId}/ai-observability?${range}`,
      { headers: await headers() },
    );
    expect(before.body.stats).toMatchObject({ costUsd: 0, unpricedCalls: 1 });

    const saved = await fetchWorkerJson<Settings>(`/api/websites/${websiteId}/ai-observability/settings`, {
      method: 'PUT',
      headers: await headers(),
      body: JSON.stringify({ priceOverrides: [{ model: 'Acme-Large-2026-01-01', inputPerMillion: 2, outputPerMillion: 8 }] }),
    });
    expect(saved.body.priceOverrides).toEqual([
      { model: 'acme-large-2026-01-01', inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: null, cacheWritePerMillion: null },
    ]);
    // Dated override ids match only that snapshot; an undated one covers every snapshot.
    await fetchWorkerJson<Settings>(`/api/websites/${websiteId}/ai-observability/settings`, {
      method: 'PUT',
      headers: await headers(),
      body: JSON.stringify({ priceOverrides: [{ model: 'acme-large', inputPerMillion: 2, outputPerMillion: 8 }] }),
    });

    const after = await fetchWorkerJson<{ stats: { costUsd: number; unpricedCalls: number } }>(
      `/api/websites/${websiteId}/ai-observability?${range}`,
      { headers: await headers() },
    );
    expect(after.body.stats).toMatchObject({ costUsd: 2 + 4, unpricedCalls: 0 });

    const traces = await fetchWorkerJson<{ traces: Array<{ traceId: string; costUsd: number }> }>(
      `/api/websites/${websiteId}/ai-observability/traces?${range}&minCost=5`,
      { headers: await headers() },
    );
    expect(traces.body.traces.map((trace) => [trace.traceId, trace.costUsd])).toEqual([['trace-route-1', 6]]);

    const detail = await fetchWorkerJson<{ traceId: string; costUsd: number; tree: { children: unknown[] } }>(
      `/api/websites/${websiteId}/ai-observability/traces/trace-route-1?at=${NOW - 60_000}`,
      { headers: await headers() },
    );
    expect(detail.response.status).toBe(200);
    expect(detail.body).toMatchObject({ traceId: 'trace-route-1', costUsd: 6 });
    expect(detail.body.tree.children).toHaveLength(1);

    const users = await fetchWorkerJson<{ users: Array<{ distinctId: string; costUsd: number }> }>(
      `/api/websites/${websiteId}/ai-observability/users?${range}`,
      { headers: await headers() },
    );
    expect(users.body.users).toMatchObject([{ distinctId: 'dana', costUsd: 6 }]);
  });

  it('returns 404 for unknown traces and other people’s websites', async () => {
    const missing = await fetchWorkerJson(`/api/websites/${websiteId}/ai-observability/traces/nope`, { headers: await headers() });
    expect(missing.response.status).toBe(404);
    const foreign = await fetchWorkerJson(
      `/api/websites/00000000-0000-0000-0000-00000000dead/ai-observability/settings`,
      { method: 'PUT', headers: await headers(), body: JSON.stringify({ captureContent: false }) },
    );
    expect(foreign.response.status).toBe(404);
  });
});
