import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { FIXTURE_SITE, RANGE, seedInsightFixture } from '../helpers/insight-fixture';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const range = `startAt=${RANGE.startAt}&endAt=${RANGE.endAt}`;
const PRO = [{ type: 'person', key: 'plan', operator: 'is', value: ['pro'] }];

async function headers() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function createSignupInsight(name = 'Signups') {
  const created = await fetchWorkerJson<{ id: string }>('/api/insights', {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({
      websiteId: FIXTURE_SITE,
      name,
      type: 'trend',
      query: { version: 2, interval: 'day', series: [{ kind: 'event', event: 'signup', math: 'total' }] },
    }),
  });
  expect(created.response.status).toBe(201);
  return created.body.id;
}

async function createBoard(parameters: Record<string, unknown>) {
  return fetchWorkerJson<{ id: string; parameters: Record<string, unknown>; message?: string }>('/api/boards', {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ name: 'Growth', parameters }),
  });
}

type RunBody = {
  filters: unknown[];
  widgets: Array<{ type: string; error?: string; result?: { kind: string; results?: Array<{ total: number }> } }>;
};

describe('board filters and layout', () => {
  beforeAll(seedInsightFixture);

  it('rejects invalid board filters and range presets', async () => {
    const badFilter = await createBoard({ filters: [{ type: 'dimension', key: 'nope', operator: 'is', value: ['x'] }] });
    expect(badFilter.response.status).toBe(400);
    const badRange = await createBoard({ rangePreset: '5y' });
    expect(badRange.response.status).toBe(400);
  });

  it('merges saved board filters into every insight widget, and lets the URL override them', async () => {
    const insightId = await createSignupInsight();
    const board = await createBoard({
      rangePreset: '30d',
      filters: PRO,
      widgets: [
        { type: 'insight', insightId, width: 'large' },
        { type: 'insight', insightId, width: 'small' },
      ],
    });
    expect(board.response.status).toBe(201);

    const saved = await fetchWorkerJson<RunBody>(`/api/boards/${board.body.id}/run?${range}`, { headers: await headers() });
    expect(saved.response.status).toBe(200);
    expect(saved.body.filters).toEqual(PRO);
    // Signups by pro people (alice twice, carol once) out of six.
    expect(saved.body.widgets.map((w) => w.result?.results?.[0]?.total)).toEqual([3, 3]);

    const none = await fetchWorkerJson<RunBody>(`/api/boards/${board.body.id}/run?${range}&filters=${encodeURIComponent('[]')}`, {
      headers: await headers(),
    });
    expect(none.body.widgets[0]?.result?.results?.[0]?.total).toBe(6);

    const germany = encodeURIComponent(JSON.stringify([{ type: 'dimension', key: 'country', operator: 'is', value: ['DE'] }]));
    const de = await fetchWorkerJson<RunBody>(`/api/boards/${board.body.id}/run?${range}&filters=${germany}`, {
      headers: await headers(),
    });
    expect(de.body.widgets[0]?.result?.results?.[0]?.total).toBe(1);

    const invalid = await fetchWorker(`/api/boards/${board.body.id}/run?${range}&filters=notjson`, { headers: await headers() });
    expect(invalid.status).toBe(400);

    // Reordered / resized layout is saved as part of the parameters.
    const reordered = await fetchWorkerJson<{ parameters: { widgets: Array<{ width: string }> } }>(`/api/boards/${board.body.id}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({
        parameters: {
          rangePreset: '7d',
          filters: [],
          widgets: [
            { type: 'insight', insightId, width: 'full' },
            { type: 'insight', insightId, width: 'medium' },
          ],
        },
      }),
    });
    expect(reordered.response.status).toBe(200);
    expect(reordered.body.parameters.widgets.map((w) => w.width)).toEqual(['full', 'medium']);
  });

  it('applies saved board filters on public shares, with expiry and revocation', async () => {
    const insightId = await createSignupInsight();
    const board = await createBoard({ rangePreset: '30d', filters: PRO, widgets: [{ type: 'insight', insightId }] });
    const share = await fetchWorkerJson<{ id: string; slug: string; expiresAt: string | null }>(
      `/api/boards/${board.body.id}/share`,
      { method: 'POST', headers: await headers(), body: JSON.stringify({ expiresInDays: 7 }) },
    );
    expect(share.response.status).toBe(201);
    expect(share.body.expiresAt).not.toBeNull();

    const pub = await fetchWorkerJson<{ board: { parameters: { filters: unknown[]; widgets: RunBody['widgets'] } } }>(
      `/api/share/${share.body.slug}?${range}`,
    );
    expect(pub.response.status).toBe(200);
    expect(pub.body.board.parameters.filters).toEqual(PRO);
    expect(pub.body.board.parameters.widgets[0]?.result?.results?.[0]?.total).toBe(3);

    const listed = await fetchWorkerJson<Array<{ id: string }>>(`/api/share?entityId=${board.body.id}`, { headers: await headers() });
    expect(listed.body.map((row) => row.id)).toEqual([share.body.id]);

    const revoked = await fetchWorker(`/api/share/${share.body.id}`, { method: 'DELETE', headers: await headers() });
    expect(revoked.status).toBe(200);
    expect((await fetchWorker(`/api/share/${share.body.slug}`)).status).toBe(404);
  });

  it('creates template boards whose insights all run', async () => {
    const templates = await fetchWorkerJson<Array<{ id: string; widgets: unknown[] }>>('/api/boards/templates', {
      headers: await headers(),
    });
    expect(templates.body.map((t) => t.id)).toEqual(['product-analytics', 'web-analytics', 'revenue']);

    for (const template of templates.body) {
      const created = await fetchWorkerJson<{ id: string; name: string; parameters: { widgets: Array<{ insightId: string; label: string }> } }>(
        `/api/boards/templates/${template.id}`,
        {
          method: 'POST',
          headers: await headers(),
          body: JSON.stringify({ websiteId: FIXTURE_SITE, names: { dau: '日活跃用户' } }),
        },
      );
      expect(created.response.status).toBe(201);
      expect(created.body.parameters.widgets).toHaveLength(template.widgets.length);
      if (template.id === 'product-analytics') expect(created.body.parameters.widgets[0]?.label).toBe('日活跃用户');

      const run = await fetchWorkerJson<RunBody>(`/api/boards/${created.body.id}/run?${range}`, { headers: await headers() });
      expect(run.response.status).toBe(200);
      expect(run.body.widgets.filter((w) => w.error)).toEqual([]);
      expect(run.body.widgets.every((w) => w.result)).toBe(true);
    }

    const unknown = await fetchWorker('/api/boards/templates/nope', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ websiteId: FIXTURE_SITE }),
    });
    expect(unknown.status).toBe(404);
  });

  it('removes subscriptions and shares with the board', async () => {
    const board = await createBoard({ widgets: [] });
    const sub = await fetchWorker('/api/subscriptions', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ targetType: 'board', targetId: board.body.id, frequency: 'weekly', recipients: ['team@example.com'] }),
    });
    expect(sub.status).toBe(201);
    await fetchWorker(`/api/boards/${board.body.id}/share`, { method: 'POST', headers: await headers(), body: '{}' });
    await fetchWorker(`/api/boards/${board.body.id}`, { method: 'DELETE', headers: await headers() });
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM report_subscription WHERE target_id = ?1) + (SELECT COUNT(*) FROM share WHERE entity_id = ?1) AS n`,
    )
      .bind(board.body.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
