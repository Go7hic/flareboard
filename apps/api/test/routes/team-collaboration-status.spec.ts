import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const TEAM_ID = 'collab-team';
const OWNER_ID = 'collab-owner';
const MEMBER_ID = 'collab-member';
const VIEWER_ID = 'collab-viewer';
const BASE = Date.UTC(2026, 0, 26, 12);

async function authHeader(userId: string) {
  const token = await createSecureToken({ userId, role: ROLES.user }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function seedCollaborationFixture() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
     VALUES
       (?1, 'collab-owner', 'hash', ?4, ?5, ?5),
       (?2, 'collab-member', 'hash', ?4, ?5, ?5),
       (?3, 'collab-viewer', 'hash', ?4, ?5, ?5)`,
  )
    .bind(OWNER_ID, MEMBER_ID, VIEWER_ID, ROLES.user, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at)
     VALUES (?1, 'Collab Team', 'collabcode', ?2, ?2)`,
  )
    .bind(TEAM_ID, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
     VALUES
       ('collab-owner-membership', ?1, ?2, ?5, ?8, ?8),
       ('collab-member-membership', ?1, ?3, ?6, ?8, ?8),
       ('collab-viewer-membership', ?1, ?4, ?7, ?8, ?8)`,
  )
    .bind(TEAM_ID, OWNER_ID, MEMBER_ID, VIEWER_ID, ROLES.teamOwner, ROLES.teamMember, ROLES.teamViewOnly, BASE)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_at, updated_at)
     VALUES
       ('collab-website-a', 'Collab A', 'a.collab.example.com', ?2, ?1, ?3, ?3),
       ('collab-website-b', 'Collab B', 'b.collab.example.com', ?2, ?1, ?3, ?3)`,
  )
    .bind(TEAM_ID, OWNER_ID, BASE)
    .run();
}

describe('team collaboration status route', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedCollaborationFixture();
  });

  it('summarizes team collaboration status for managers and viewers', async () => {
    const ownerStatus = await fetchWorkerJson<{
      teamId: string;
      currentUserRole: string;
      canManageMembers: boolean;
      memberCount: number;
      editableMemberCount: number;
      readonlyMemberCount: number;
      websiteCount: number;
      roles: Record<string, number>;
    }>(`/api/teams/${TEAM_ID}/status`, {
      headers: await authHeader(OWNER_ID),
    });

    expect(ownerStatus.response.status).toBe(200);
    expect(ownerStatus.body).toEqual(
      expect.objectContaining({
        teamId: TEAM_ID,
        currentUserRole: ROLES.teamOwner,
        canManageMembers: true,
        memberCount: 3,
        editableMemberCount: 2,
        readonlyMemberCount: 1,
        websiteCount: 2,
      }),
    );
    expect(ownerStatus.body.roles).toEqual(
      expect.objectContaining({
        [ROLES.teamOwner]: 1,
        [ROLES.teamMember]: 1,
        [ROLES.teamViewOnly]: 1,
      }),
    );

    const viewerStatus = await fetchWorkerJson<{ canManageMembers: boolean; currentUserRole: string }>(
      `/api/teams/${TEAM_ID}/status`,
      {
        headers: await authHeader(VIEWER_ID),
      },
    );

    expect(viewerStatus.response.status).toBe(200);
    expect(viewerStatus.body).toEqual(
      expect.objectContaining({
        currentUserRole: ROLES.teamViewOnly,
        canManageMembers: false,
      }),
    );
  });
});
