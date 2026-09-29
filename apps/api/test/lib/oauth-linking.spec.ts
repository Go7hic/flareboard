import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@flareboard/shared';
import { handleOAuthCallbackFlow, storeOAuthState } from '../../src/lib/oauth';
import { applyTestMigrations } from '../helpers/migrations';

const LOCAL_ADMIN_ID = 'oauth-link-local-admin';
const LOCAL_ADMIN_NAME = 'oauth-link-admin';
const OTHER_USER_ID = 'oauth-link-other';
const NOW = Date.now();

function githubEnv(hosted: boolean) {
  return { ...env, GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', HOSTED_MODE: hosted ? 'true' : 'false' };
}

/** Stubs GitHub's token + profile endpoints to return the given account. */
function stubGithub(profile: { id: number; login: string }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('login/oauth/access_token')) return Response.json({ access_token: 'gh-token' });
    if (url.includes('api.github.com/user')) return Response.json(profile);
    return new Response('unexpected', { status: 500 });
  });
}

async function callback(testEnv: ReturnType<typeof githubEnv>, linkUserId?: string) {
  const state = crypto.randomUUID();
  await storeOAuthState(testEnv, state, { provider: 'github', linkUserId });
  return handleOAuthCallbackFlow(testEnv, 'github', 'code', state, 'https://api.example');
}

describe('OAuth account linking', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'admin', ?5, ?5), (?4, 'oauth-link-other', ?3, 'user', ?5, ?5)`,
    )
      .bind(LOCAL_ADMIN_ID, LOCAL_ADMIN_NAME, hashPassword('local-password'), OTHER_USER_ID, NOW)
      .run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('self-hosted: a provider login equal to a local username does not sign in as that user', async () => {
    stubGithub({ id: 9001, login: LOCAL_ADMIN_NAME });
    const result = await callback(githubEnv(false));
    expect(result).toEqual({ error: 'oauth_account_not_linked' });
  });

  it('hosted: a colliding login gets a new account instead of the existing one', async () => {
    stubGithub({ id: 9002, login: LOCAL_ADMIN_NAME });
    const result = await callback(githubEnv(true));
    expect('user' in result && result.user?.userId).not.toBe(LOCAL_ADMIN_ID);
    expect('user' in result && result.user?.username).toMatch(new RegExp(`^${LOCAL_ADMIN_NAME}-`));
    expect('user' in result && result.user?.role).toBe('user');
  });

  it('links an identity explicitly and then signs in with it', async () => {
    stubGithub({ id: 9003, login: 'someone-else' });
    const linked = await callback(githubEnv(false), LOCAL_ADMIN_ID);
    expect('user' in linked && linked.user?.userId).toBe(LOCAL_ADMIN_ID);

    const signIn = await callback(githubEnv(false));
    expect('user' in signIn && signIn.user?.userId).toBe(LOCAL_ADMIN_ID);
  });

  it('refuses to move an identity that is already linked to another account', async () => {
    stubGithub({ id: 9003, login: 'someone-else' });
    const result = await callback(githubEnv(false), OTHER_USER_ID);
    expect(result).toEqual({ error: 'oauth_identity_in_use' });
  });
});

describe('OAuth sign-in linked by verified email', () => {
  const VERIFIED_ID = 'oauth-email-verified';
  const UNVERIFIED_ID = 'oauth-email-unverified';

  function googleEnv() {
    return { ...env, GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', HOSTED_MODE: 'false' };
  }

  function stubGoogle(profile: { sub: string; email: string; email_verified: boolean }) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'g-token' });
      if (url.includes('googleapis.com/oauth2/v3/userinfo')) return Response.json(profile);
      return new Response('unexpected', { status: 500 });
    });
  }

  function stubGithubWithEmails(profile: { id: number; login: string }, emails: unknown[]) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('login/oauth/access_token')) return Response.json({ access_token: 'gh-token' });
      if (url.includes('api.github.com/user/emails')) return Response.json(emails);
      if (url.includes('api.github.com/user')) return Response.json(profile);
      return new Response('unexpected', { status: 500 });
    });
  }

  async function signIn(provider: 'google' | 'github', testEnv: typeof env) {
    const state = crypto.randomUUID();
    await storeOAuthState(testEnv, state, { provider });
    return handleOAuthCallbackFlow(testEnv, provider, 'code', state, 'https://api.example');
  }

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, email, email_verified_at, created_at, updated_at)
       VALUES (?1, 'verified-user', ?3, 'user', 'ada@example.com', ?4, ?4, ?4),
              (?2, 'unverified-user', ?3, 'user', 'grace@example.com', NULL, ?4, ?4)`,
    )
      .bind(VERIFIED_ID, UNVERIFIED_ID, hashPassword('pw', 4), NOW)
      .run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('links a provider whose verified email matches a verified local account', async () => {
    stubGoogle({ sub: 'g-100', email: 'ADA@example.com', email_verified: true });
    const result = await signIn('google', googleEnv());
    expect('user' in result && result.user.userId).toBe(VERIFIED_ID);
    expect('linked' in result && result.linked).toBe('email');

    // The link is durable: the next sign-in finds it without the email.
    stubGoogle({ sub: 'g-100', email: 'changed@example.com', email_verified: false });
    const again = await signIn('google', googleEnv());
    expect('user' in again && again.user.userId).toBe(VERIFIED_ID);
    expect('linked' in again && again.linked).toBeNull();
  });

  it('does not link when the provider has not verified the email', async () => {
    stubGoogle({ sub: 'g-101', email: 'ada@example.com', email_verified: false });
    expect(await signIn('google', googleEnv())).toEqual({ error: 'oauth_account_not_linked' });
  });

  it('does not link to a local account whose email is unverified', async () => {
    stubGoogle({ sub: 'g-102', email: 'grace@example.com', email_verified: true });
    expect(await signIn('google', googleEnv())).toEqual({ error: 'oauth_account_not_linked' });
  });

  it('uses only the primary verified GitHub email', async () => {
    const ghEnv = { ...env, GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', HOSTED_MODE: 'false' };
    stubGithubWithEmails({ id: 9100, login: 'ada-gh' }, [
      { email: 'ada@example.com', primary: false, verified: true },
      { email: 'other@example.com', primary: true, verified: false },
    ]);
    expect(await signIn('github', ghEnv)).toEqual({ error: 'oauth_account_not_linked' });

    stubGithubWithEmails({ id: 9101, login: 'ada-gh' }, [{ email: 'ada@example.com', primary: true, verified: true }]);
    const linked = await signIn('github', ghEnv);
    expect('user' in linked && linked.user.userId).toBe(VERIFIED_ID);
  });
});
