import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { passwordLockStatus, recordPasswordFailure } from '../../src/lib/login-guard';
import { applyTestMigrations } from '../helpers/migrations';
import { createTestUser, login, testIp } from '../helpers/auth';

describe('login hardening', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('answers unknown accounts and wrong passwords with the same generic error', async () => {
    await createTestUser('lock-generic', 'right-password');
    const unknown = await login('lock-nobody', 'whatever');
    const wrong = await login('lock-generic', 'wrong-password');
    expect(unknown.response.status).toBe(401);
    expect(wrong.response.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual({ message: 'Invalid username or password' });
  });

  it('locks an account after repeated failures, from any IP, with backoff', async () => {
    const userId = await createTestUser('lock-account', 'right-password');
    const statuses: number[] = [];
    // Every attempt from a different address: the account lock must still hold.
    for (let i = 0; i < 5; i++) statuses.push((await login('lock-account', 'wrong-password', { ip: testIp() })).response.status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);

    const locked = await login('LOCK-ACCOUNT', 'right-password', { ip: testIp() });
    expect(locked.response.status).toBe(429);
    expect(locked.token).toBeNull();
    expect(Number(locked.response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(Number(locked.response.headers.get('Retry-After'))).toBeLessThanOrEqual(30);

    const failed = await env.DB.prepare(`SELECT metadata FROM audit_log WHERE user_id = ?1 AND action = 'login_failed'`)
      .bind(userId)
      .all<{ metadata: string }>();
    expect(failed.results).toHaveLength(5);
    for (const row of failed.results) expect(JSON.parse(row.metadata)).toEqual({ reason: 'password' });
  });

  it('clears the failure count after a successful sign-in', async () => {
    await createTestUser('lock-reset', 'right-password');
    for (let i = 0; i < 4; i++) await login('lock-reset', 'wrong-password');
    expect((await login('lock-reset', 'right-password')).response.status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await login('lock-reset', 'wrong-password')).response.status).toBe(401);
    }
  });

  it('backs off one address that sprays many accounts', async () => {
    // Driven through the guard directly: over HTTP the 10-per-minute request cap answers first.
    const ip = testIp();
    for (let i = 0; i < 19; i++) await recordPasswordFailure(env, env.APP_SECRET, `spray-${i}`, ip);
    expect((await passwordLockStatus(env, env.APP_SECRET, 'spray-fresh', ip)).locked).toBe(false);
    const after = await recordPasswordFailure(env, env.APP_SECRET, 'spray-19', ip);
    expect(after).toMatchObject({ locked: true });
    expect(after.retryAfterSec).toBeGreaterThan(30);
    expect((await passwordLockStatus(env, env.APP_SECRET, 'spray-fresh', ip)).locked).toBe(true);
    expect((await passwordLockStatus(env, env.APP_SECRET, 'spray-fresh', testIp())).locked).toBe(false);
  });

  it('keeps no IP address or account name in the lockout keys', async () => {
    const seen: string[] = [];
    const namespace = {
      idFromName: (name: string) => {
        seen.push(name);
        return env.RATE_LIMITER.idFromName(name);
      },
      get: (id: DurableObjectId) => env.RATE_LIMITER.get(id),
    } as unknown as DurableObjectNamespace;
    await recordPasswordFailure({ ...env, RATE_LIMITER: namespace }, env.APP_SECRET, 'someone@example.com', '192.0.2.44');
    expect(seen).toHaveLength(2);
    for (const name of seen) {
      expect(name).not.toContain('192.0.2.44');
      expect(name).not.toContain('someone');
      expect(name).toMatch(/^lockout:(account|ip):[0-9a-f]{64}$/);
    }
  });
});
