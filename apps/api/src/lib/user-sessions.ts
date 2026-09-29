import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import type { Env } from '../env';
import { randomToken } from './security-crypto';

/** Matches the session cookie and token lifetime. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a verified session is trusted from KV before D1 is consulted (and last_seen_at bumped). */
const SESSION_CHECK_TTL_SEC = 300;
/** Revocation markers outlive any token that could still carry the session id. */
const REVOKED_TTL_SEC = Math.ceil(SESSION_TTL_MS / 1000) + 3600;

export type SessionMethod = 'password' | 'google' | 'github' | 'sso' | 'email';

const stateKey = (sessionId: string) => `session-state:${sessionId}`;

/**
 * Coarse "Browser on OS" label. Only this summary is stored, never the user agent itself.
 */
export function summarizeUserAgent(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl\//i.test(ua)
              ? 'curl'
              : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

export async function createUserSession(
  env: Env,
  userId: string,
  { method, userAgent }: { method: SessionMethod; userAgent?: string | null },
) {
  const sessionId = randomToken(16);
  const now = Date.now();
  await createDb(env.DB)
    .insert(schema.userSession)
    .values({
      sessionId,
      userId,
      device: summarizeUserAgent(userAgent),
      method,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + SESSION_TTL_MS),
    });
  await env.CACHE.put(stateKey(sessionId), `ok:${userId}`, { expirationTtl: SESSION_CHECK_TTL_SEC });
  return sessionId;
}

/** A re-issued token (password change) extends its session to the new token's lifetime. */
export async function extendUserSession(env: Env, sessionId: string) {
  await createDb(env.DB)
    .update(schema.userSession)
    .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .where(eq(schema.userSession.sessionId, sessionId));
}

/**
 * Whether a session id is still live for `userId`. One KV read per request; at most every
 * SESSION_CHECK_TTL_SEC a D1 read confirms the row and records activity.
 */
export async function isSessionActive(env: Env, sessionId: string, userId: string): Promise<boolean> {
  const cached = await env.CACHE.get(stateKey(sessionId));
  if (cached === 'revoked') return false;
  if (cached === `ok:${userId}`) return true;

  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE user_session SET last_seen_at = ?3 WHERE session_id = ?1 AND user_id = ?2 AND expires_at > ?3`,
  )
    .bind(sessionId, userId, now)
    .run();
  const active = (result.meta?.changes ?? 0) > 0;
  await env.CACHE.put(
    stateKey(sessionId),
    active ? `ok:${userId}` : 'revoked',
    { expirationTtl: active ? SESSION_CHECK_TTL_SEC : REVOKED_TTL_SEC },
  );
  return active;
}

export async function listUserSessions(env: Env, userId: string) {
  const rows = await createDb(env.DB)
    .select()
    .from(schema.userSession)
    .where(and(eq(schema.userSession.userId, userId), gt(schema.userSession.expiresAt, new Date())))
    .orderBy(desc(schema.userSession.lastSeenAt));
  return rows;
}

async function markRevoked(env: Env, sessionIds: string[]) {
  await Promise.all(
    sessionIds.map((id) => env.CACHE.put(stateKey(id), 'revoked', { expirationTtl: REVOKED_TTL_SEC })),
  );
}

/** Revokes one of the user's sessions. Returns false when it does not exist. */
export async function revokeUserSession(env: Env, userId: string, sessionId: string) {
  const result = await env.DB.prepare('DELETE FROM user_session WHERE session_id = ?1 AND user_id = ?2')
    .bind(sessionId, userId)
    .run();
  if (!(result.meta?.changes ?? 0)) return false;
  await markRevoked(env, [sessionId]);
  return true;
}

/** Revokes every session of the user except `keepSessionId` (all of them when null). */
export async function revokeOtherUserSessions(env: Env, userId: string, keepSessionId: string | null) {
  const db = createDb(env.DB);
  const where = keepSessionId
    ? and(eq(schema.userSession.userId, userId), ne(schema.userSession.sessionId, keepSessionId))
    : eq(schema.userSession.userId, userId);
  const rows = await db.select({ id: schema.userSession.sessionId }).from(schema.userSession).where(where);
  if (!rows.length) return 0;
  await db.delete(schema.userSession).where(where);
  await markRevoked(
    env,
    rows.map((row) => row.id),
  );
  return rows.length;
}
