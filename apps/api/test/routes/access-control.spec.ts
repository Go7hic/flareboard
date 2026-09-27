import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const ATTACKER_ID = 'acl-attacker';
const VICTIM_ID = 'acl-victim';
const MANAGER_ID = 'acl-manager';
const ATTACKER_SITE = 'acl-attacker-site';
const VICTIM_SITE = 'acl-victim-site';
const VICTIM_COHORT = 'acl-victim-cohort';
const VICTIM_TEAM = '7d1e3c52-0a4b-4f6e-9c2d-1b8a5e7f3a01';
const MANAGED_TEAM = '7d1e3c52-0a4b-4f6e-9c2d-1b8a5e7f3a02';
const FORMER_MEMBER_ID = 'acl-former-member';
const TEAM_SITE = 'acl-team-site';
const DELETED_TEAM = '7d1e3c52-0a4b-4f6e-9c2d-1b8a5e7f3a03';
const DELETED_TEAM_SITE = 'acl-deleted-team-site';
const BASE = Date.UTC(2026, 0, 24, 12);

async function authHeader(userId: string, role = ROLES.user, tv?: number) {
  const token = await createSecureToken({ userId, role, ...(tv === undefined ? {} : { tv }) }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function seed() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
     VALUES (?1, 'acl-attacker', 'hash', ?4, ?5, ?5),
            (?2, 'acl-victim', 'hash', ?4, ?5, ?5),
            (?3, 'acl-manager', 'hash', ?4, ?5, ?5)`,
  )
    .bind(ATTACKER_ID, VICTIM_ID, MANAGER_ID, ROLES.user, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
     VALUES (?1, 'Attacker', 'attacker.example', ?2, ?5, ?5),
            (?3, 'Victim', 'victim.example', ?4, ?5, ?5)`,
  )
    .bind(ATTACKER_SITE, ATTACKER_ID, VICTIM_SITE, VICTIM_ID, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO cohort (cohort_id, website_id, name, type, value, created_at, updated_at)
     VALUES (?1, ?2, 'Victim cohort', 'country', 'US', ?3, ?3)`,
  )
    .bind(VICTIM_COHORT, VICTIM_SITE, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at)
     VALUES (?1, 'Victim team', 'aclvictim', ?3, ?3), (?2, 'Managed team', 'aclmanaged', ?3, ?3)`,
  )
    .bind(VICTIM_TEAM, MANAGED_TEAM, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
     VALUES ('acl-victim-owner', ?1, ?2, ?5, ?7, ?7),
            ('acl-managed-owner', ?3, ?2, ?5, ?7, ?7),
            ('acl-managed-manager', ?3, ?4, ?6, ?7, ?7)`,
  )
    .bind(VICTIM_TEAM, VICTIM_ID, MANAGED_TEAM, MANAGER_ID, ROLES.teamOwner, ROLES.teamManager, BASE)
    .run();
}

async function seedTeamSites() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
     VALUES (?1, 'acl-former-member', 'hash', ?2, ?3, ?3)`,
  )
    .bind(FORMER_MEMBER_ID, ROLES.user, BASE)
    .run();
  // Created by a member who has since been removed from the (still live) team.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_at, updated_at)
     VALUES (?1, 'Team site', 'team.example', ?2, ?3, ?4, ?4)`,
  )
    .bind(TEAM_SITE, FORMER_MEMBER_ID, VICTIM_TEAM, BASE)
    .run();
  // A team that was deleted while the victim was still a member.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at, deleted_at)
     VALUES (?1, 'Deleted team', 'acldeleted', ?2, ?2, ?2)`,
  )
    .bind(DELETED_TEAM, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
     VALUES ('acl-deleted-team-member', ?1, ?2, ?3, ?4, ?4)`,
  )
    .bind(DELETED_TEAM, ATTACKER_ID, ROLES.teamMember, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_at, updated_at)
     VALUES (?1, 'Deleted team site', 'deleted-team.example', ?2, ?3, ?4, ?4)`,
  )
    .bind(DELETED_TEAM_SITE, VICTIM_ID, DELETED_TEAM, BASE)
    .run();
}

describe('access control regressions', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seed();
    await seedTeamSites();
  });

  it('removes access to team sites a former member created', async () => {
    const former = await fetchWorkerJson(`/api/websites/${TEAM_SITE}`, { headers: await authHeader(FORMER_MEMBER_ID) });
    expect(former.response.status).toBe(404);
    const owner = await fetchWorkerJson(`/api/websites/${TEAM_SITE}`, { headers: await authHeader(VICTIM_ID) });
    expect(owner.response.status).toBe(200);
  });

  it('grants nothing through membership in a deleted team', async () => {
    const member = await fetchWorkerJson(`/api/websites/${DELETED_TEAM_SITE}`, { headers: await authHeader(ATTACKER_ID) });
    expect(member.response.status).toBe(404);
    // The creator keeps the site once its team is gone.
    const creator = await fetchWorkerJson(`/api/websites/${DELETED_TEAM_SITE}`, { headers: await authHeader(VICTIM_ID) });
    expect(creator.response.status).toBe(200);
  });

  it('does not delete another website’s cohort through a site the caller owns', async () => {
    const { response } = await fetchWorkerJson(`/api/websites/${ATTACKER_SITE}/cohorts/${VICTIM_COHORT}`, {
      method: 'DELETE',
      headers: await authHeader(ATTACKER_ID),
    });
    expect(response.status).toBe(404);

    const row = await env.DB.prepare('SELECT cohort_id FROM cohort WHERE cohort_id = ?1')
      .bind(VICTIM_COHORT)
      .first();
    expect(row).not.toBeNull();
  });

  it('rejects creating a link inside a team the caller does not belong to', async () => {
    const { response } = await fetchWorkerJson('/api/links', {
      method: 'POST',
      headers: await authHeader(ATTACKER_ID),
      body: JSON.stringify({ name: 'Planted', url: 'https://attacker.example', teamId: VICTIM_TEAM }),
    });
    expect(response.status).toBe(403);
  });

  it('does not let a team manager promote themselves to owner', async () => {
    const { response } = await fetchWorkerJson(`/api/teams/${MANAGED_TEAM}/users/${MANAGER_ID}`, {
      method: 'PATCH',
      headers: await authHeader(MANAGER_ID),
      body: JSON.stringify({ role: ROLES.teamOwner }),
    });
    expect(response.status).toBe(400);

    const row = await env.DB.prepare('SELECT role FROM team_user WHERE team_user_id = ?1')
      .bind('acl-managed-manager')
      .first<{ role: string }>();
    expect(row?.role).toBe(ROLES.teamManager);
  });

  it('rejects a revoked token on /api/auth/verify', async () => {
    await env.DB.prepare('UPDATE user SET token_version = 3 WHERE user_id = ?1').bind(VICTIM_ID).run();
    await env.CACHE.put(`token-version:${VICTIM_ID}`, '3');

    const stale = await fetchWorkerJson('/api/auth/verify', { headers: await authHeader(VICTIM_ID, ROLES.user, 2) });
    expect(stale.response.status).toBe(401);

    const current = await fetchWorkerJson('/api/auth/verify', { headers: await authHeader(VICTIM_ID, ROLES.user, 3) });
    expect(current.response.status).toBe(200);
  });
});
