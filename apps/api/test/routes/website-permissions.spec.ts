import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const TEAM_ID = 'permissions-team';
const WEBSITE_ID = 'permissions-website';
const OWNER_ID = 'permissions-owner';
const MEMBER_ID = 'permissions-member';
const VIEWER_ID = 'permissions-viewer';
const BASE = Date.UTC(2026, 0, 24, 12);

async function authHeader(userId: string, role = ROLES.user) {
  const token = await createSecureToken({ userId, role }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function seedPermissionsFixture() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
     VALUES
       (?1, 'permissions-owner', 'hash', ?4, ?5, ?5),
       (?2, 'permissions-member', 'hash', ?4, ?5, ?5),
       (?3, 'permissions-viewer', 'hash', ?4, ?5, ?5)`,
  )
    .bind(OWNER_ID, MEMBER_ID, VIEWER_ID, ROLES.user, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at)
     VALUES (?1, 'Permissions Team', 'permcode', ?2, ?2)`,
  )
    .bind(TEAM_ID, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
     VALUES
       ('permissions-owner-membership', ?1, ?2, ?5, ?7, ?7),
       ('permissions-member-membership', ?1, ?3, ?6, ?7, ?7),
       ('permissions-viewer-membership', ?1, ?4, ?8, ?7, ?7)`,
  )
    .bind(TEAM_ID, OWNER_ID, MEMBER_ID, VIEWER_ID, ROLES.teamOwner, ROLES.teamMember, BASE, ROLES.teamViewOnly)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_at, updated_at)
     VALUES (?1, 'Permissions Site', 'permissions.example.com', ?2, ?3, ?4, ?4)`,
  )
    .bind(WEBSITE_ID, OWNER_ID, TEAM_ID, BASE)
    .run();
}

describe('website permissions route', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedPermissionsFixture();
  });

  it('returns effective website permissions for editable and read-only team members', async () => {
    const member = await fetchWorkerJson<{
      role: string;
      canView: boolean;
      canEdit: boolean;
      canManageTeam: boolean;
      capabilities: Record<string, boolean>;
      modules: Record<string, { canView: boolean; canEdit: boolean }>;
    }>(`/api/websites/${WEBSITE_ID}/permissions`, {
      headers: await authHeader(MEMBER_ID),
    });

    expect(member.response.status).toBe(200);
    expect(member.body).toEqual(
      expect.objectContaining({
        role: ROLES.teamMember,
        canView: true,
        canEdit: true,
        canManageTeam: false,
      }),
    );
    expect(member.body.capabilities).toEqual(
      expect.objectContaining({
        viewAnalytics: true,
        editWebsite: true,
        manageMembers: false,
      }),
    );
    expect(member.body.modules).toEqual(
      expect.objectContaining({
        analytics: { canView: true, canEdit: false },
        boards: { canView: true, canEdit: true },
        featureFlags: { canView: true, canEdit: true },
        experiments: { canView: true, canEdit: true },
        errors: { canView: true, canEdit: true },
        logs: { canView: true, canEdit: true },
        surveys: { canView: true, canEdit: true },
        warehouse: { canView: true, canEdit: true },
        team: { canView: true, canEdit: false },
      }),
    );

    const viewer = await fetchWorkerJson<{
      role: string;
      canView: boolean;
      canEdit: boolean;
      canManageTeam: boolean;
      capabilities: Record<string, boolean>;
      modules: Record<string, { canView: boolean; canEdit: boolean }>;
    }>(`/api/websites/${WEBSITE_ID}/permissions`, {
      headers: await authHeader(VIEWER_ID),
    });

    expect(viewer.response.status).toBe(200);
    expect(viewer.body).toEqual(
      expect.objectContaining({
        role: ROLES.teamViewOnly,
        canView: true,
        canEdit: false,
        canManageTeam: false,
      }),
    );
    expect(viewer.body.capabilities).toEqual(
      expect.objectContaining({
        viewAnalytics: true,
        editWebsite: false,
        manageMembers: false,
      }),
    );
    expect(viewer.body.modules).toEqual(
      expect.objectContaining({
        analytics: { canView: true, canEdit: false },
        boards: { canView: true, canEdit: false },
        featureFlags: { canView: true, canEdit: false },
        experiments: { canView: true, canEdit: false },
        errors: { canView: true, canEdit: false },
        logs: { canView: true, canEdit: false },
        surveys: { canView: true, canEdit: false },
        warehouse: { canView: true, canEdit: false },
        team: { canView: true, canEdit: false },
      }),
    );
  });
});
