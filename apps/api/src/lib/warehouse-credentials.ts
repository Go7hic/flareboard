import { decrypt, encrypt, hash } from '@flareboard/shared';
import type { Env } from '../env';

/**
 * Connector secrets (Stripe restricted API keys). Stored only in `warehouse_credential`,
 * encrypted with AES-256-GCM under a key derived from APP_SECRET (`encrypt` in
 * @flareboard/shared: random salt + IV per value, PBKDF2 key). Never returned by the API:
 * responses carry only a short hint (`rk_live_…4242`).
 *
 * Rows are removed when their data source is deleted, and with the website by the deletion job
 * (the table has a `website_id` column).
 */
export type CredentialKind = 'stripe_api_key';

function credentialSecret(env: Env) {
  if (!env.APP_SECRET) throw new Error('APP_SECRET is required to store connector credentials');
  // Domain-separated from other uses of APP_SECRET (session tokens, visitor salts).
  return hash('warehouse-credential:', env.APP_SECRET);
}

export function secretHint(secret: string) {
  const trimmed = secret.trim();
  const prefix = /^[a-z]{2}_(?:live|test)_/.exec(trimmed)?.[0] ?? '';
  return `${prefix}…${trimmed.slice(-4)}`;
}

export async function saveWarehouseCredential(
  env: Env,
  websiteId: string,
  dataSourceId: string,
  kind: CredentialKind,
  secret: string,
  now = Date.now(),
) {
  const ciphertext = encrypt(secret.trim(), credentialSecret(env));
  await env.DB.prepare(
    `INSERT INTO warehouse_credential (data_source_id, website_id, kind, ciphertext, hint, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT(data_source_id) DO UPDATE SET
       kind = excluded.kind, ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at`,
  )
    .bind(dataSourceId, websiteId, kind, ciphertext, secretHint(secret), now)
    .run();
}

export async function loadWarehouseCredential(env: Env, websiteId: string, dataSourceId: string) {
  const row = await env.DB.prepare(
    `SELECT ciphertext FROM warehouse_credential WHERE website_id = ?1 AND data_source_id = ?2 LIMIT 1`,
  )
    .bind(websiteId, dataSourceId)
    .first<{ ciphertext: string }>();
  if (!row) return null;
  try {
    return decrypt(row.ciphertext, credentialSecret(env));
  } catch {
    throw new Error('Stored credential cannot be decrypted (was APP_SECRET rotated?). Enter the API key again.');
  }
}

export async function deleteWarehouseCredential(env: Env, websiteId: string, dataSourceId: string) {
  await env.DB.prepare(`DELETE FROM warehouse_credential WHERE website_id = ?1 AND data_source_id = ?2`)
    .bind(websiteId, dataSourceId)
    .run();
}
