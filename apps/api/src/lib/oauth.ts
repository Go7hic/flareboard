import { hashPassword, ROLES, uuid } from '@flareboard/shared';
import { createDb, schema } from '@flareboard/db';
import type { Env } from '../env';
import { getUserById, getUserByUsername } from './queries';

export type OAuthProvider = 'google' | 'github';

const OAUTH_STATE_TTL = 600;

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
  data: { provider: OAuthProvider; returnTo?: string },
) {
  await env.CACHE.put(`oauth:state:${state}`, JSON.stringify(data), { expirationTtl: OAUTH_STATE_TTL });
}

export async function consumeOAuthState(env: Env, state: string) {
  const key = `oauth:state:${state}`;
  const raw = await env.CACHE.get(key);
  if (!raw) return null;
  await env.CACHE.delete(key);
  try {
    return JSON.parse(raw) as { provider: OAuthProvider; returnTo?: string };
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

async function linkOAuthUser(env: Env, provider: OAuthProvider, profile: { id: string; username: string }) {
  const linkKey = `oauth:${provider}:${profile.id}`;
  const linkedUserId = await env.CACHE.get(linkKey);
  if (linkedUserId) {
    const user = await getUserById(env, linkedUserId);
    if (user) return user;
  }

  let user = await getUserByUsername(env, profile.username);
  if (!user) {
    const userId = uuid();
    const now = new Date();
    const db = createDb(env.DB);
    const randomPass = crypto.randomUUID();
    await db.insert(schema.user).values({
      userId,
      username: profile.username,
      password: hashPassword(randomPass),
      role: ROLES.user,
      createdAt: now,
      updatedAt: now,
    });
    user = await getUserById(env, userId);
    await env.CACHE.put(linkKey, userId, { expirationTtl: 60 * 60 * 24 * 365 });
  } else {
    await env.CACHE.put(linkKey, user.userId, { expirationTtl: 60 * 60 * 24 * 365 });
  }

  return user;
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

  const user = await linkOAuthUser(env, providerParam, profile);
  if (!user) return { error: 'User creation failed' as const };

  return { user, returnTo: stored.returnTo };
}

export { isProvider };
