import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { FIXTURE_SITE, RANGE, seedInsightFixture } from '../helpers/insight-fixture';
import { TEST_WEBSITE_ID } from '../helpers/migrations';

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const OUTSIDER_ID = '00000000-0000-4000-8000-0000000000e1';
const range = `startAt=${RANGE.startAt}&endAt=${RANGE.endAt}`;

async function headers(userId = ADMIN_ID, role = 'admin') {
  const token = await createSecureToken({ userId, role }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

let insightId = '';

describe('public insight shares', () => {
  beforeAll(async () => {
    await seedInsightFixture();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (?1, 'outsider', 'x', 'user', ?2, ?2)`,
    )
      .bind(OUTSIDER_ID, Date.now())
      .run();
    const created = await fetchWorkerJson<{ id: string }>('/api/insights', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        websiteId: FIXTURE_SITE,
        name: 'Shared signups',
        type: 'trend',
        query: {
          version: 2,
          series: [{ kind: 'event', event: 'signup', math: 'total', filters: [{ type: 'person', key: 'email', operator: 'contains', value: 'acme' }] }],
        },
      }),
    });
    insightId = created.body.id;
  });

  it('serves a read-only result without the saved query, until revoked', async () => {
    const share = await fetchWorkerJson<{ id: string; slug: string; shareType: number }>(`/api/insights/${insightId}/share`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ expiresInDays: 30 }),
    });
    expect(share.response.status).toBe(201);
    expect(share.body.shareType).toBe(5);

    const pub = await fetchWorkerJson<{
      insight: Record<string, unknown>;
      result: { kind: string; results: Array<{ total: number }> };
    }>(`/api/share/${share.body.slug}?${range}`);
    expect(pub.response.status).toBe(200);
    expect(pub.body.insight).toMatchObject({ name: 'Shared signups', type: 'trend' });
    // The query (filters on person emails, event names…) is not exposed.
    expect(pub.body.insight.query).toBeUndefined();
    expect(pub.body.insight.userId).toBeUndefined();
    expect(pub.body.result.kind).toBe('trend');
    expect(pub.body.result.results[0]?.total).toBe(2);

    const listed = await fetchWorkerJson<Array<{ id: string }>>('/api/share', { headers: await headers() });
    expect(listed.body.some((row) => row.id === share.body.id)).toBe(true);

    const revoked = await fetchWorker(`/api/share/${share.body.id}`, { method: 'DELETE', headers: await headers() });
    expect(revoked.status).toBe(200);
    expect((await fetchWorker(`/api/share/${share.body.slug}`)).status).toBe(404);
  });

  it('expires links and keeps other users from sharing or revoking', async () => {
    const share = await fetchWorkerJson<{ id: string; slug: string }>(`/api/insights/${insightId}/share`, {
      method: 'POST',
      headers: await headers(),
      body: '{}',
    });
    const outsider = await fetchWorker(`/api/insights/${insightId}/share`, {
      method: 'POST',
      headers: await headers(OUTSIDER_ID, 'user'),
      body: '{}',
    });
    expect(outsider.status).toBe(404);
    const outsiderRevoke = await fetchWorker(`/api/share/${share.body.id}`, {
      method: 'DELETE',
      headers: await headers(OUTSIDER_ID, 'user'),
    });
    expect(outsiderRevoke.status).toBe(404);

    await env.DB.prepare(`UPDATE share SET expires_at = ?2 WHERE share_id = ?1`).bind(share.body.id, Date.now() - 1000).run();
    expect((await fetchWorker(`/api/share/${share.body.slug}`)).status).toBe(404);
  });

  it('removes shares with the insight', async () => {
    const created = await fetchWorkerJson<{ id: string }>('/api/insights', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ websiteId: FIXTURE_SITE, name: 'Temp', type: 'trend', query: { version: 2 } }),
    });
    const share = await fetchWorkerJson<{ slug: string }>(`/api/insights/${created.body.id}/share`, {
      method: 'POST',
      headers: await headers(),
      body: '{}',
    });
    await fetchWorker(`/api/insights/${created.body.id}`, { method: 'DELETE', headers: await headers() });
    expect((await fetchWorker(`/api/share/${share.body.slug}`)).status).toBe(404);
  });
});

describe('notebooks', () => {
  beforeAll(seedInsightFixture);

  const base = `/api/websites/${FIXTURE_SITE}/notebooks`;

  it('creates, lists, reads, updates and deletes notebooks', async () => {
    const created = await fetchWorkerJson<{ id: string; title: string; content: { blocks: unknown[] } }>(base, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        title: 'Launch review',
        content: {
          blocks: [
            { id: 't1', type: 'text', text: '# Findings\nSignups **doubled**.' },
            { id: 'i1', type: 'insight', insightId, rangePreset: '30d' },
            { id: 'r1', type: 'replay', sessionId: 'fx-a1', label: 'Alice checkout' },
          ],
        },
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.content.blocks).toHaveLength(3);

    const list = await fetchWorkerJson<Array<{ id: string; blockCount: number; content?: unknown }>>(base, { headers: await headers() });
    const row = list.body.find((n) => n.id === created.body.id);
    expect(row).toMatchObject({ blockCount: 3 });
    expect(row?.content).toBeUndefined();

    const updated = await fetchWorkerJson<{ title: string; content: { blocks: unknown[] } }>(`${base}/${created.body.id}`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ title: 'Launch review (final)', content: { blocks: [{ id: 't1', type: 'text', text: 'Done' }] } }),
    });
    expect(updated.body).toMatchObject({ title: 'Launch review (final)', content: { blocks: [{ type: 'text', text: 'Done' }] } });

    const got = await fetchWorkerJson<{ title: string }>(`${base}/${created.body.id}`, { headers: await headers() });
    expect(got.body.title).toBe('Launch review (final)');

    // Other websites cannot reach it through their own path.
    expect((await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/notebooks/${created.body.id}`, { headers: await headers() })).status).toBe(404);
    // Outsiders cannot list the website's notebooks.
    expect((await fetchWorker(base, { headers: await headers(OUTSIDER_ID, 'user') })).status).toBe(404);

    expect((await fetchWorker(`${base}/${created.body.id}`, { method: 'DELETE', headers: await headers() })).status).toBe(200);
    expect((await fetchWorker(`${base}/${created.body.id}`, { headers: await headers() })).status).toBe(404);
  });

  it('sanitizes text and rejects unsafe or foreign blocks', async () => {
    const created = await fetchWorkerJson<{ title: string; content: { blocks: Array<{ text?: string }> } }>(base, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        title: 'Notes\u0000',
        content: { blocks: [{ id: 't1', type: 'text', text: '<script>alert(1)</script>\u0007\r\nok‮' }] },
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.title).toBe('Notes');
    // Stored as plain text (rendered as text by the dashboard), control characters removed.
    expect(created.body.content.blocks[0]?.text).toBe('<script>alert(1)</script>\nok');

    const rawHtml = await fetchWorker(base, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ title: 'x', content: { blocks: [{ id: 'h1', type: 'html', html: '<img onerror=1>' }] } }),
    });
    expect(rawHtml.status).toBe(400);

    const badSession = await fetchWorker(base, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ title: 'x', content: { blocks: [{ id: 'r1', type: 'replay', sessionId: 'javascript:alert(1)//"' }] } }),
    });
    expect(badSession.status).toBe(400);

    const foreign = await fetchWorkerJson<{ id: string }>('/api/insights', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ websiteId: TEST_WEBSITE_ID, name: 'Elsewhere', type: 'trend', query: { version: 2 } }),
    });
    const foreignBlock = await fetchWorker(base, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ title: 'x', content: { blocks: [{ id: 'i1', type: 'insight', insightId: foreign.body.id }] } }),
    });
    expect(foreignBlock.status).toBe(400);
  });
});
