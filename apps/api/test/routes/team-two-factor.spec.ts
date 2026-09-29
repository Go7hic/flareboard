import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations } from '../helpers/migrations';
import { call, createTestUser, login, totpCode } from '../helpers/auth';

async function enroll(token: string) {
  const setup = await call('/api/me/2fa/setup', token, { method: 'POST' });
  const secret = setup.body.secret as string;
  const enable = await call('/api/me/2fa/enable', token, { method: 'POST', body: JSON.stringify({ code: await totpCode(secret) }) });
  expect(enable.response.status).toBe(200);
  return secret;
}

async function websiteIds(token: string) {
  const list = await call('/api/websites', token);
  const body = list.body as unknown;
  const items = (Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])) as Array<{ id?: string; websiteId?: string }>;
  return items.map((item) => item.id ?? item.websiteId);
}

describe('team two-factor requirement', () => {
  let ownerToken = '';
  let memberToken = '';
  let memberId = '';
  let teamId = '';
  let siteId = '';
  let ownerSecret = '';

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await createTestUser('team2fa-owner', 'owner-password');
    memberId = await createTestUser('team2fa-member', 'member-password');
    ownerToken = (await login('team2fa-owner', 'owner-password')).token!;
    memberToken = (await login('team2fa-member', 'member-password')).token!;

    const team = await call('/api/teams', ownerToken, { method: 'POST', body: JSON.stringify({ name: 'Secure team' }) });
    teamId = team.body.id as string;
    const join = await call('/api/teams/join', memberToken, {
      method: 'POST',
      body: JSON.stringify({ accessCode: team.body.accessCode }),
    });
    expect(join.response.status).toBe(201);
    const site = await call(`/api/teams/${teamId}/websites`, ownerToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Team site', domain: 'team2fa.example' }),
    });
    siteId = site.body.id as string;
  });

  it('only lets an owner who uses 2FA turn the requirement on', async () => {
    const withoutOwn2fa = await call(`/api/teams/${teamId}`, ownerToken, {
      method: 'PATCH',
      body: JSON.stringify({ requireTwoFactor: true }),
    });
    expect(withoutOwn2fa.response.status).toBe(409);
    expect(withoutOwn2fa.body.code).toBe('owner_two_factor_required');

    ownerSecret = await enroll(ownerToken);
    const on = await call(`/api/teams/${teamId}`, ownerToken, { method: 'PATCH', body: JSON.stringify({ requireTwoFactor: true }) });
    expect(on.response.status).toBe(200);
    expect(on.body.requireTwoFactor).toBe(true);
  });

  it('locks members without 2FA out of the team and asks them to enroll', async () => {
    expect((await call(`/api/teams/${teamId}`, memberToken)).response.status).toBe(404);
    expect((await call(`/api/websites/${siteId}`, memberToken)).response.status).toBe(404);
    expect(await websiteIds(memberToken)).not.toContain(siteId);

    const me = await call('/api/me', memberToken);
    expect(me.body.twoFactorEnabled).toBe(false);
    expect(me.body.twoFactorRequiredBy).toEqual([{ id: teamId, name: 'Secure team' }]);

    const teams = await call('/api/teams', memberToken);
    expect((teams.body as unknown as Array<{ id: string; requireTwoFactor: boolean }>).find((t) => t.id === teamId)?.requireTwoFactor).toBe(true);

    const status = await call(`/api/teams/${teamId}/status`, ownerToken);
    expect(status.body.requireTwoFactor).toBe(true);
    expect(status.body.canManageSecurity).toBe(true);
    const member = (status.body.members as Array<{ userId: string; twoFactorEnabled: boolean }>).find((m) => m.userId === memberId);
    expect(member?.twoFactorEnabled).toBe(false);
  });

  it('restores access once the member enrolls', async () => {
    await enroll(memberToken);
    expect((await call(`/api/teams/${teamId}`, memberToken)).response.status).toBe(200);
    expect(await websiteIds(memberToken)).toContain(siteId);
    expect((await call('/api/me', memberToken)).body.twoFactorRequiredBy).toEqual([]);
  });

  it('keeps an owner from disabling 2FA while their team requires it', async () => {
    await env.DB.prepare(
      `UPDATE user_two_factor SET last_used_step = NULL WHERE user_id = (SELECT user_id FROM user WHERE username = 'team2fa-owner')`,
    ).run();
    const blocked = await call('/api/me/2fa/disable', ownerToken, {
      method: 'POST',
      body: JSON.stringify({ password: 'owner-password', code: await totpCode(ownerSecret) }),
    });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body.code).toBe('team_requires_two_factor');
    expect((await call('/api/me/2fa', ownerToken)).body.enabled).toBe(true);
  });

  it('shows team activity to owners only, including membership and settings changes', async () => {
    const role = await call(`/api/teams/${teamId}/users/${memberId}`, ownerToken, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'team-member' }),
    });
    expect(role.response.status).toBe(200);

    const log = await call(`/api/teams/${teamId}/audit-log`, ownerToken);
    expect(log.response.status).toBe(200);
    const actions = (log.body.items as Array<{ action: string; entityType: string; metadata: Record<string, unknown> }>).map(
      (item) => `${item.entityType}.${item.action}`,
    );
    expect(actions).toEqual(expect.arrayContaining(['team.create', 'team.member_join', 'team.update', 'team.member_role_change']));
    const change = (log.body.items as Array<{ action: string; metadata: Record<string, unknown> }>).find(
      (item) => item.action === 'member_role_change',
    );
    expect(change?.metadata).toMatchObject({ userId: memberId, previousRole: 'team-view-only', role: 'team-member' });

    expect((await call(`/api/teams/${teamId}/audit-log`, memberToken)).response.status).toBe(404);
  });
});
