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
