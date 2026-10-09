import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const OWNER_ID = 'tracker-settings-owner';
const BASE = Date.UTC(2026, 8, 1, 12);

async function authHeader() {
  const token = await createSecureToken({ userId: OWNER_ID, role: ROLES.user }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

type WebsiteBody = { id: string; autocapture: boolean; persistVisitors: boolean; respectDnt: boolean };

describe('website tracker settings', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, 'tracker-settings-owner', 'hash', ?2, ?3, ?3)`,
    )
      .bind(OWNER_ID, ROLES.user, BASE)
      .run();
  });

  it('new websites start with autocapture on, cookieless counting and DNT not honored', async () => {
    const { response, body } = await fetchWorkerJson<WebsiteBody>('/api/websites', {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Tracker settings', domain: 'tracker.example' }),
    });
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ autocapture: true, persistVisitors: false, respectDnt: false });
  });

  it('saves the settings and clears the ingest caches that hold them', async () => {
    const created = await fetchWorkerJson<WebsiteBody>('/api/websites', {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Tracker settings 2', domain: 'tracker2.example' }),
    });
    const id = created.body.id;
    await env.CACHE.put(`tracker-config:${id}`, '{"stale":true}');
    await env.CACHE.put(`tracker-settings:${id}`, '{"stale":true}');

    const { response, body } = await fetchWorkerJson<WebsiteBody>(`/api/websites/${id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ autocapture: false, persistVisitors: true, respectDnt: true }),
    });
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ autocapture: false, persistVisitors: true, respectDnt: true });
    expect(await env.CACHE.get(`tracker-config:${id}`)).toBeNull();
    expect(await env.CACHE.get(`tracker-settings:${id}`)).toBeNull();

    // Unrelated edits keep the tracker settings.
    const renamed = await fetchWorkerJson<WebsiteBody>(`/api/websites/${id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(renamed.body).toMatchObject({ autocapture: false, persistVisitors: true, respectDnt: true });
  });

  it('clears the tracker config when replay or heatmap settings change', async () => {
    const created = await fetchWorkerJson<WebsiteBody>('/api/websites', {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Tracker settings 4', domain: 'tracker4.example' }),
    });
    const id = created.body.id;
    for (const change of [{ heatmapConfig: { enabled: true, sampleRate: 1 } }, { replayEnabled: true }, { replayConfig: { maskAllInputs: false } }]) {
      await env.CACHE.put(`tracker-config:${id}`, '{"stale":true}');
      const { response } = await fetchWorkerJson(`/api/websites/${id}`, {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify(change),
      });
      expect(response.status).toBe(200);
      expect(await env.CACHE.get(`tracker-config:${id}`), JSON.stringify(change)).toBeNull();
    }

    // Saving the same heatmap settings again leaves the cache alone.
    await env.CACHE.put(`tracker-config:${id}`, '{"fresh":true}');
    await fetchWorkerJson(`/api/websites/${id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ heatmapConfig: { enabled: true, sampleRate: 1 } }),
    });
    expect(await env.CACHE.get(`tracker-config:${id}`)).toBe('{"fresh":true}');
  });

  it('rejects non-boolean values', async () => {
    const created = await fetchWorkerJson<WebsiteBody>('/api/websites', {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ name: 'Tracker settings 3', domain: 'tracker3.example' }),
    });
    const { response } = await fetchWorkerJson(`/api/websites/${created.body.id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ persistVisitors: 'yes' }),
    });
    expect(response.status).toBe(400);
  });
});
