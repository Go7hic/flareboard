import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations } from '../helpers/migrations';
import { call, CHROME_MAC, createTestUser, FIREFOX_LINUX, login, postJson } from '../helpers/auth';

type SessionRow = { id: string; device: string | null; method: string; current: boolean; createdAt: number; lastSeenAt: number };

describe('session management', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('lists sessions with a coarse device label and no IP address', async () => {
    const userId = await createTestUser('sess-list', 'list-password');
    const mac = (await login('sess-list', 'list-password', { ua: CHROME_MAC, ip: '203.0.113.7' })).token!;
    await login('sess-list', 'list-password', { ua: FIREFOX_LINUX, ip: '198.51.100.9' });

    const list = await call('/api/me/sessions', mac);
    const rows = list.body as unknown as SessionRow[];
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.current)?.device).toBe('Chrome on macOS');
    expect(rows.find((row) => !row.current)?.device).toBe('Firefox on Linux');
    expect(rows.every((row) => row.method === 'password')).toBe(true);

    const stored = await env.DB.prepare('SELECT * FROM user_session WHERE user_id = ?1').bind(userId).all();
    const dump = JSON.stringify(stored.results);
    expect(dump).not.toContain('203.0.113.7');
    expect(dump).not.toContain('Mozilla');
  });

  it('revokes a single other session', async () => {
    await createTestUser('sess-one', 'one-password');
    const keep = (await login('sess-one', 'one-password')).token!;
    const drop = (await login('sess-one', 'one-password')).token!;
    const target = ((await call('/api/me/sessions', keep)).body as unknown as SessionRow[]).find((row) => !row.current)!;

    const revoked = await call(`/api/me/sessions/${target.id}`, keep, { method: 'DELETE' });
    expect(revoked.response.status).toBe(200);
    expect((await call('/api/me', drop)).response.status).toBe(401);
    expect((await call('/api/me', keep)).response.status).toBe(200);
    expect((await call(`/api/me/sessions/${target.id}`, keep, { method: 'DELETE' })).response.status).toBe(404);
  });

  it('cannot revoke another user’s session', async () => {
    await createTestUser('sess-mallory', 'mallory-password');
    await createTestUser('sess-victim', 'victim-password');
    const mallory = (await login('sess-mallory', 'mallory-password')).token!;
    const victim = (await login('sess-victim', 'victim-password')).token!;
    const victimSession = ((await call('/api/me/sessions', victim)).body as unknown as SessionRow[])[0]!;
    expect((await call(`/api/me/sessions/${victimSession.id}`, mallory, { method: 'DELETE' })).response.status).toBe(404);
    expect((await call('/api/me', victim)).response.status).toBe(200);
  });

  it('signs out all other sessions and keeps this one with a fresh token', async () => {
    const userId = await createTestUser('sess-all', 'all-password');
    const current = (await login('sess-all', 'all-password')).token!;
    const otherA = (await login('sess-all', 'all-password')).token!;
    const otherB = (await login('sess-all', 'all-password')).token!;

    const result = await call('/api/me/sessions/revoke-others', current, { method: 'POST' });
    expect(result.response.status).toBe(200);
    expect(result.body.revoked).toBe(2);
    expect(result.token).toBeTruthy();

    expect((await call('/api/me', otherA)).response.status).toBe(401);
    expect((await call('/api/me', otherB)).response.status).toBe(401);
    const sessions = (await call('/api/me/sessions', result.token!)).body as unknown as SessionRow[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.current).toBe(true);

    const audit = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?1 AND entity_type = 'session' AND action = 'revoke_others'`)
      .bind(userId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('a password change signs out other sessions but not this one', async () => {
    const userId = await createTestUser('sess-pw', 'old-password');
    const here = (await login('sess-pw', 'old-password')).token!;
    const elsewhere = (await login('sess-pw', 'old-password')).token!;

    const changed = await call('/api/me/password', here, {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password' }),
    });
    expect(changed.response.status).toBe(200);
    expect(changed.token).toBeTruthy();
    expect((await call('/api/me', elsewhere)).response.status).toBe(401);
    expect((await call('/api/me', changed.token!)).response.status).toBe(200);
    expect(((await call('/api/me/sessions', changed.token!)).body as unknown as SessionRow[]).length).toBe(1);

    const audit = await env.DB.prepare(`SELECT metadata FROM audit_log WHERE user_id = ?1 AND action = 'password_change'`)
      .bind(userId)
      .first<{ metadata: string }>();
    expect(JSON.parse(audit!.metadata)).toEqual({ sessionsRevoked: 1 });
  });

  it('logout ends only the current session', async () => {
    await createTestUser('sess-out', 'out-password');
    const leaving = (await login('sess-out', 'out-password')).token!;
    const staying = (await login('sess-out', 'out-password')).token!;

    const out = await postJson('/api/auth/logout', {}, { token: leaving });
    expect(out.response.status).toBe(200);
    expect((await call('/api/me', leaving)).response.status).toBe(401);
    expect((await call('/api/me', staying)).response.status).toBe(200);
  });

  it('records activity in the account audit log', async () => {
    await createTestUser('sess-audit', 'audit-password');
    const token = (await login('sess-audit', 'audit-password', { ua: CHROME_MAC })).token!;
    const log = await call('/api/me/audit-log?page=1&pageSize=10', token);
    expect(log.response.status).toBe(200);
    const login_ = (log.body.items as Array<{ action: string; entityType: string; metadata: Record<string, unknown> }>).find(
      (item) => item.action === 'login',
    );
    expect(login_).toMatchObject({ entityType: 'user', metadata: { method: 'password', twoFactor: false, device: 'Chrome on macOS' } });
  });
});
