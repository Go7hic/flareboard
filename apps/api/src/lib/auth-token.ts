import { eq, sql } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createSecureToken } from '@flareboard/shared';
import type { Env } from '../env';
import { getAppSecret } from './response';

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

/** Invalidates every outstanding token for a user (password change, logout). */
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

/** Single source of truth for minting session tokens, stamping the current version. */
export async function issueAuthToken(c: { env: Env }, user: { userId: string; role: string }): Promise<string> {
  const tv = await getTokenVersion(c.env, user.userId);
  return createSecureToken({ userId: user.userId, role: user.role, tv }, getAppSecret(c));
}
