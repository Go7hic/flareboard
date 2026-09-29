import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';
import { testSiteDb } from '../helpers/site-db';

const OWNER_ID = '00000000-0000-0000-0000-000000000001';
const VISIT = 'share-visit-1';
const START = Date.UTC(2026, 2, 1, 9);
const EVENTS = [
  { type: 4, data: { href: 'https://example.com/' }, timestamp: START },
  { type: 2, data: {}, timestamp: START + 1 },
];

async function authHeader() {
  const token = await createSecureToken({ userId: OWNER_ID, role: ROLES.admin }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type Share = { id: string; visitId: string; token: string; expiresAt: number | null; createdAt: number };

async function createShare(body: Record<string, unknown> = {}, visitId = VISIT) {
  return fetchWorkerJson<Share>(`/api/websites/${TEST_WEBSITE_ID}/replays/${visitId}/shares`, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(body),
  });
}

describe('replay share links', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await testSiteDb(TEST_WEBSITE_ID)
      .prepare(
        `INSERT OR IGNORE INTO session_replay
         (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at)
         VALUES ('share-chunk-0', ?1, 'share-session', ?2, 0, X'', 2, ?3, ?4, ?3)`,
      )
      .bind(TEST_WEBSITE_ID, VISIT, START, START + 42_000)
      .run();
    await env.REPLAY_BUCKET!.put(`${TEST_WEBSITE_ID}/${VISIT}/0`, JSON.stringify(EVENTS));
  });

  it('creates a link that plays the replay without logging in', async () => {
    const created = await createShare();
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({ visitId: VISIT, expiresAt: null });
    expect(created.body.token).toMatch(/^[\w-]{32}$/);

    const shared = await fetchWorkerJson<{
      visitId: string;
      durationMs: number;
      events: unknown[];
      website: { name: string };
    }>(`/api/replay-shares/${created.body.token}`);
    expect(shared.response.status).toBe(200);
    expect(shared.body).toMatchObject({ visitId: VISIT, durationMs: 42_000, events: EVENTS, website: { name: 'Test Site' } });

    const list = await fetchWorkerJson<Share[]>(`/api/websites/${TEST_WEBSITE_ID}/replays/${VISIT}/shares`, {
      headers: await authHeader(),
    });
    expect(list.body.map((share) => share.id)).toContain(created.body.id);
  });

  it('stops serving a link once it is revoked', async () => {
    const created = await createShare();
    const revoked = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/replays/shares/${created.body.id}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    expect(revoked.status).toBe(200);
    expect((await fetchWorker(`/api/replay-shares/${created.body.token}`)).status).toBe(404);
    const again = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/replays/shares/${created.body.id}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    expect(again.status).toBe(404);
  });

  it('expires links and rejects unknown tokens, replays and bad input', async () => {
    const created = await createShare({ expiresInDays: 7 });
    expect(created.body.expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect((await fetchWorker(`/api/replay-shares/${created.body.token}`)).status).toBe(200);
    await env.DB.prepare('UPDATE session_replay_share SET expires_at = ?1 WHERE share_id = ?2')
      .bind(Date.now() - 1000, created.body.id)
      .run();
    expect((await fetchWorker(`/api/replay-shares/${created.body.token}`)).status).toBe(404);

    expect((await fetchWorker('/api/replay-shares/not-a-token')).status).toBe(404);
    expect((await createShare({}, 'no-such-visit')).response.status).toBe(404);
    expect((await createShare({ expiresInDays: 0 })).response.status).toBe(400);
  });

  it('requires a login to create links', async () => {
    const response = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/replays/${VISIT}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
  });
});

describe('replay list query', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('accepts filters and sort, and rejects malformed filters', async () => {
    const filters = encodeURIComponent(JSON.stringify([{ type: 'dimension', key: 'country', operator: 'is', value: 'US' }]));
    const ok = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/replays?sort=longest&hasErrors=true&filters=${filters}`, {
      headers: await authHeader(),
    });
    expect(ok.status).toBe(200);

    const bad = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/replays?filters=%7Bnope`, { headers: await authHeader() });
    expect(bad.status).toBe(400);
    const badSort = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/replays?sort=random`, { headers: await authHeader() });
    expect(badSort.status).toBe(400);
  });
});
