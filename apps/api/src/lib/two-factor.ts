import { and, count, eq, isNotNull } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import type { Env } from '../env';
import { keyedHash, openSecret, sealSecret } from './security-crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

const SECRET_PURPOSE = 'two-factor-secret';
const RECOVERY_PURPOSE = 'two-factor-recovery-code';
export const RECOVERY_CODE_COUNT = 10;
/** Unambiguous lowercase alphabet (no 0/o, 1/l/i). */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export type SecondFactor = 'totp' | 'recovery_code';

export async function getTwoFactorStatus(env: Env, userId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ enabledAt: schema.userTwoFactor.enabledAt })
    .from(schema.userTwoFactor)
    .where(eq(schema.userTwoFactor.userId, userId))
    .limit(1);
  const [codes] = await db
    .select({ n: count() })
    .from(schema.userRecoveryCode)
    .where(eq(schema.userRecoveryCode.userId, userId));
  return {
    enabled: Boolean(row?.enabledAt),
    pending: Boolean(row && !row.enabledAt),
    enabledAt: row?.enabledAt ? row.enabledAt.getTime() : null,
    recoveryCodesRemaining: row?.enabledAt ? (codes?.n ?? 0) : 0,
  };
}

export async function hasTwoFactor(env: Env, userId: string) {
  const [row] = await createDb(env.DB)
    .select({ userId: schema.userTwoFactor.userId })
    .from(schema.userTwoFactor)
    .where(and(eq(schema.userTwoFactor.userId, userId), isNotNull(schema.userTwoFactor.enabledAt)))
    .limit(1);
  return Boolean(row);
}

/** Starts (or restarts) enrollment with a fresh secret. Callers refuse when 2FA is already on. */
export async function beginEnrollment(env: Env, secret: string, userId: string, account: string) {
  const totpSecret = generateTotpSecret();
  const secretEnc = await sealSecret(secret, SECRET_PURPOSE, totpSecret);
  const now = new Date();
  await createDb(env.DB)
    .insert(schema.userTwoFactor)
    .values({ userId, secretEnc, enabledAt: null, lastUsedStep: null, createdAt: now })
    .onConflictDoUpdate({
      target: schema.userTwoFactor.userId,
      set: { secretEnc, enabledAt: null, lastUsedStep: null, createdAt: now },
    });
  return { secret: totpSecret, otpauthUri: otpauthUri(totpSecret, account) };
}

function normalizeRecoveryCode(code: string) {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function recoveryCodeHash(secret: string, userId: string, code: string) {
  return keyedHash(secret, RECOVERY_PURPOSE, `${userId}:${normalizeRecoveryCode(code)}`);
}

function randomRecoveryCode() {
  // 10 characters from 31 symbols is ~49 bits. Rejection sampling keeps the choice uniform.
  let out = '';
  while (out.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && out.length < 10) out += RECOVERY_ALPHABET[byte % 31];
    }
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Replaces all recovery codes. The plaintext codes are returned once and never stored. */
export async function replaceRecoveryCodes(env: Env, secret: string, userId: string) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  const hashes = await Promise.all(codes.map((code) => recoveryCodeHash(secret, userId, code)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_recovery_code WHERE user_id = ?1').bind(userId),
    ...hashes.map((hash) =>
      env.DB.prepare('INSERT INTO user_recovery_code (code_hash, user_id, created_at) VALUES (?1, ?2, ?3)').bind(
        hash,
        userId,
        now,
      ),
    ),
  ]);
  return codes;
}

async function loadSecret(env: Env, secret: string, userId: string) {
  const [row] = await createDb(env.DB)
    .select()
    .from(schema.userTwoFactor)
    .where(eq(schema.userTwoFactor.userId, userId))
    .limit(1);
  if (!row) return null;
  return { row, totpSecret: await openSecret(secret, SECRET_PURPOSE, row.secretEnc) };
}

/**
 * Accepts a TOTP code, atomically advancing `last_used_step` so the same code cannot be
 * used twice (the UPDATE only succeeds while the stored step is older).
 */
async function consumeTotp(env: Env, secret: string, userId: string, code: string, requireEnabled: boolean) {
  const loaded = await loadSecret(env, secret, userId);
  if (!loaded || (requireEnabled && !loaded.row.enabledAt)) return false;
  const step = await verifyTotp(loaded.totpSecret, code, Date.now(), loaded.row.lastUsedStep ?? null);
  if (step === null) return false;
  const result = await env.DB.prepare(
    `UPDATE user_two_factor SET last_used_step = ?2
     WHERE user_id = ?1 AND (last_used_step IS NULL OR last_used_step < ?2)`,
  )
    .bind(userId, step)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Confirms a pending enrollment with its first code and issues recovery codes. */
export async function confirmEnrollment(env: Env, secret: string, userId: string, code: string) {
  const status = await getTwoFactorStatus(env, userId);
  if (!status.pending) return null;
  if (!(await consumeTotp(env, secret, userId, code, false))) return null;
  await createDb(env.DB)
    .update(schema.userTwoFactor)
    .set({ enabledAt: new Date() })
    .where(eq(schema.userTwoFactor.userId, userId));
  return replaceRecoveryCodes(env, secret, userId);
}

/**
 * Verifies a second factor for an enrolled user: a 6-digit TOTP code, or a recovery code,
 * which is deleted on use. Returns which kind matched, or null.
 */
export async function verifySecondFactor(
  env: Env,
  secret: string,
  userId: string,
  code: string,
): Promise<SecondFactor | null> {
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed.replace(/\s/g, ''))) {
    return (await consumeTotp(env, secret, userId, trimmed, true)) ? 'totp' : null;
  }
  if (normalizeRecoveryCode(trimmed).length !== 10) return null;
  if (!(await hasTwoFactor(env, userId))) return null;
  const hash = await recoveryCodeHash(secret, userId, trimmed);
  // Lookup by keyed hash: comparing digests in SQL leaks nothing about the code.
  const result = await env.DB.prepare('DELETE FROM user_recovery_code WHERE code_hash = ?1 AND user_id = ?2')
    .bind(hash, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0 ? 'recovery_code' : null;
}

export async function disableTwoFactor(env: Env, userId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_recovery_code WHERE user_id = ?1').bind(userId),
    env.DB.prepare('DELETE FROM user_two_factor WHERE user_id = ?1').bind(userId),
  ]);
}

export async function countRecoveryCodes(env: Env, userId: string) {
  const [row] = await createDb(env.DB)
    .select({ n: count() })
    .from(schema.userRecoveryCode)
    .where(eq(schema.userRecoveryCode.userId, userId));
  return row?.n ?? 0;
}
