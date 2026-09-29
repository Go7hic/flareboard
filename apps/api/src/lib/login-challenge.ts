import { createSecureToken, parseSecureToken } from '@flareboard/shared';
import type { Env } from '../env';
import { getTokenVersion } from './auth-token';
import { randomToken } from './security-crypto';
import type { SessionMethod } from './user-sessions';

/** How long the user has to enter their second factor after the password (or OAuth) step. */
export const CHALLENGE_TTL_SEC = 5 * 60;
const usedKey = (jti: string) => `login-challenge-used:${jti}`;
const METHODS: readonly SessionMethod[] = ['password', 'google', 'github', 'sso', 'email'];

export type LoginChallenge = { userId: string; method: SessionMethod; jti: string };

/**
 * A short-lived encrypted token proving the first factor passed. It carries no `userId`/`role`
 * claims, so the session middleware never accepts it as a session, and it is bound to the
 * token version so a password reset in between voids it.
 */
export async function createLoginChallenge(env: Env, secret: string, userId: string, method: SessionMethod) {
  const tv = await getTokenVersion(env, userId);
  return createSecureToken({ mfa: userId, m: method, tv, jti: randomToken(12) }, secret, `${CHALLENGE_TTL_SEC}s`);
}

export async function readLoginChallenge(env: Env, secret: string, token: unknown): Promise<LoginChallenge | null> {
  if (typeof token !== 'string' || !token || token.length > 4096) return null;
  const payload = await parseSecureToken(token, secret);
  if (!payload || typeof payload.mfa !== 'string' || typeof payload.jti !== 'string') return null;
  const method = METHODS.find((candidate) => candidate === payload.m);
  if (!method) return null;
  const tv = typeof payload.tv === 'number' ? payload.tv : 0;
  if ((await getTokenVersion(env, payload.mfa)) !== tv) return null;
  if (await env.CACHE.get(usedKey(payload.jti))) return null;
  return { userId: payload.mfa, method, jti: payload.jti };
}

export async function markLoginChallengeUsed(env: Env, jti: string) {
  await env.CACHE.put(usedKey(jti), '1', { expirationTtl: CHALLENGE_TTL_SEC + 60 });
}
