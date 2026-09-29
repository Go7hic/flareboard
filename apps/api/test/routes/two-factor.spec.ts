import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations } from '../helpers/migrations';
import { call, createTestUser, login, postJson, testIp, totpCode } from '../helpers/auth';

/** Lets a test use the current code again (replay protection is covered on its own). */
async function forgetUsedStep(userId: string) {
  await env.DB.prepare('UPDATE user_two_factor SET last_used_step = NULL WHERE user_id = ?1').bind(userId).run();
}

async function enroll(token: string) {
  const setup = await call('/api/me/2fa/setup', token, { method: 'POST' });
  expect(setup.response.status).toBe(200);
  const secret = setup.body.secret as string;
  expect(setup.body.otpauthUri).toContain(`secret=${secret}`);
  const enable = await call('/api/me/2fa/enable', token, {
    method: 'POST',
    body: JSON.stringify({ code: await totpCode(secret) }),
  });
  expect(enable.response.status).toBe(200);
  return { secret, recoveryCodes: enable.body.recoveryCodes as string[] };
}

async function auditActions(userId: string) {
  const rows = await env.DB.prepare(`SELECT entity_type || '.' || action AS a, metadata FROM audit_log WHERE user_id = ?1 ORDER BY created_at`)
    .bind(userId)
    .all<{ a: string; metadata: string | null }>();
  return rows.results;
}

describe('two-factor authentication', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('enrolls with a TOTP code and then steps up sign-in with a short-lived challenge', async () => {
    const userId = await createTestUser('tfa-alice', 'alice-password');
    const first = await login('tfa-alice', 'alice-password');
    expect(first.response.status).toBe(200);
    expect(first.token).toBeTruthy();
    const token = first.token!;

    const before = await call('/api/me/2fa', token);
    expect(before.body).toMatchObject({ enabled: false, pending: false });

    // A wrong first code does not turn anything on.
    await call('/api/me/2fa/setup', token, { method: 'POST' });
    const wrong = await call('/api/me/2fa/enable', token, { method: 'POST', body: JSON.stringify({ code: '000000' }) });
    expect(wrong.response.status).toBe(400);
    expect(wrong.body.code).toBe('invalid_code');
    expect((await call('/api/me/2fa', token)).body).toMatchObject({ enabled: false, pending: true });

    const { secret, recoveryCodes } = await enroll(token);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);

    const status = await call('/api/me/2fa', token);
    expect(status.body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
    expect((await call('/api/me', token)).body.twoFactorEnabled).toBe(true);

    // Stored: an encrypted secret and hashed codes, never the plaintext.
    const row = await env.DB.prepare('SELECT secret_enc AS s FROM user_two_factor WHERE user_id = ?1').bind(userId).first<{ s: string }>();
    expect(row?.s).not.toContain(secret);
    const hashes = await env.DB.prepare('SELECT code_hash AS h FROM user_recovery_code WHERE user_id = ?1').bind(userId).all<{ h: string }>();
    expect(hashes.results).toHaveLength(10);
    for (const { h } of hashes.results) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(recoveryCodes.some((code) => h.includes(code.replace('-', '')))).toBe(false);
    }

    // Password alone now yields a challenge, not a session.
    const stepUp = await login('tfa-alice', 'alice-password');
    expect(stepUp.response.status).toBe(200);
    expect(stepUp.body.twoFactorRequired).toBe(true);
    expect(stepUp.token).toBeNull();
    const challenge = stepUp.body.challenge as string;

    // The challenge is not a session token.
    expect((await call('/api/me', challenge)).response.status).toBe(401);

    const ip = testIp();
    const bad = await postJson('/api/auth/login/2fa', { challenge, code: '123456' }, { ip });
    expect(bad.response.status).toBe(401);
    expect(bad.body.code).toBe('invalid_code');

    // The enrollment code's step was used, so the next step's code is required (replay guard).
    const replay = await postJson('/api/auth/login/2fa', { challenge, code: await totpCode(secret) }, { ip });
    expect(replay.response.status).toBe(401);

    const ok = await postJson('/api/auth/login/2fa', { challenge, code: await totpCode(secret, 1) }, { ip });
    expect(ok.response.status).toBe(200);
    expect(ok.token).toBeTruthy();
    expect((await call('/api/me', ok.token!)).response.status).toBe(200);

    // A used challenge cannot mint a second session.
    await forgetUsedStep(userId);
    const reuse = await postJson('/api/auth/login/2fa', { challenge, code: await totpCode(secret) }, { ip });
    expect(reuse.response.status).toBe(401);
    expect(reuse.body.code).toBe('challenge_expired');

    const actions = (await auditActions(userId)).map((row) => row.a);
    expect(actions).toContain('two_factor.enable');
    expect(actions).toContain('user.login_failed');
    const logins = (await auditActions(userId)).filter((row) => row.a === 'user.login');
    expect(JSON.parse(logins.at(-1)!.metadata!)).toMatchObject({ method: 'password', twoFactor: true });
    for (const { metadata } of await auditActions(userId)) expect(metadata ?? '').not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('accepts each recovery code once and reports how many are left', async () => {
    const userId = await createTestUser('tfa-bob', 'bob-password');
    const token = (await login('tfa-bob', 'bob-password')).token!;
    const { recoveryCodes } = await enroll(token);

    const challenge = (await login('tfa-bob', 'bob-password')).body.challenge as string;
    const used = await postJson('/api/auth/login/2fa', { challenge, code: recoveryCodes[0]!.toUpperCase() });
    expect(used.response.status).toBe(200);
    expect(used.body.recoveryCodesRemaining).toBe(9);

    const again = (await login('tfa-bob', 'bob-password')).body.challenge as string;
    const reused = await postJson('/api/auth/login/2fa', { challenge: again, code: recoveryCodes[0] });
    expect(reused.response.status).toBe(401);

    const actions = (await auditActions(userId)).map((row) => row.a);
    expect(actions).toContain('two_factor.recovery_code_used');

    // Regenerating replaces every code.
    await forgetUsedStep(userId);
    const regenerated = await call('/api/me/2fa/recovery-codes', used.token!, {
      method: 'POST',
      body: JSON.stringify({ code: recoveryCodes[1] }),
    });
    expect(regenerated.response.status).toBe(200);
    expect(regenerated.body.recoveryCodes).toHaveLength(10);
    const stale = (await login('tfa-bob', 'bob-password')).body.challenge as string;
    expect((await postJson('/api/auth/login/2fa', { challenge: stale, code: recoveryCodes[2] })).response.status).toBe(401);
  });

  it('rejects expired, forged or session tokens as challenges', async () => {
    const forged = await postJson('/api/auth/login/2fa', { challenge: 'not-a-token', code: '123456' });
    expect(forged.response.status).toBe(401);
    expect(forged.body.code).toBe('challenge_expired');

    await createTestUser('tfa-session', 'session-password');
    const sessionToken = (await login('tfa-session', 'session-password')).token!;
    const asChallenge = await postJson('/api/auth/login/2fa', { challenge: sessionToken, code: '123456' });
    expect(asChallenge.body.code).toBe('challenge_expired');
  });

  it('locks second-factor attempts after repeated wrong codes', async () => {
    await createTestUser('tfa-carol', 'carol-password');
    const token = (await login('tfa-carol', 'carol-password')).token!;
    const { secret } = await enroll(token);
    const challenge = (await login('tfa-carol', 'carol-password')).body.challenge as string;

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await postJson('/api/auth/login/2fa', { challenge, code: '000000' }, { ip: testIp() })).response.status);
    }
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses.at(-1)).toBe(429);

    // Even the right code waits out the lock.
    const locked = await postJson('/api/auth/login/2fa', { challenge, code: await totpCode(secret, 1) }, { ip: testIp() });
    expect(locked.response.status).toBe(429);
    expect(Number(locked.response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('turns off only with the password and a current code', async () => {
    const userId = await createTestUser('tfa-dave', 'dave-password');
    const token = (await login('tfa-dave', 'dave-password')).token!;
    const { secret } = await enroll(token);
    await forgetUsedStep(userId);

    const noPassword = await call('/api/me/2fa/disable', token, {
      method: 'POST',
      body: JSON.stringify({ code: await totpCode(secret) }),
    });
    expect(noPassword.response.status).toBe(401);
    expect(noPassword.body.code).toBe('invalid_password');

    const noCode = await call('/api/me/2fa/disable', token, {
      method: 'POST',
      body: JSON.stringify({ password: 'dave-password', code: '000000' }),
    });
    expect(noCode.response.status).toBe(401);
    expect(noCode.body.code).toBe('invalid_code');

    const off = await call('/api/me/2fa/disable', token, {
      method: 'POST',
      body: JSON.stringify({ password: 'dave-password', code: await totpCode(secret) }),
    });
    expect(off.response.status).toBe(200);
    expect((await call('/api/me/2fa', token)).body.enabled).toBe(false);
    const recovery = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_recovery_code WHERE user_id = ?1').bind(userId).first<{ n: number }>();
    expect(recovery?.n).toBe(0);

    // Password sign-in is back to one step.
    expect((await login('tfa-dave', 'dave-password')).token).toBeTruthy();
    expect((await auditActions(userId)).map((row) => row.a)).toContain('two_factor.disable');
  });

  it('leaves personal API keys working, and keeps them away from 2FA settings', async () => {
    await createTestUser('tfa-erin', 'erin-password');
    const token = (await login('tfa-erin', 'erin-password')).token!;
    const key = await call('/api/me/api-keys', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'CI', scopes: ['read', 'write'] }),
    });
    expect(key.response.status).toBe(201);
    await enroll(token);

    expect((await call('/api/me', key.body.key as string)).response.status).toBe(200);
    expect((await call('/api/me/2fa', key.body.key as string)).response.status).toBe(403);
    expect((await call('/api/me/2fa/disable', key.body.key as string, { method: 'POST', body: '{}' })).response.status).toBe(403);
    expect((await call('/api/me/sessions', key.body.key as string)).response.status).toBe(403);
  });

  it('steps up OAuth sign-ins through the code exchange', async () => {
    const userId = await createTestUser('tfa-oauth', 'oauth-password');
    const token = (await login('tfa-oauth', 'oauth-password')).token!;
    await enroll(token);
    // What the callback stores for an account with 2FA (see handleOAuthCallback).
    const { createLoginChallenge } = await import('../../src/lib/login-challenge');
    const challenge = await createLoginChallenge(env, env.APP_SECRET, userId, 'google');
    await env.CACHE.put('oauth-code:tfa-code', JSON.stringify({ challenge }), { expirationTtl: 60 });

    const exchange = await postJson('/api/auth/oauth/exchange', { code: 'tfa-code' });
    expect(exchange.response.status).toBe(200);
    expect(exchange.body).toEqual({ twoFactorRequired: true, challenge });
    expect(exchange.token).toBeNull();
  });
});
