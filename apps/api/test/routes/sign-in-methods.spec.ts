import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations } from '../helpers/migrations';
import { call, createTestUser, login } from '../helpers/auth';

async function link(userId: string, provider: string, providerUserId: string, at = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO user_oauth_identity (provider, provider_user_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(provider, providerUserId, userId, at)
    .run();
}

/** Signs in with the password set up by createTestUser. */
async function tokenFor(username: string, password: string) {
  const { token } = await login(username, password);
  if (!token) throw new Error(`could not sign in as ${username}`);
  return token;
}

describe('sign-in methods', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('linking GitHub to an account with a password keeps asking for that password', async () => {
    const userId = await createTestUser('linked-keeps-password', 'correct horse');
    const token = await tokenFor('linked-keeps-password', 'correct horse');
    // Linked an hour after the account was made: the user chose to add it.
    await link(userId, 'github', 'gh-keep', Date.now() + 3_600_000);

    const me = await call('/api/me', token);
    expect(me.body.passwordRequired).toBe(true);

    const withoutPassword = await call('/api/me/delete', token, {
      method: 'POST',
      body: JSON.stringify({ confirm: 'linked-keeps-password' }),
    });
    expect(withoutPassword.response.status).toBe(401);
  });

  it('lists linked accounts and unlinks one when a password remains', async () => {
    const userId = await createTestUser('unlink-with-password', 'correct horse');
    const token = await tokenFor('unlink-with-password', 'correct horse');
    await link(userId, 'github', 'gh-unlink', Date.now() + 3_600_000);
    await env.CACHE.put('oauth:github:gh-unlink', userId);

    const listed = await call('/api/me/identities', token);
    expect(listed.body).toEqual([{ provider: 'github', linkedAt: expect.any(Number) }]);

    const unlinked = await call('/api/me/identities/github', token, { method: 'DELETE' });
    expect(unlinked.response.status).toBe(200);
    expect((await call('/api/me/identities', token)).body).toEqual([]);
    // The legacy KV link is gone too, so the next GitHub sign-in cannot revive it.
    expect(await env.CACHE.get('oauth:github:gh-unlink')).toBeNull();

    expect((await call('/api/me/identities/github', token, { method: 'DELETE' })).response.status).toBe(404);
  });

  it('keeps the only sign-in method of an account without a password', async () => {
    const userId = await createTestUser('provider-only', 'temporary');
    const token = await tokenFor('provider-only', 'temporary');
    // What a GitHub sign-up looks like now: no password at all.
    await env.DB.prepare(`UPDATE user SET password = '' WHERE user_id = ?1`).bind(userId).run();
    await link(userId, 'github', 'gh-only');

    expect((await call('/api/me', token)).body.passwordRequired).toBe(false);
    const refused = await call('/api/me/identities/github', token, { method: 'DELETE' });
    expect(refused.response.status).toBe(409);
    expect(refused.body.code).toBe('last_sign_in_method');
    expect((await login('provider-only', '')).response.status).not.toBe(200);
  });

  it('keeps sign-in methods away from personal API keys', async () => {
    const userId = await createTestUser('identities-api-key', 'correct horse');
    const token = await tokenFor('identities-api-key', 'correct horse');
    await link(userId, 'github', 'gh-api-key', Date.now() + 3_600_000);
    const key = await call('/api/me/api-keys', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'CI', scopes: ['read', 'write'] }),
    });
    expect(key.response.status).toBe(201);

    expect((await call('/api/me/identities', key.body.key as string)).response.status).toBe(403);
    expect((await call('/api/me/identities/github', key.body.key as string, { method: 'DELETE' })).response.status).toBe(403);
    expect((await call('/api/me/identities', token)).body).toHaveLength(1);
  });

  it('still treats an account a provider created before the change as having no password', async () => {
    const userId = await createTestUser('legacy-provider-account', 'random-unknown');
    const token = await tokenFor('legacy-provider-account', 'random-unknown');
    const created = Date.UTC(2026, 9, 1);
    await env.DB.prepare(`UPDATE user SET created_at = ?2 WHERE user_id = ?1`).bind(userId, created).run();
    await link(userId, 'github', 'gh-legacy', created + 2_000);

    expect((await call('/api/me', token)).body.passwordRequired).toBe(false);
  });
});
