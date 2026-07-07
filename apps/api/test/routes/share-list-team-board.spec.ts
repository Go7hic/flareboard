import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ENTITY_TYPE, ROLES } from '@flareboard/shared';
import { fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations } from '../helpers/migrations';

const TEAM_ID = 'share-list-team';
const OWNER_ID = 'share-list-owner';
const MEMBER_ID = 'share-list-member';
const BOARD_ID = '00000000-0000-0000-0000-00000000c001';
const SHARE_ID = '00000000-0000-0000-0000-00000000c002';
const BASE = Date.UTC(2026, 0, 27, 12);

async function authHeader(userId: string) {
  const token = await createSecureToken({ userId, role: ROLES.user }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function seedTeamBoardShareFixture() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
     VALUES (?1, 'share-list-owner', 'hash', ?3, ?4, ?4), (?2, 'share-list-member', 'hash', ?3, ?4, ?4)`,
  )
    .bind(OWNER_ID, MEMBER_ID, ROLES.user, BASE)
    .run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at)
     VALUES (?1, 'Share List Team', 'sharelistcode', ?2, ?2)`,
  )
    .bind(TEAM_ID, BASE)
    .run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at)
     VALUES
       ('share-list-owner-membership', ?1, ?2, ?4, ?5, ?5),
       ('share-list-member-membership', ?1, ?3, ?6, ?5, ?5)`,
  )
    .bind(TEAM_ID, OWNER_ID, MEMBER_ID, ROLES.teamOwner, BASE, ROLES.teamMember)
    .run();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO board
      (board_id, type, name, description, parameters, user_id, team_id, created_at, updated_at)
     VALUES (?1, 'dashboard', 'Team board', '', '{}', ?2, ?3, ?4, ?4)`,
  )
    .bind(BOARD_ID, OWNER_ID, TEAM_ID, BASE)
    .run();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO share
      (share_id, entity_id, name, share_type, slug, parameters, created_at, updated_at)
     VALUES (?1, ?2, 'Team board share', ?3, 'teamboardshare', '{}', ?4, ?4)`,
  )
    .bind(SHARE_ID, BOARD_ID, ENTITY_TYPE.board, BASE)
    .run();
}

describe('authenticated share list', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTeamBoardShareFixture();
  });

  it('includes shares for team boards the member can access', async () => {
    const { response, body } = await fetchWorkerJson<Array<{ id: string; entityId: string }>>('/api/share', {
      headers: await authHeader(MEMBER_ID),
    });

    expect(response.status).toBe(200);
    expect(body.some((share) => share.id === SHARE_ID && share.entityId === BOARD_ID)).toBe(true);
  });
});
