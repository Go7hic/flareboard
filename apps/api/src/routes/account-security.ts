import type { Context } from 'hono';
import { checkPassword } from '@flareboard/shared';
import type { Env } from '../env';
import { listUserAuditLog, logAdminAction } from '../lib/audit';
import { bumpTokenVersion, issueAuthToken } from '../lib/auth-token';
import {
  clearSecondFactorFailures,
  recordSecondFactorFailure,
  secondFactorLockStatus,
} from '../lib/login-guard';
import { getUserById } from '../lib/queries';
import { hasKnownPassword, listLinkedIdentities } from '../lib/sign-in-methods';
import { getAppSecret, json, notFound, unauthorized } from '../lib/response';
import { clearSessionCookie, setSessionCookie } from '../lib/session-cookie';
import {
  beginEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  getTwoFactorStatus,
  replaceRecoveryCodes,
  verifySecondFactor,
} from '../lib/two-factor';
import { extendUserSession, listUserSessions, revokeOtherUserSessions, revokeUserSession } from '../lib/user-sessions';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const INVALID_CODE = { code: 'invalid_code', message: 'Invalid code' };

async function readBody(c: Ctx) {
  return ((await c.req.json().catch(() => null)) ?? {}) as { code?: unknown; password?: unknown };
}

/**
 * Checks a TOTP or recovery code for the signed-in user, with the same per-user failure
 * lockout as sign-in. Returns an error response, or null when the code is valid.
 */
async function requireSecondFactor(c: Ctx, userId: string, code: unknown) {
  const secret = getAppSecret(c);
  const lock = await secondFactorLockStatus(c.env, secret, userId);
  if (lock.locked) return json({ message: 'Too many attempts. Try again later.', retryAfter: lock.retryAfterSec }, 429);
  const factor = typeof code === 'string' && code ? await verifySecondFactor(c.env, secret, userId, code.slice(0, 64)) : null;
  if (!factor) {
    await recordSecondFactorFailure(c.env, secret, userId);
    return unauthorized(INVALID_CODE);
  }
  await clearSecondFactorFailures(c.env, secret, userId);
  if (factor === 'recovery_code') {
    await logAdminAction(c.env, userId, 'recovery_code_used', 'two_factor', userId);
  }
  return null;
}

export async function handleTwoFactorStatus(c: Ctx) {
  return json(await getTwoFactorStatus(c.env, c.get('user').userId));
}

/** Creates a new (pending) secret. The response is the only time it is shown. */
export async function handleTwoFactorSetup(c: Ctx) {
  const { userId } = c.get('user');
  const status = await getTwoFactorStatus(c.env, userId);
  if (status.enabled) {
    return json({ code: 'already_enabled', message: 'Two-factor authentication is already on.' }, 409);
  }
  const user = await getUserById(c.env, userId);
  if (!user) return unauthorized();
  return json(await beginEnrollment(c.env, getAppSecret(c), userId, user.username));
}

export async function handleTwoFactorEnable(c: Ctx) {
  const { userId } = c.get('user');
  const body = await readBody(c);
  const secret = getAppSecret(c);
  const lock = await secondFactorLockStatus(c.env, secret, userId);
  if (lock.locked) return json({ message: 'Too many attempts. Try again later.', retryAfter: lock.retryAfterSec }, 429);

  const code = typeof body.code === 'string' ? body.code.slice(0, 16) : '';
  const recoveryCodes = code ? await confirmEnrollment(c.env, secret, userId, code) : null;
  if (!recoveryCodes) {
    await recordSecondFactorFailure(c.env, secret, userId);
    return json(INVALID_CODE, 400);
  }
  await clearSecondFactorFailures(c.env, secret, userId);
  await logAdminAction(c.env, userId, 'enable', 'two_factor', userId);
  return json({ recoveryCodes });
}

/** Turning 2FA off needs the password (when the account has one) and a current code. */
export async function handleTwoFactorDisable(c: Ctx) {
  const { userId } = c.get('user');
  const body = await readBody(c);
  const user = await getUserById(c.env, userId);
  if (!user) return unauthorized();

  const status = await getTwoFactorStatus(c.env, userId);
  if (!status.enabled && !status.pending) return json({ ok: true });

  if (status.enabled) {
    if (await hasKnownPassword(c.env, user)) {
      if (typeof body.password !== 'string' || !checkPassword(body.password, user.password)) {
        return unauthorized({ code: 'invalid_password', message: 'Password is incorrect' });
      }
    }
    const failed = await requireSecondFactor(c, userId, body.code);
    if (failed) return failed;

    // An owner whose team requires 2FA would lock everyone (themselves included) out of the
    // team settings that could lift the requirement.
    const owned = await c.env.DB.prepare(
      `SELECT t.name AS name FROM team_user tu JOIN team t ON t.team_id = tu.team_id
       WHERE tu.user_id = ?1 AND tu.role = 'team-owner' AND t.require_two_factor = 1 AND t.deleted_at IS NULL`,
    )
      .bind(userId)
      .all<{ name: string }>();
    const teams = (owned.results ?? []).map((row) => row.name);
    if (teams.length) {
      return json(
        {
          code: 'team_requires_two_factor',
          message: `Turn off the two-factor requirement of ${teams.join(', ')} before disabling it on your account.`,
          teams,
        },
        409,
      );
    }
  }

  await disableTwoFactor(c.env, userId);
  if (status.enabled) await logAdminAction(c.env, userId, 'disable', 'two_factor', userId);
  return json({ ok: true });
}

export async function handleRegenerateRecoveryCodes(c: Ctx) {
  const { userId } = c.get('user');
  const body = await readBody(c);
  const status = await getTwoFactorStatus(c.env, userId);
  if (!status.enabled) return json({ code: 'not_enabled', message: 'Two-factor authentication is off.' }, 409);
  const failed = await requireSecondFactor(c, userId, body.code);
  if (failed) return failed;
  const recoveryCodes = await replaceRecoveryCodes(c.env, getAppSecret(c), userId);
  await logAdminAction(c.env, userId, 'recovery_codes_regenerate', 'two_factor', userId);
  return json({ recoveryCodes });
}

export async function handleListSessions(c: Ctx) {
  const current = c.get('sessionId');
  const rows = await listUserSessions(c.env, c.get('user').userId);
  return json(
    rows.map((row) => ({
      id: row.sessionId,
      device: row.device,
      method: row.method,
      createdAt: row.createdAt.getTime(),
      lastSeenAt: row.lastSeenAt.getTime(),
      current: row.sessionId === current,
    })),
  );
}

export async function handleRevokeSession(c: Ctx) {
  const { userId } = c.get('user');
  const sessionId = c.req.param('sessionId') ?? '';
  if (!(await revokeUserSession(c.env, userId, sessionId))) return notFound();
  await logAdminAction(c.env, userId, 'revoke', 'session', sessionId, {
    current: sessionId === c.get('sessionId'),
  });
  if (sessionId === c.get('sessionId')) clearSessionCookie(c);
  return json({ ok: true });
}

/**
 * Signs out every other device. The token version bump also voids tokens from before
 * session ids existed; this device gets a fresh token for its session.
 */
export async function handleRevokeOtherSessions(c: Ctx) {
  const user = c.get('user');
  const current = c.get('sessionId');
  const revoked = await revokeOtherUserSessions(c.env, user.userId, current);
  await bumpTokenVersion(c.env, user.userId);
  if (current) {
    await extendUserSession(c.env, current);
    setSessionCookie(c, await issueAuthToken(c, user, current));
  }
  await logAdminAction(c.env, user.userId, 'revoke_others', 'session', current ?? null, { revoked });
  return json({ ok: true, revoked });
}

export async function handleAccountAuditLog(c: Ctx) {
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 50) || 50));
  return json(await listUserAuditLog(c.env, c.get('user').userId, page, pageSize));
}

/** The Google / GitHub accounts linked to this user, for the sign-in methods card. */
export async function handleListIdentities(c: Ctx) {
  const identities = await listLinkedIdentities(c.env, c.get('user').userId);
  return json(identities.map(({ provider, linkedAt }) => ({ provider, linkedAt })));
}

/**
 * Unlinks a provider. Refused when it is the last way into an account without a known password:
 * the user would be locked out until a reset link (if the account even has an email).
 */
export async function handleUnlinkIdentity(c: Ctx) {
  const { userId } = c.get('user');
  const provider = c.req.param('provider') ?? '';
  const user = await getUserById(c.env, userId);
  if (!user) return unauthorized();
  const identities = await listLinkedIdentities(c.env, userId);
  const target = identities.filter((identity) => identity.provider === provider);
  if (!target.length) return notFound();
  if (identities.length === target.length && !(await hasKnownPassword(c.env, user))) {
    return json(
      { code: 'last_sign_in_method', message: 'This is your only way to sign in. Set a password before unlinking it.' },
      409,
    );
  }
  await c.env.DB.prepare(`DELETE FROM user_oauth_identity WHERE user_id = ?1 AND provider = ?2`).bind(userId, provider).run();
  // Links once lived only in KV, and a leftover key would bring this one back at the next sign-in.
  await Promise.all(target.map((identity) => c.env.CACHE.delete(`oauth:${provider}:${identity.providerUserId}`)));
  await logAdminAction(c.env, userId, 'unlink', 'oauth_identity', userId, { provider });
  return json({ ok: true });
}
