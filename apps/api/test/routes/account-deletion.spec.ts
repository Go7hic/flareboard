import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, hashPassword, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const BASE = Date.UTC(2026, 8, 1);
const PASSWORD = 'correct-horse-battery';

const LEAVER = 'ad-leaver';
const OWNER_WITH_MEMBERS = 'ad-owner';
const MEMBER = 'ad-member';
const OAUTH_USER = 'ad-oauth';
const SOLO_TEAM = '9c1f2e3d-4b5a-4c6d-8e7f-00000000ad01';
const SHARED_TEAM = '9c1f2e3d-4b5a-4c6d-8e7f-00000000ad02';
const BILLED_TEAM = '9c1f2e3d-4b5a-4c6d-8e7f-00000000ad03';
const CREATOR = 'ad-creator';
const FREE_OWNER = 'ad-free-owner';
const PAID_MANAGER = 'ad-paid-manager';
const PAID_MEMBER = 'ad-paid-member';

async function authHeader(userId: string) {
  const token = await createSecureToken({ userId, role: ROLES.user }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function deleteAccount(userId: string, body: Record<string, unknown>) {
  return fetchWorkerJson<{ message?: string; ok?: boolean; teams?: string[] }>('/api/me/delete', {
    method: 'POST',
    headers: await authHeader(userId),
    body: JSON.stringify(body),
  });
}

async function deletedAt(table: string, idColumn: string, id: string) {
  const row = await env.DB.prepare(`SELECT deleted_at AS deletedAt FROM ${table} WHERE ${idColumn} = ?1`)
    .bind(id)
    .first<{ deletedAt: number | null }>();
  return row?.deletedAt ?? null;
}

describe('POST /api/me/delete', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const hash = hashPassword(PASSWORD);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES
         (?1, 'leaver@example.com', ?5, ?6, ?7, ?7),
         (?2, 'owner@example.com', ?5, ?6, ?7, ?7),
         (?3, 'member@example.com', ?5, ?6, ?7, ?7),
         (?4, 'oauth@example.com', 'random-unknown-hash', ?6, ?7, ?7)`,
    )
      .bind(LEAVER, OWNER_WITH_MEMBERS, MEMBER, OAUTH_USER, hash, ROLES.user, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_oauth_identity (provider, provider_user_id, user_id, created_at) VALUES ('github', 'ad-gh', ?1, ?2)`,
    )
      .bind(OAUTH_USER, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at) VALUES
         (?1, 'Solo team', 'adsolo', ?3, ?3), (?2, 'Shared team', 'adshared', ?3, ?3)`,
    )
      .bind(SOLO_TEAM, SHARED_TEAM, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at) VALUES
         ('ad-tu-1', ?1, ?3, ?6, ?7, ?7),
         ('ad-tu-2', ?2, ?4, ?6, ?7, ?7),
         ('ad-tu-3', ?2, ?5, ?8, ?7, ?7)`,
    )
      .bind(SOLO_TEAM, SHARED_TEAM, LEAVER, OWNER_WITH_MEMBERS, MEMBER, ROLES.teamOwner, BASE, ROLES.teamMember)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, user_id, team_id, created_at, updated_at) VALUES
         ('ad-personal', 'Personal', ?1, NULL, ?3, ?3),
         ('ad-solo-team-site', 'Solo team site', ?1, ?2, ?3, ?3)`,
    )
      .bind(LEAVER, SOLO_TEAM, BASE)
      .run();

    // A team website billed to the manager who created it; the team keeps an owner on Free.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES
         (?1, 'creator@example.com', ?5, ?6, ?7, ?7), (?2, 'free-owner@example.com', ?5, ?6, ?7, ?7),
         (?3, 'paid-manager@example.com', ?5, ?6, ?7, ?7), (?4, 'paid-member@example.com', ?5, ?6, ?7, ?7)`,
    )
      .bind(CREATOR, FREE_OWNER, PAID_MANAGER, PAID_MEMBER, hash, ROLES.user, BASE)
      .run();
    await env.DB.prepare(`INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at) VALUES (?1, 'Billed team', 'adbilled', ?2, ?2)`)
      .bind(BILLED_TEAM, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at) VALUES
         ('ad-tu-4', ?1, ?2, ?6, ?9, ?9), ('ad-tu-5', ?1, ?3, ?7, ?9, ?9),
         ('ad-tu-6', ?1, ?4, ?6, ?9, ?9), ('ad-tu-7', ?1, ?5, ?8, ?9, ?9)`,
    )
      .bind(BILLED_TEAM, CREATOR, FREE_OWNER, PAID_MANAGER, PAID_MEMBER, ROLES.teamManager, ROLES.teamOwner, ROLES.teamMember, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_subscription (user_id, plan_id, status, created_at, updated_at) VALUES
         (?1, 'cloud', 'active', ?3, ?3), (?2, 'business', 'active', ?3, ?3)`,
    )
      .bind(PAID_MANAGER, PAID_MEMBER, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, user_id, team_id, created_by, created_at, updated_at) VALUES
         ('ad-billed-team-site', 'Billed team site', ?1, ?2, ?1, ?3, ?3)`,
    )
      .bind(CREATOR, BILLED_TEAM, BASE)
      .run();
  });

  it('requires authentication', async () => {
    const { response } = await fetchWorkerJson('/api/me/delete', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
  });

  it('rejects a confirmation that does not match the username', async () => {
    const { response } = await deleteAccount(LEAVER, { confirm: 'someone-else', password: PASSWORD });
    expect(response.status).toBe(400);
    expect(await deletedAt('user', 'user_id', LEAVER)).toBeNull();
  });

  it('rejects a wrong password', async () => {
    const { response } = await deleteAccount(LEAVER, { confirm: 'leaver@example.com', password: 'nope' });
    expect(response.status).toBe(401);
    expect(await deletedAt('user', 'user_id', LEAVER)).toBeNull();
  });

  it('blocks the only owner of a team that still has members', async () => {
    const { response, body } = await deleteAccount(OWNER_WITH_MEMBERS, { confirm: 'owner@example.com', password: PASSWORD });
    expect(response.status).toBe(409);
    expect(body.teams).toEqual(['Shared team']);
    expect(await deletedAt('user', 'user_id', OWNER_WITH_MEMBERS)).toBeNull();
  });

  it('does not ask OAuth-only accounts for a password they never set', async () => {
    const { response } = await deleteAccount(OAUTH_USER, { confirm: 'oauth@example.com' });
    expect(response.status).toBe(200);
    expect(await deletedAt('user', 'user_id', OAUTH_USER)).not.toBeNull();
  });

  it('soft-deletes the account, its personal websites and teams it was alone in, and signs it out', async () => {
    const headers = await authHeader(LEAVER);
    const { response, body } = await deleteAccount(LEAVER, { confirm: ' Leaver@Example.com ', password: PASSWORD });
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(response.headers.get('Set-Cookie') ?? '').toMatch(/flareboard_session=;/);

    expect(await deletedAt('user', 'user_id', LEAVER)).not.toBeNull();
    expect(await deletedAt('website', 'website_id', 'ad-personal')).not.toBeNull();
    expect(await deletedAt('website', 'website_id', 'ad-solo-team-site')).not.toBeNull();
    expect(await deletedAt('team', 'team_id', SOLO_TEAM)).not.toBeNull();
    const memberships = await env.DB.prepare('SELECT COUNT(*) AS n FROM team_user WHERE user_id = ?1').bind(LEAVER).first<{ n: number }>();
    expect(memberships?.n).toBe(0);

    // Existing sessions stop working immediately.
    const me = await fetchWorkerJson('/api/me', { headers });
    expect(me.response.status).toBe(401);
  });

  it('hands the team websites it created to a teammate who can create them, a paying one first', async () => {
    await env.CACHE.put('website:owner:ad-billed-team-site', CREATOR);
    const { response } = await deleteAccount(CREATOR, { confirm: 'creator@example.com', password: PASSWORD });
    expect(response.status).toBe(200);

    const site = await env.DB.prepare('SELECT user_id AS userId, created_by AS createdBy, deleted_at AS deletedAt FROM website WHERE website_id = ?1')
      .bind('ad-billed-team-site')
      .first();
    // The Business member cannot create team websites, so the paying manager takes over from the Free owner.
    expect(site).toEqual({ userId: PAID_MANAGER, createdBy: CREATOR, deletedAt: null });
    // Ingest reads the new owner instead of its hour-long cache.
    expect(await env.CACHE.get('website:owner:ad-billed-team-site')).toBeNull();
  });
});

describe('PATCH /api/me/password', () => {
  it('runs behind authentication instead of failing with a 500', async () => {
    const anonymous = await fetchWorkerJson('/api/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'x', newPassword: 'y'.repeat(12) }),
    });
    expect(anonymous.response.status).toBe(401);

    const wrong = await fetchWorkerJson<{ message: string }>('/api/me/password', {
      method: 'PATCH',
      headers: await authHeader(MEMBER),
      body: JSON.stringify({ currentPassword: 'not-it', newPassword: 'y'.repeat(12) }),
    });
    expect(wrong.response.status).toBe(401);
    expect(wrong.body.message).toMatch(/current password is incorrect/i);
  });
});
