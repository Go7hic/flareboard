import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { seedBrowserLog, seedOtlpLog, seedSpan } from '../helpers/otel-seed';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 7, 20, 8);
const TRACE = '3c4d5e6f708192a3b4c5d6e7f8091a2b';

async function headers() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function get<T>(path: string) {
  return fetchWorkerJson<T>(`/api/websites/${TEST_WEBSITE_ID}${path}`, { headers: await headers() });
}

type ListBody = {
  logs: Array<{ id: string; source: string; level: string; attributes: Record<string, unknown> | null }>;
  nextBefore: string | null;
  otlpEnabled: boolean;
  stats: { logs: number; services: Array<{ service: string; logs: number }> };
};

describe('logs explorer routes', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await seedOtlpLog(TEST_WEBSITE_ID, {
      id: 'route-otlp-1',
      at: BASE + 1000,
      severity: 'error',
      body: 'db timeout',
      service: 'orders',
      traceId: TRACE,
      attributes: { 'db.system': 'postgres', attempt: 3 },
    });
    await seedOtlpLog(TEST_WEBSITE_ID, { id: 'route-otlp-2', at: BASE + 2000, severity: 'info', body: 'order placed', service: 'orders' });
    await seedBrowserLog(TEST_WEBSITE_ID, { id: 'route-browser-1', at: BASE + 3000, level: 'fatal', message: 'white screen' });
    await seedSpan(TEST_WEBSITE_ID, { traceId: TRACE, spanId: 'e0e0e0e0e0e0e0e1', name: 'POST /orders', service: 'orders', startMs: BASE + 900, durationMs: 400, status: 'error' });
  });

  const range = `startAt=${BASE}&endAt=${BASE + 60_000}`;

  it('lists, filters and pages logs', async () => {
    const all = await get<ListBody>(`/logs?${range}`);
    expect(all.response.status).toBe(200);
    expect(all.body.otlpEnabled).toBe(true);
    expect(all.body.logs.map((row) => row.id)).toEqual(['route-browser-1', 'route-otlp-2', 'route-otlp-1']);
    expect(all.body.stats.services).toEqual([{ service: 'orders', logs: 2 }]);
    expect(all.body.nextBefore).toBeNull();

    const severe = await get<ListBody>(`/logs?${range}&level=error,fatal`);
    expect(severe.body.logs.map((row) => row.id)).toEqual(['route-browser-1', 'route-otlp-1']);

    const attr = await get<ListBody>(`/logs?${range}&attr=${encodeURIComponent('db.system=postgres')}&attr=attempt=3`);
    expect(attr.body.logs.map((row) => row.id)).toEqual(['route-otlp-1']);
    expect(attr.body.logs[0]!.attributes).toEqual({ 'db.system': 'postgres', attempt: 3 });

    const otlpOnly = await get<ListBody>(`/logs?${range}&source=otlp&service=orders&q=order`);
    expect(otlpOnly.body.logs.map((row) => row.id)).toEqual(['route-otlp-2']);

    const page = await get<ListBody>(`/logs?${range}&limit=2`);
    expect(page.body.logs).toHaveLength(2);
    expect(page.body.nextBefore).toMatch(/^\d+:route-otlp-2$/);
    const rest = await get<ListBody>(`/logs?${range}&limit=2&before=${encodeURIComponent(page.body.nextBefore!)}`);
    expect(rest.body.logs.map((row) => row.id)).toEqual(['route-otlp-1']);
  });

  it('returns the severity histogram', async () => {
    const result = await get<{ bucketMs: number; buckets: Array<{ t: number; total: number; error: number; fatal: number }> }>(
      `/logs/histogram?${range}`,
    );
    expect(result.response.status).toBe(200);
    expect(result.body.bucketMs).toBe(1000);
    expect(result.body.buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(3);
    expect(result.body.buckets.find((bucket) => bucket.t === BASE + 3000)).toMatchObject({ fatal: 1, total: 1 });
  });

  it('tails with an insertion-order cursor', async () => {
    const opened = await get<{ seq: string; logs: Array<{ id: string }> }>(`/logs/tail?limit=500`);
    expect(opened.body.seq).toMatch(/^\d+\.\d+$/);
    await seedOtlpLog(TEST_WEBSITE_ID, { id: 'route-tail-late', at: BASE - 5000, body: 'late line', service: 'orders' });
    const polled = await get<{ seq: string; logs: Array<{ id: string }> }>(`/logs/tail?seq=${opened.body.seq}`);
    expect(polled.body.logs.map((row) => row.id)).toEqual(['route-tail-late']);
  });

  it('lists traces and returns the waterfall with the trace logs', async () => {
    const traces = await get<{ traces: Array<{ traceId: string; rootName: string; hasError: boolean }> }>(
      `/logs/traces?${range}&status=error`,
    );
    expect(traces.body.traces).toEqual([expect.objectContaining({ traceId: TRACE, rootName: 'POST /orders', hasError: true })]);

    const detail = await get<{ spans: Array<{ spanId: string }>; logs: Array<{ id: string }> }>(`/logs/traces/${TRACE}`);
    expect(detail.response.status).toBe(200);
    expect(detail.body.spans.map((span) => span.spanId)).toEqual(['e0e0e0e0e0e0e0e1']);
    expect(detail.body.logs.map((row) => row.id)).toEqual(['route-otlp-1']);
  });

  it('saves filters with attributes and alert rules with an attribute match', async () => {
    const filter = await fetchWorkerJson<{ filters: Record<string, unknown> }>(`/api/websites/${TEST_WEBSITE_ID}/logs/filters`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        name: 'Postgres errors',
        filters: { level: 'error', source: 'otlp', attributes: [{ key: 'db.system', value: 'postgres' }] },
      }),
    });
    expect(filter.response.status).toBe(201);
    expect(filter.body.filters).toEqual({ level: 'error', source: 'otlp', attributes: [{ key: 'db.system', value: 'postgres' }] });

    const rule = await fetchWorkerJson<{ attributeKey: string | null; attributeValue: string | null }>(
      `/api/websites/${TEST_WEBSITE_ID}/logs/alerts`,
      {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ name: 'DB', threshold: 5, windowMinutes: 10, attributeKey: 'db.system', attributeValue: 'postgres' }),
      },
    );
    expect(rule.response.status).toBe(201);
    expect(rule.body).toMatchObject({ attributeKey: 'db.system', attributeValue: 'postgres' });
  });
});
