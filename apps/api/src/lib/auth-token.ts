import { eq, sql } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createSecureToken, parseSecureToken } from '@flareboard/shared';
import type { Env } from '../env';
import { getAppSecret } from './response';
import { createUserSession, isSessionActive, type SessionMethod } from './user-sessions';

const versionKey = (userId: string) => `token-version:${userId}`;

/**
 * Current token version for a user. Cached in KV so the per-request auth check
 * costs one KV read instead of a D1 read. A cache miss falls back to D1 and
 * repopulates. Missing users read as version 0, matching pre-migration tokens.
 */
export async function getTokenVersion(env: Env, userId: string): Promise<number> {
  const cached = await env.CACHE.get(versionKey(userId));
  if (cached !== null) return Number.parseInt(cached, 10) || 0;
  const db = createDb(env.DB);
  const [row] = await db
    .select({ version: schema.user.tokenVersion })
    .from(schema.user)
    .where(eq(schema.user.userId, userId))
    .limit(1);
  const version = row?.version ?? 0;
  await env.CACHE.put(versionKey(userId), String(version));
  return version;
}

/** Invalidates every outstanding token for a user (password change, sign out everywhere). */
export async function bumpTokenVersion(env: Env, userId: string): Promise<void> {
  const db = createDb(env.DB);
  await db
    .update(schema.user)
    .set({ tokenVersion: sql`${schema.user.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(schema.user.userId, userId));
  const [row] = await db
    .select({ version: schema.user.tokenVersion })
    .from(schema.user)
    .where(eq(schema.user.userId, userId))
    .limit(1);
  await env.CACHE.put(versionKey(userId), String(row?.version ?? 0));
}

/** Mints a session token for an existing session id, stamping the current token version. */
export async function issueAuthToken(
  c: { env: Env; req: { url: string } },
  user: { userId: string; role: string },
  sessionId: string,
  ttlMs?: number,
): Promise<string> {
  const tv = await getTokenVersion(c.env, user.userId);
  const expiresIn = ttlMs ? `${Math.ceil(ttlMs / 1000)}s` : undefined;
  return createSecureToken({ userId: user.userId, role: user.role, tv, sid: sessionId }, getAppSecret(c), expiresIn);
}

/**
 * Records a new signed-in session (listed under account security) and returns its token.
 * `ttlMs` shortens the session and its token (demo sessions); the default is SESSION_TTL_MS.
 */
export async function startSession(
  c: { env: Env; req: { url: string; header(name: string): string | undefined } },
  user: { userId: string; role: string },
  method: SessionMethod,
  options: { ttlMs?: number } = {},
) {
  const sessionId = await createUserSession(c.env, user.userId, {
    method,
    userAgent: c.req.header('User-Agent'),
    ttlMs: options.ttlMs,
  });
  return { token: await issueAuthToken(c, user, sessionId, options.ttlMs), sessionId };
}

export type VerifiedSession = { userId: string; role: string; sessionId: string | null; tokenVersion: number };

/**
 * Decrypts and checks a session token: signature and expiry, token version (password change,
 * sign out everywhere) and, for tokens that carry a session id, that the session was not
 * revoked. Tokens minted before session ids existed have no `sid` and are checked by version only.
 */
export async function verifySessionToken(env: Env, token: string, secret: string): Promise<VerifiedSession | null> {
  const payload = await parseSecureToken(token, secret);
  if (!payload?.userId || !payload?.role) return null;
  const userId = String(payload.userId);
  const tokenVersion = typeof payload.tv === 'number' ? payload.tv : 0;
  if ((await getTokenVersion(env, userId)) !== tokenVersion) return null;
  const sessionId = typeof payload.sid === 'string' ? payload.sid : null;
  if (sessionId && !(await isSessionActive(env, sessionId, userId))) return null;
  return { userId, role: String(payload.role), sessionId, tokenVersion };
}
