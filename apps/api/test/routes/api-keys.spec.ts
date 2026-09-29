import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, hashApiKey, projectKeyCacheKey, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const BASE = Date.UTC(2026, 8, 1);
const OWNER = 'ak-owner';
const OTHER = 'ak-other';
const VIEWER = 'ak-viewer';
const GONE = 'ak-gone';
const TEAM = 'ak-team';
const SITE = 'ak-site';
const TEAM_SITE = 'ak-team-site';

type KeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  key?: string;
};

async function session(userId: string) {
  const token = await createSecureToken({ userId, role: ROLES.user }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function bearer(key: string) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function createKey(userId: string, name: string, scopes: string[]) {
  const { response, body } = await fetchWorkerJson<KeySummary & { message?: string }>('/api/me/api-keys', {
    method: 'POST',
    headers: await session(userId),
    body: JSON.stringify({ name, scopes }),
  });
  expect(response.status).toBe(201);
  return body as KeySummary & { key: string };
}

describe('personal API keys', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES
         (?1, 'ak-owner@example.com', 'hash', ?5, ?6, ?6),
         (?2, 'ak-other@example.com', 'hash', ?5, ?6, ?6),
         (?3, 'ak-viewer@example.com', 'hash', ?5, ?6, ?6),
         (?4, 'ak-gone@example.com', 'hash', ?5, ?6, ?6)`,
    )
      .bind(OWNER, OTHER, VIEWER, GONE, ROLES.user, BASE)
      .run();
  });

  it('requires a signed-in session to manage keys', async () => {
    const { response } = await fetchWorkerJson('/api/me/api-keys');
    expect(response.status).toBe(401);
  });

  it('shows the secret once and stores only its hash and prefix', async () => {
    const created = await createKey(OWNER, 'CI export', ['read']);
    expect(created.key).toMatch(/^fb_sk_[0-9A-Za-z]{32}$/);
    expect(created.prefix).toBe(created.key.slice(0, 10));
    expect(created.scopes).toEqual(['read']);
    expect(created.lastUsedAt).toBeNull();

    const row = await env.DB.prepare('SELECT * FROM personal_api_key WHERE key_id = ?1')
      .bind(created.id)
      .first<Record<string, unknown>>();
    expect(row?.key_hash).toBe(await hashApiKey(created.key));
    expect(Object.values(row ?? {})).not.toContain(created.key);

    const list = await fetchWorkerJson<KeySummary[]>('/api/me/api-keys', { headers: await session(OWNER) });
    const listed = list.body.find((key) => key.id === created.id);
    expect(listed).toMatchObject({ name: 'CI export', prefix: created.prefix, scopes: ['read'] });
    expect(listed).not.toHaveProperty('key');
    expect(JSON.stringify(list.body)).not.toContain(created.key);
  });

  it('rejects invalid names and scopes', async () => {
    for (const body of [
      { name: '', scopes: ['read'] },
      { name: 'x', scopes: [] },
      { name: 'x', scopes: ['admin'] },
    ]) {
      const { response } = await fetchWorkerJson('/api/me/api-keys', {
        method: 'POST',
        headers: await session(OWNER),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it('authenticates as the key owner and records last use', async () => {
    const created = await createKey(OWNER, 'Reader', ['read']);
    const me = await fetchWorkerJson<{ username: string }>('/api/me', { headers: bearer(created.key) });
    expect(me.response.status).toBe(200);
    expect(me.body.username).toBe('ak-owner@example.com');

    const row = await env.DB.prepare('SELECT last_used_at AS lastUsedAt FROM personal_api_key WHERE key_id = ?1')
      .bind(created.id)
      .first<{ lastUsedAt: number | null }>();
    expect(row?.lastUsedAt).toBeGreaterThan(0);
  });

  it('needs the write scope for anything but reads', async () => {
    const reader = await createKey(OWNER, 'Read only', ['read']);
    const denied = await fetchWorkerJson<{ message: string }>('/api/me', {
      method: 'PATCH',
      headers: bearer(reader.key),
      body: JSON.stringify({ displayName: 'Nope' }),
    });
    expect(denied.response.status).toBe(403);
    expect(denied.body.message).toMatch(/write scope/);

    const writer = await createKey(OWNER, 'Read and write', ['read', 'write']);
    // No Origin header: bearer keys are not subject to the cookie CSRF check.
    const allowed = await fetchWorkerJson('/api/me', {
      method: 'PATCH',
      headers: bearer(writer.key),
      body: JSON.stringify({ displayName: 'Automation' }),
    });
    expect(allowed.response.status).toBe(200);

    const writeOnly = await createKey(OWNER, 'Write only', ['write']);
    const read = await fetchWorkerJson('/api/me', { headers: bearer(writeOnly.key) });
    expect(read.response.status).toBe(403);
  });

  it('cannot manage keys, the password or the account', async () => {
    const key = await createKey(OWNER, 'Admin-ish', ['read', 'write']);
    const list = await fetchWorkerJson('/api/me/api-keys', { headers: bearer(key.key) });
    expect(list.response.status).toBe(403);
    const mint = await fetchWorkerJson('/api/me/api-keys', {
      method: 'POST',
      headers: bearer(key.key),
      body: JSON.stringify({ name: 'escalate', scopes: ['read', 'write'] }),
    });
    expect(mint.response.status).toBe(403);
    const remove = await fetchWorkerJson('/api/me/delete', {
      method: 'POST',
      headers: bearer(key.key),
      body: JSON.stringify({ confirm: 'ak-owner@example.com' }),
    });
    expect(remove.response.status).toBe(403);
    const deletedAt = await env.DB.prepare('SELECT deleted_at AS d FROM user WHERE user_id = ?1').bind(OWNER).first<{ d: number | null }>();
    expect(deletedAt?.d).toBeNull();
  });

  it('rejects unknown and malformed keys', async () => {
    for (const key of [`fb_sk_${'A'.repeat(32)}`, 'fb_sk_short', `fb_sk_${'A'.repeat(31)}!`]) {
      const { response } = await fetchWorkerJson('/api/me', { headers: bearer(key) });
      expect(response.status).toBe(401);
    }
  });

  it('stops working once revoked, and only the owner can revoke', async () => {
    const created = await createKey(OWNER, 'Short lived', ['read']);
    expect((await fetchWorkerJson('/api/me', { headers: bearer(created.key) })).response.status).toBe(200);

    const foreign = await fetchWorkerJson(`/api/me/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: await session(OTHER),
    });
    expect(foreign.response.status).toBe(404);
    expect((await fetchWorkerJson('/api/me', { headers: bearer(created.key) })).response.status).toBe(200);

    const revoked = await fetchWorkerJson(`/api/me/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: await session(OWNER),
    });
    expect(revoked.response.status).toBe(200);
    expect((await fetchWorkerJson('/api/me', { headers: bearer(created.key) })).response.status).toBe(401);

    const again = await fetchWorkerJson(`/api/me/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: await session(OWNER),
    });
    expect(again.response.status).toBe(404);
  });

  it('stops working when the user is deleted', async () => {
    const created = await createKey(GONE, 'Leaver', ['read']);
    expect((await fetchWorkerJson('/api/me', { headers: bearer(created.key) })).response.status).toBe(200);
    await env.DB.prepare('UPDATE user SET deleted_at = ?2 WHERE user_id = ?1').bind(GONE, Date.now()).run();
    expect((await fetchWorkerJson('/api/me', { headers: bearer(created.key) })).response.status).toBe(401);
  });

  it('caps the number of keys per user', async () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      await env.DB.prepare(
        `INSERT INTO personal_api_key (key_id, user_id, name, key_hash, key_prefix, scopes, created_at)
         VALUES (?1, ?2, 'bulk', ?3, 'fb_sk_bulk', 'read', ?4)`,
      )
        .bind(`ak-bulk-${i}`, VIEWER, `bulk-hash-${i}`, now)
        .run();
    }
    const { response } = await fetchWorkerJson('/api/me/api-keys', {
      method: 'POST',
      headers: await session(VIEWER),
      body: JSON.stringify({ name: 'one too many', scopes: ['read'] }),
    });
    expect(response.status).toBe(409);
  });
});

describe('website project keys', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES
         (?1, 'ak-owner@example.com', 'hash', ?4, ?5, ?5),
         (?2, 'ak-other@example.com', 'hash', ?4, ?5, ?5),
         (?3, 'ak-viewer@example.com', 'hash', ?4, ?5, ?5)`,
    )
      .bind(OWNER, OTHER, VIEWER, ROLES.user, BASE)
      .run();
    await env.DB.prepare(`INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at) VALUES (?1, 'AK', 'akcode', ?2, ?2)`)
      .bind(TEAM, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at) VALUES
         ('ak-tu-owner', ?1, ?2, ?4, ?6, ?6), ('ak-tu-viewer', ?1, ?3, ?5, ?6, ?6)`,
    )
      .bind(TEAM, OWNER, VIEWER, ROLES.teamOwner, ROLES.teamViewOnly, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_at, updated_at) VALUES
         (?1, 'AK personal', 'ak.example.com', ?2, NULL, ?4, ?4),
         (?3, 'AK team', 'team.ak.example.com', ?2, 'ak-team', ?4, ?4)`,
    )
      .bind(SITE, OWNER, TEAM_SITE, BASE)
      .run();
  });

  it('creates the key on first read and keeps it stable', async () => {
    const first = await fetchWorkerJson<{ key: string; rotatedAt: number | null }>(`/api/websites/${SITE}/project-key`, {
      headers: await session(OWNER),
    });
    expect(first.response.status).toBe(200);
    expect(first.body.key).toMatch(/^fb_pk_[0-9A-Za-z]{24}$/);
    expect(first.body.rotatedAt).toBeNull();

    const second = await fetchWorkerJson<{ key: string }>(`/api/websites/${SITE}/project-key`, {
      headers: await session(OWNER),
    });
    expect(second.body.key).toBe(first.body.key);
  });

  it('is hidden from users without access to the website', async () => {
    const { response } = await fetchWorkerJson(`/api/websites/${SITE}/project-key`, { headers: await session(OTHER) });
    expect(response.status).toBe(404);
    const rotate = await fetchWorkerJson(`/api/websites/${SITE}/project-key/rotate`, {
      method: 'POST',
      headers: await session(OTHER),
    });
    expect(rotate.response.status).toBe(404);
  });

  it('lets read-only members see but not rotate the key', async () => {
    const read = await fetchWorkerJson<{ key: string }>(`/api/websites/${TEAM_SITE}/project-key`, {
      headers: await session(VIEWER),
    });
    expect(read.response.status).toBe(200);
    const rotate = await fetchWorkerJson(`/api/websites/${TEAM_SITE}/project-key/rotate`, {
      method: 'POST',
      headers: await session(VIEWER),
    });
    expect(rotate.response.status).toBe(403);
    const after = await fetchWorkerJson<{ key: string }>(`/api/websites/${TEAM_SITE}/project-key`, {
      headers: await session(VIEWER),
    });
    expect(after.body.key).toBe(read.body.key);
  });

  it('rotates the key and drops the cached mapping of the old one', async () => {
    const before = await fetchWorkerJson<{ key: string }>(`/api/websites/${SITE}/project-key`, { headers: await session(OWNER) });
    await env.CACHE.put(projectKeyCacheKey(before.body.key), SITE);

    const rotated = await fetchWorkerJson<{ key: string; rotatedAt: number | null }>(`/api/websites/${SITE}/project-key/rotate`, {
      method: 'POST',
      headers: await session(OWNER),
    });
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.key).toMatch(/^fb_pk_[0-9A-Za-z]{24}$/);
    expect(rotated.body.key).not.toBe(before.body.key);
    expect(rotated.body.rotatedAt).toBeGreaterThan(0);
    expect(await env.CACHE.get(projectKeyCacheKey(before.body.key))).toBeNull();

    const current = await fetchWorkerJson<{ key: string }>(`/api/websites/${SITE}/project-key`, { headers: await session(OWNER) });
    expect(current.body.key).toBe(rotated.body.key);

    const audit = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'website' AND entity_id = ?1 AND metadata LIKE '%projectKeyRotated%'`,
    )
      .bind(SITE)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('follows personal key scopes: read to view, write to rotate', async () => {
    const reader = await createKey(OWNER, 'project reader', ['read']);
    expect((await fetchWorkerJson(`/api/websites/${SITE}/project-key`, { headers: bearer(reader.key) })).response.status).toBe(200);
    const denied = await fetchWorkerJson(`/api/websites/${SITE}/project-key/rotate`, { method: 'POST', headers: bearer(reader.key) });
    expect(denied.response.status).toBe(403);

    const writer = await createKey(OWNER, 'project writer', ['read', 'write']);
    const allowed = await fetchWorkerJson(`/api/websites/${SITE}/project-key/rotate`, { method: 'POST', headers: bearer(writer.key) });
    expect(allowed.response.status).toBe(200);
  });

  it('forgets the cached key when the website is deleted', async () => {
    const { body } = await fetchWorkerJson<{ key: string }>(`/api/websites/${TEAM_SITE}/project-key`, {
      headers: await session(OWNER),
    });
    await env.CACHE.put(projectKeyCacheKey(body.key), TEAM_SITE);
    const removed = await fetchWorkerJson(`/api/websites/${TEAM_SITE}`, { method: 'DELETE', headers: await session(OWNER) });
    expect(removed.response.status).toBe(200);
    expect(await env.CACHE.get(projectKeyCacheKey(body.key))).toBeNull();
  });
});
