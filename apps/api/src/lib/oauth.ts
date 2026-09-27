import { hashPassword, ROLES, uuid } from '@flareboard/shared';
import { createDb, schema } from '@flareboard/db';
import type { Env } from '../env';
import { isHostedMode } from './billing';
import { getUserById, getUserByUsername } from './queries';

export type OAuthProvider = 'google' | 'github';

const OAUTH_STATE_TTL = 600;

type OAuthState = {
  provider: OAuthProvider;
  returnTo?: string;
  /** Set when a signed-in user starts the flow to attach this provider to their account. */
  linkUserId?: string;
};

export function getEnabledOAuthProviders(env: Env): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push('github');
  return providers;
}

function isProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'github';
}

function redirectUri(origin: string, provider: OAuthProvider) {
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

export async function storeOAuthState(
  env: Env,
  state: string,
  data: OAuthState,
) {
  await env.CACHE.put(`oauth:state:${state}`, JSON.stringify(data), { expirationTtl: OAUTH_STATE_TTL });
}

export async function consumeOAuthState(env: Env, state: string) {
  const key = `oauth:state:${state}`;
  const raw = await env.CACHE.get(key);
  if (!raw) return null;
  await env.CACHE.delete(key);
  try {
    return JSON.parse(raw) as OAuthState;
  } catch {
    return null;
  }
}

export function buildOAuthAuthorizeUrl(
  env: Env,
  provider: OAuthProvider,
  origin: string,
  state: string,
): string | null {
  const redirect = encodeURIComponent(redirectUri(origin, provider));
  const encodedState = encodeURIComponent(state);

  if (provider === 'google' && env.GOOGLE_CLIENT_ID) {
    const scope = encodeURIComponent('openid email profile');
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(env.GOOGLE_CLIENT_ID)}&redirect_uri=${redirect}&response_type=code&scope=${scope}&state=${encodedState}&access_type=online&prompt=select_account`;
  }

  if (provider === 'github' && env.GITHUB_CLIENT_ID) {
    const scope = encodeURIComponent('read:user user:email');
    return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID)}&redirect_uri=${redirect}&scope=${scope}&state=${encodedState}`;
  }

  return null;
}

async function exchangeCode(
  env: Env,
  provider: OAuthProvider,
  code: string,
  origin: string,
): Promise<{ id: string; username: string; email?: string } | null> {
  const redirect = redirectUri(origin, provider);

  if (provider === 'google' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return null;
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return null;

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!profileRes.ok) return null;
    const profile = (await profileRes.json()) as { sub?: string; email?: string; name?: string };
    if (!profile.sub) return null;
    const username = profile.email ?? `google_${profile.sub.slice(0, 12)}`;
    return { id: profile.sub, username, email: profile.email };
  }

  if (provider === 'github' && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        code,
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        redirect_uri: redirect,
      }),
    });
    if (!tokenRes.ok) return null;
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return null;

    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'flareboard-oauth',
      },
    });
    if (!profileRes.ok) return null;
    const profile = (await profileRes.json()) as { id?: number; login?: string; email?: string | null };
    if (!profile.id || !profile.login) return null;
    return {
      id: String(profile.id),
      username: profile.login,
      email: profile.email ?? undefined,
    };
  }

  return null;
}

async function findLinkedUser(env: Env, provider: OAuthProvider, providerUserId: string) {
  const row = await env.DB.prepare(
    `SELECT user_id AS userId FROM user_oauth_identity WHERE provider = ?1 AND provider_user_id = ?2`,
  )
    .bind(provider, providerUserId)
    .first<{ userId: string }>();
  if (row) return getUserById(env, row.userId);

  // Links used to live only in KV; carry a still-present one over so existing
  // OAuth users keep their account.
  const legacyUserId = await env.CACHE.get(`oauth:${provider}:${providerUserId}`);
  if (!legacyUserId) return null;
  const legacyUser = await getUserById(env, legacyUserId);
  if (legacyUser) await saveIdentity(env, provider, providerUserId, legacyUser.userId);
  return legacyUser;
}

async function saveIdentity(env: Env, provider: OAuthProvider, providerUserId: string, userId: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_oauth_identity (provider, provider_user_id, user_id, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(provider, providerUserId, userId, Date.now())
    .run();
}

/** The provider login if free, otherwise login plus a short random suffix. */
async function availableUsername(env: Env, login: string) {
  const base = login.slice(0, 40);
  if (!(await getUserByUsername(env, base))) return base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}-${crypto.randomUUID().slice(0, 6)}`;
    if (!(await getUserByUsername(env, candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID()}`;
}

type LinkResult =
  | { user: NonNullable<Awaited<ReturnType<typeof getUserById>>> }
  | { error: 'oauth_account_not_linked' | 'oauth_identity_in_use' | 'User creation failed' };

/**
 * Resolves the local user for a provider identity. Never matches on username or
 * email: a provider account that shares a name with a local user must not take it
 * over. New accounts are only created where self-registration is open (hosted).
 */
async function resolveOAuthUser(
  env: Env,
  provider: OAuthProvider,
  profile: { id: string; username: string },
  linkUserId?: string,
): Promise<LinkResult> {
  const linked = await findLinkedUser(env, provider, profile.id);

  if (linkUserId) {
    if (linked && linked.userId !== linkUserId) return { error: 'oauth_identity_in_use' };
    const user = await getUserById(env, linkUserId);
    if (!user) return { error: 'User creation failed' };
    await saveIdentity(env, provider, profile.id, user.userId);
    return { user };
  }

  if (linked) return { user: linked };
  if (!isHostedMode(env)) return { error: 'oauth_account_not_linked' };

  const userId = uuid();
  const now = new Date();
  await createDb(env.DB)
    .insert(schema.user)
    .values({
      userId,
      username: await availableUsername(env, profile.username),
      password: hashPassword(crypto.randomUUID()),
      role: ROLES.user,
      createdAt: now,
      updatedAt: now,
    });
  await saveIdentity(env, provider, profile.id, userId);
  const user = await getUserById(env, userId);
  return user ? { user } : { error: 'User creation failed' };
}

export async function handleOAuthCallbackFlow(
  env: Env,
  providerParam: string,
  code: string | null,
  state: string | null,
  origin: string,
) {
  if (!isProvider(providerParam)) return { error: 'Unknown provider' as const };
  if (!getEnabledOAuthProviders(env).includes(providerParam)) {
    return { error: 'Provider not configured' as const };
  }
  if (!code || !state) return { error: 'Missing code or state' as const };

  const stored = await consumeOAuthState(env, state);
  if (!stored || stored.provider !== providerParam) {
    return { error: 'Invalid or expired state' as const };
  }

  const profile = await exchangeCode(env, providerParam, code, origin);
  if (!profile) return { error: 'Token exchange failed' as const };

  const resolved = await resolveOAuthUser(env, providerParam, profile, stored.linkUserId);
  if ('error' in resolved) return { error: resolved.error };

  return { user: resolved.user, returnTo: stored.returnTo };
}

export { isProvider };
