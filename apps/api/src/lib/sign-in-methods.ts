import type { Env } from '../env';

/** How long after an account's creation a provider link counts as the one that created it. */
const CREATED_WITH_PROVIDER_MS = 60_000;
/** Provider-created accounts got a random password before this; from then on they get ''. */
const EMPTY_PASSWORD_SINCE = Date.UTC(2026, 9, 9);

export interface LinkedIdentity {
  provider: string;
  providerUserId: string;
  linkedAt: number;
}

export async function listLinkedIdentities(env: Env, userId: string): Promise<LinkedIdentity[]> {
  const { results } = await env.DB.prepare(
    `SELECT provider, provider_user_id AS providerUserId, created_at AS linkedAt
     FROM user_oauth_identity WHERE user_id = ?1 ORDER BY created_at`,
  )
    .bind(userId)
    .all<LinkedIdentity>();
  return results;
}

/**
 * Whether the user has a password they know, so it can guard deleting the account or turning
 * two-factor off. Accounts created through Google or GitHub have none (stored as ''), until they
 * set one with a reset link. Linking a provider to an account that has a password keeps it.
 *
 * Accounts a provider created before EMPTY_PASSWORD_SINCE got a random password instead of '':
 * those are recognised by a link made within a minute of the account itself.
 */
export async function hasKnownPassword(
  env: Env,
  user: { userId: string; password: string; createdAt: Date | null },
): Promise<boolean> {
  if (!user.password) return false;
  const createdAt = user.createdAt?.getTime();
  if (createdAt == null || createdAt >= EMPTY_PASSWORD_SINCE) return true;
  const createdBy = await env.DB.prepare(
    `SELECT 1 AS hit FROM user_oauth_identity WHERE user_id = ?1 AND abs(created_at - ?2) < ?3 LIMIT 1`,
  )
    .bind(user.userId, createdAt, CREATED_WITH_PROVIDER_MS)
    .first<{ hit: number }>();
  return !createdBy;
}
