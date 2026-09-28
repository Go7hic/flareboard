import {
  generatePersonalApiKey,
  hashApiKey,
  personalApiKeyDisplayPrefix,
  PERSONAL_API_KEY_SCOPES,
  type PersonalApiKeyScope,
} from '@flareboard/shared';
import type { Env } from '../env';

/** Keeps a leaked session from minting keys without bound; far above any real need. */
export const MAX_PERSONAL_API_KEYS = 50;
/** last_used_at is refreshed at most this often per key, so busy keys do not write on every call. */
const LAST_USED_REFRESH_MS = 60_000;

export type PersonalApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: PersonalApiKeyScope[];
  createdAt: number;
  lastUsedAt: number | null;
};

type KeyRow = {
  keyId: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  createdAt: number;
  lastUsedAt: number | null;
};

function parseScopes(raw: string): PersonalApiKeyScope[] {
  const parts = raw.split(',');
  return PERSONAL_API_KEY_SCOPES.filter((scope) => parts.includes(scope));
}

function summarize(row: KeyRow): PersonalApiKeySummary {
  return {
    id: row.keyId,
    name: row.name,
    prefix: row.keyPrefix,
    scopes: parseScopes(row.scopes),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function listPersonalApiKeys(env: Env, userId: string): Promise<PersonalApiKeySummary[]> {
  const rows = await env.DB.prepare(
    `SELECT key_id AS keyId, name, key_prefix AS keyPrefix, scopes, created_at AS createdAt, last_used_at AS lastUsedAt
     FROM personal_api_key WHERE user_id = ?1 ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<KeyRow>();
  return (rows.results ?? []).map(summarize);
}

export async function countPersonalApiKeys(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM personal_api_key WHERE user_id = ?1`)
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Creates a key and returns it with the secret, which is never retrievable again. */
export async function createPersonalApiKey(
  env: Env,
  userId: string,
  input: { name: string; scopes: PersonalApiKeyScope[] },
): Promise<PersonalApiKeySummary & { key: string }> {
  const key = generatePersonalApiKey();
  const row: KeyRow = {
    keyId: crypto.randomUUID(),
    name: input.name,
    keyPrefix: personalApiKeyDisplayPrefix(key),
    scopes: input.scopes.join(','),
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  await env.DB.prepare(
    `INSERT INTO personal_api_key (key_id, user_id, name, key_hash, key_prefix, scopes, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(row.keyId, userId, row.name, await hashApiKey(key), row.keyPrefix, row.scopes, row.createdAt)
    .run();
  return { ...summarize(row), key };
}

/** Deletes one of the user's keys. Returns the revoked key, or null when it is not theirs. */
export async function revokePersonalApiKey(env: Env, userId: string, keyId: string) {
  const row = await env.DB.prepare(
    `DELETE FROM personal_api_key WHERE key_id = ?1 AND user_id = ?2
     RETURNING key_id AS keyId, name, key_prefix AS keyPrefix, scopes, created_at AS createdAt, last_used_at AS lastUsedAt`,
  )
    .bind(keyId, userId)
    .first<KeyRow>();
  return row ? summarize(row) : null;
}

export type PersonalApiKeyAuth = {
  keyId: string;
  userId: string;
  role: string;
  scopes: PersonalApiKeyScope[];
  lastUsedAt: number | null;
};

/**
 * Resolves a presented `fb_sk_…` secret to its key and user. Keys of deleted accounts never
 * authenticate (the account purge erases them later). Lookup is by hash, so the stored value
 * alone cannot be replayed as a key.
 */
export async function authenticatePersonalApiKey(env: Env, secret: string): Promise<PersonalApiKeyAuth | null> {
  const row = await env.DB.prepare(
    `SELECT k.key_id AS keyId, k.user_id AS userId, k.scopes, k.last_used_at AS lastUsedAt, u.role
     FROM personal_api_key k
     JOIN user u ON u.user_id = k.user_id
     WHERE k.key_hash = ?1 AND u.deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(await hashApiKey(secret))
    .first<{ keyId: string; userId: string; scopes: string; lastUsedAt: number | null; role: string }>();
  if (!row) return null;
  return { ...row, scopes: parseScopes(row.scopes) };
}

export async function touchPersonalApiKey(env: Env, auth: PersonalApiKeyAuth, now = Date.now()): Promise<void> {
  if (auth.lastUsedAt != null && now - auth.lastUsedAt < LAST_USED_REFRESH_MS) return;
  await env.DB.prepare(`UPDATE personal_api_key SET last_used_at = ?2 WHERE key_id = ?1`)
    .bind(auth.keyId, now)
    .run();
}
