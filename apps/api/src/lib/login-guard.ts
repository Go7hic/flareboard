import { lockoutRequest, type LockoutBody } from '@flareboard/rate-limiter';
import type { Env } from '../env';
import { keyedHash } from './security-crypto';

type Policy = Omit<LockoutBody, 'op'>;

/** Per account: 5 free failures, then 30s, 60s, … up to 15 minutes. */
const ACCOUNT_POLICY: Policy = { threshold: 5, baseSec: 30, maxSec: 15 * 60, resetAfterSec: 60 * 60 };
/** Per client IP (one IP guessing many accounts): looser, since offices share addresses. */
const IP_POLICY: Policy = { threshold: 20, baseSec: 60, maxSec: 60 * 60, resetAfterSec: 60 * 60 };
/** Per user for second-factor codes: a 6-digit code must not be guessable by retrying. */
const SECOND_FACTOR_POLICY: Policy = { threshold: 5, baseSec: 60, maxSec: 15 * 60, resetAfterSec: 60 * 60 };

/**
 * Durable Object names are keyed hashes, so neither the IP address nor the account name is
 * kept in storage. The state expires on its own (alarm) after `resetAfterSec`.
 */
async function bucket(secret: string, kind: string, subject: string) {
  return `lockout:${kind}:${await keyedHash(secret, 'login-guard', `${kind}:${subject}`)}`;
}

async function call(env: Env, secret: string, kind: string, subject: string, op: LockoutBody['op'], policy: Policy) {
  return lockoutRequest(env.RATE_LIMITER, await bucket(secret, kind, subject), { op, ...policy });
}

export type LockStatus = { locked: boolean; retryAfterSec: number };

function merge(results: LockStatus[]): LockStatus {
  const locked = results.filter((result) => result.locked);
  return { locked: locked.length > 0, retryAfterSec: Math.max(0, ...locked.map((result) => result.retryAfterSec)) };
}

export function normalizeAccount(identifier: string) {
  return identifier.trim().toLowerCase();
}

export async function passwordLockStatus(env: Env, secret: string, account: string, ip: string) {
  return merge(
    await Promise.all([
      call(env, secret, 'account', normalizeAccount(account), 'check', ACCOUNT_POLICY),
      call(env, secret, 'ip', ip, 'check', IP_POLICY),
    ]),
  );
}

export async function recordPasswordFailure(env: Env, secret: string, account: string, ip: string) {
  return merge(
    await Promise.all([
      call(env, secret, 'account', normalizeAccount(account), 'fail', ACCOUNT_POLICY),
      call(env, secret, 'ip', ip, 'fail', IP_POLICY),
    ]),
  );
}

export async function clearPasswordFailures(env: Env, secret: string, account: string) {
  await call(env, secret, 'account', normalizeAccount(account), 'reset', ACCOUNT_POLICY);
}

export async function secondFactorLockStatus(env: Env, secret: string, userId: string) {
  return call(env, secret, 'second-factor', userId, 'check', SECOND_FACTOR_POLICY);
}

export async function recordSecondFactorFailure(env: Env, secret: string, userId: string) {
  return call(env, secret, 'second-factor', userId, 'fail', SECOND_FACTOR_POLICY);
}

export async function clearSecondFactorFailures(env: Env, secret: string, userId: string) {
  await call(env, secret, 'second-factor', userId, 'reset', SECOND_FACTOR_POLICY);
}
