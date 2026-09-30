import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  checkPassword,
  forgotPasswordSchema,
  hashPassword,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  ROLES,
  ssoSchema,
  uuid,
  verifyEmailSchema,
  verifySsoToken,
} from '@flareboard/shared';
import type { Env } from '../env';
import { logAdminAction } from '../lib/audit';
import { isDemoUserId } from '../lib/demo-access';
import { readAuthToken } from '../lib/auth-credentials';
import { csrfOriginAllowed } from '../lib/csrf';
import { bumpTokenVersion, startSession, verifySessionToken } from '../lib/auth-token';
import { createLoginChallenge, markLoginChallengeUsed, readLoginChallenge } from '../lib/login-challenge';
import {
  clearPasswordFailures,
  clearSecondFactorFailures,
  passwordLockStatus,
  recordPasswordFailure,
  recordSecondFactorFailure,
  secondFactorLockStatus,
  type LockStatus,
} from '../lib/login-guard';
import {
  buildOAuthAuthorizeUrl,
  getEnabledOAuthProviders,
  handleOAuthCallbackFlow,
  isProvider,
  storeOAuthState,
} from '../lib/oauth';
import { ensureSubscriptionRow, isHostedMode } from '../lib/billing';
import { logUndeliveredLink, sendPasswordResetEmail, sendVerificationEmail } from '../lib/email';
import { getUserByEmail, getUserById, getUserByUsername } from '../lib/queries';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { badRequest, forbidden, getAppSecret, json, unauthorized } from '../lib/response';
import { clearSessionCookie, setSessionCookie } from '../lib/session-cookie';
import { countRecoveryCodes, hasTwoFactor, verifySecondFactor } from '../lib/two-factor';
import {
  revokeOtherUserSessions,
  revokeUserSession,
  summarizeUserAgent,
  type SessionMethod,
} from '../lib/user-sessions';

type Ctx = Context<{ Bindings: Env }>;

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SEC = 60;
const RESET_TTL = 3600;
const VERIFY_TTL = 86400;
/** Generic on purpose: never reveal whether the account exists or which part was wrong. */
const INVALID_CREDENTIALS = 'Invalid username or password';
const CHALLENGE_EXPIRED = { code: 'challenge_expired', message: 'Your sign-in expired. Please sign in again.' };

/** Returns a 429 response when the caller is over the limit, else null. */
async function rateLimited(c: Ctx, prefix: string, limit: number, windowSec: number) {
  const rl = await checkIpRateLimit(c.env, prefix, getTrustedClientIp(c.req.raw), limit, windowSec);
  return rl.allowed ? null : json({ message: 'Too many attempts' }, 429);
}

function lockedResponse(lock: LockStatus) {
  const response = json({ message: 'Too many login attempts. Try again later.', retryAfter: lock.retryAfterSec }, 429);
  if (lock.retryAfterSec) response.headers.set('Retry-After', String(lock.retryAfterSec));
  return response;
}

/** Production hosted SaaS only — local/dev skips email verification for seeded admins. */
function requiresEmailVerification(env: Env): boolean {
  return isHostedMode(env) && env.ENVIRONMENT === 'production';
}

async function resolveLoginUser(env: Env, identifier: string) {
  const byUsername = await getUserByUsername(env, identifier);
  if (byUsername) return byUsername;
  if (identifier.includes('@')) {
    return getUserByEmail(env, identifier);
  }
  return null;
}

/** Compared against when the account does not exist, so both paths cost one bcrypt check. */
let dummyPasswordHash: string | null = null;
function checkPasswordAgainstNothing(password: string) {
  dummyPasswordHash ??= hashPassword(crypto.randomUUID());
  checkPassword(password, dummyPasswordHash);
  return false;
}

/** Starts a session and records the sign-in in the account's audit log (no IP address). */
async function signIn(c: Ctx, user: { userId: string; role: string }, method: SessionMethod, twoFactor: boolean) {
  const session = await startSession(c, user, method);
  await logAdminAction(c.env, user.userId, 'login', 'user', user.userId, {
    method,
    twoFactor,
    device: summarizeUserAgent(c.req.header('User-Agent')),
  });
  return session;
}

async function respondWithSession(
  c: Ctx,
  user: { userId: string; role: string; username: string },
  method: SessionMethod,
  options?: { includeToken?: boolean; twoFactor?: boolean; extra?: Record<string, unknown> },
) {
  const { token } = await signIn(c, user, method, Boolean(options?.twoFactor));
  setSessionCookie(c, token);
  return json({
    ...(options?.includeToken ? { token } : {}),
    ...options?.extra,
    user: { id: user.userId, username: user.username, role: user.role },
  });
}

/**
 * After the first factor: accounts with two-factor authentication get a short-lived challenge
 * for POST /login/2fa instead of a session.
 */
async function completeFirstFactor(
  c: Ctx,
  user: { userId: string; role: string; username: string },
  method: SessionMethod,
) {
  if (await hasTwoFactor(c.env, user.userId)) {
    const challenge = await createLoginChallenge(c.env, getAppSecret(c), user.userId, method);
    return json({ twoFactorRequired: true, challenge });
  }
  return respondWithSession(c, user, method);
}

export async function handleRegister(c: Ctx) {
  if (!isHostedMode(c.env)) {
    return json({ message: 'Registration is not enabled' }, 404);
  }

  const ip = getTrustedClientIp(c.req.raw);
  const rl = await checkIpRateLimit(c.env, 'register', ip, 5, 300);
  if (!rl.allowed) return json({ message: 'Too many attempts' }, 429);

  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const { email, password, displayName } = parsed.data;
  if (await getUserByEmail(c.env, email) || (await getUserByUsername(c.env, email))) {
    return badRequest('An account with this email already exists');
  }

  const userId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.user).values({
    userId,
    username: email,
    email,
    password: hashPassword(password),
    role: ROLES.user,
    displayName: displayName ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await ensureSubscriptionRow(c.env, userId);

  const token = uuid();
  await c.env.CACHE.put(`verify:${token}`, userId, { expirationTtl: VERIFY_TTL });
  const verifyUrl = `${dashboardBase(c)}/login?verify=${encodeURIComponent(token)}`;
  await sendVerificationEmail(c.env, email, verifyUrl);

  return json({ ok: true, message: 'Check your email to verify your account.' }, 201);
}

export async function handleVerifyEmail(c: Ctx) {
  const limited = await rateLimited(c, 'verify-email', 10, 300);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid verification token');

  const userId = await c.env.CACHE.get(`verify:${parsed.data.token}`);
  if (!userId) return badRequest('Invalid or expired verification token');

  const db = createDb(c.env.DB);
  await db
    .update(schema.user)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.user.userId, userId));
  await c.env.CACHE.delete(`verify:${parsed.data.token}`);

  const user = await getUserById(c.env, userId);
  if (!user) return badRequest('User not found');

  return completeFirstFactor(c, { userId: user.userId, role: user.role, username: user.username }, 'email');
}

export async function handleLogin(c: Ctx) {
  const ip = getTrustedClientIp(c.req.raw);
  const rl = await checkIpRateLimit(c.env, 'login', ip, LOGIN_LIMIT, LOGIN_WINDOW_SEC);
  if (!rl.allowed) {
    return json({ message: 'Too many login attempts' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Invalid credentials');
  }

  // Failure lockout with backoff per account (rotating IPs cannot guess one password) and per
  // IP (one client cannot spray many accounts). Neither key is stored in D1.
  const secret = getAppSecret(c);
  const identifier = parsed.data.username;
  const lock = await passwordLockStatus(c.env, secret, identifier, ip);
  if (lock.locked) return lockedResponse(lock);

  // The demo account has no password: it is only reachable through POST /api/demo/session.
  const found = await resolveLoginUser(c.env, identifier);
  const user = found && !isDemoUserId(found.userId) ? found : null;
  const valid = user ? checkPassword(parsed.data.password, user.password) : checkPasswordAgainstNothing(parsed.data.password);
  if (!user || !valid) {
    const after = await recordPasswordFailure(c.env, secret, identifier, ip);
    if (user) await logAdminAction(c.env, user.userId, 'login_failed', 'user', user.userId, { reason: 'password' });
    return after.locked ? lockedResponse(after) : unauthorized({ message: INVALID_CREDENTIALS });
  }
  await clearPasswordFailures(c.env, secret, identifier);

  if (requiresEmailVerification(c.env) && user.email && !user.emailVerifiedAt) {
    return json({ message: 'Please verify your email before signing in.' }, 403);
  }

  return completeFirstFactor(c, { userId: user.userId, role: user.role, username: user.username }, 'password');
}

/** Second step of sign-in for accounts with two-factor authentication. */
export async function handleLoginSecondFactor(c: Ctx) {
  const limited = await rateLimited(c, 'login-2fa', LOGIN_LIMIT, LOGIN_WINDOW_SEC);
  if (limited) return limited;

  const body = (await c.req.json().catch(() => null)) as { challenge?: unknown; code?: unknown } | null;
  const secret = getAppSecret(c);
  const challenge = await readLoginChallenge(c.env, secret, body?.challenge);
  if (!challenge) return unauthorized(CHALLENGE_EXPIRED);
  const code = typeof body?.code === 'string' ? body.code.slice(0, 64) : '';

  const lock = await secondFactorLockStatus(c.env, secret, challenge.userId);
  if (lock.locked) return lockedResponse(lock);

  const factor = code ? await verifySecondFactor(c.env, secret, challenge.userId, code) : null;
  if (!factor) {
    const after = await recordSecondFactorFailure(c.env, secret, challenge.userId);
    await logAdminAction(c.env, challenge.userId, 'login_failed', 'user', challenge.userId, {
      reason: 'two_factor',
      method: challenge.method,
    });
    return after.locked ? lockedResponse(after) : unauthorized({ code: 'invalid_code', message: 'Invalid code' });
  }

  await markLoginChallengeUsed(c.env, challenge.jti);
  await clearSecondFactorFailures(c.env, secret, challenge.userId);
  const user = await getUserById(c.env, challenge.userId);
  if (!user) return unauthorized(CHALLENGE_EXPIRED);

  let extra: Record<string, unknown> | undefined;
  if (factor === 'recovery_code') {
    const remaining = await countRecoveryCodes(c.env, user.userId);
    await logAdminAction(c.env, user.userId, 'recovery_code_used', 'two_factor', user.userId, { remaining });
    extra = { recoveryCodesRemaining: remaining };
  }
  return respondWithSession(c, { userId: user.userId, role: user.role, username: user.username }, challenge.method, {
    twoFactor: true,
    extra,
  });
}

export async function handleLogout(c: Ctx) {
  // Cookie-authenticated POST outside jwtAuth: without this any site could sign users out.
  if (!csrfOriginAllowed(c)) return forbidden('Invalid origin');
  const token = readAuthToken(c);
  const session = token ? await verifySessionToken(c.env, token, getAppSecret(c)) : null;
  if (session?.sessionId) {
    await revokeUserSession(c.env, session.userId, session.sessionId);
  } else if (session) {
    // Tokens from before per-session revocation can only be voided all at once.
    await bumpTokenVersion(c.env, session.userId);
  }
  clearSessionCookie(c);
  return json({ ok: true });
}

function getSsoSecret(c: Ctx): string | null {
  if (c.env.ENVIRONMENT === 'production') {
    return c.env.SSO_SECRET ?? null;
  }
  return c.env.SSO_SECRET || getAppSecret(c);
}

export async function handleSso(c: Ctx) {
  const limited = await rateLimited(c, 'sso', 10, 60);
  if (limited) return limited;

  const secret = getSsoSecret(c);
  if (!secret) {
    return json({ message: 'SSO is not configured' }, 503);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = ssoSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid SSO token');

  const payload = verifySsoToken(parsed.data.token, secret);
  if (!payload) return unauthorized({ message: 'Invalid or expired SSO token' });

  const user = await getUserById(c.env, payload.userId);
  if (!user || isDemoUserId(user.userId)) return unauthorized({ message: 'User not found' });

  // The SSO token is minted by a trusted system holding SSO_SECRET, which owns authentication
  // for these users, so it is not stepped up with this account's second factor.
  return respondWithSession(c, { userId: user.userId, role: user.role, username: user.username }, 'sso', {
    includeToken: true,
  });
}

/** The signed-in user for public routes (same revocation rules as jwtAuth), or null. */
async function currentSessionUser(c: Ctx) {
  const token = readAuthToken(c);
  if (!token) return null;
  return verifySessionToken(c.env, token, getAppSecret(c));
}

export async function handleVerify(c: Ctx) {
  const session = await currentSessionUser(c);
  if (!session) return unauthorized();
  return json({ user: { id: session.userId, role: session.role } });
}

function requestOrigin(c: Ctx) {
  const url = new URL(c.req.url);
  return url.origin;
}

function dashboardBase(c: Ctx) {
  return (c.env.DASHBOARD_URL ?? c.env.SHARE_URL ?? requestOrigin(c)).replace(/\/$/, '');
}

export async function handleOAuthRedirect(c: Ctx) {
  const provider = c.req.param('provider') ?? '';
  if (!isProvider(provider)) return badRequest('Unknown OAuth provider');
  if (!getEnabledOAuthProviders(c.env).includes(provider)) {
    return json({ message: 'OAuth provider not configured' }, 503);
  }

  // `?link=1` from a signed-in session attaches this provider to the current account;
  // otherwise the callback only signs in identities that are already linked (or, once,
  // the local account with the same verified email).
  let linkUserId: string | undefined;
  if (c.req.query('link') === '1') {
    const session = await currentSessionUser(c);
    if (!session) return unauthorized();
    // Nobody may attach a sign-in method to the shared demo account.
    if (isDemoUserId(session.userId)) return forbidden('The demo is read-only');
    linkUserId = session.userId;
  }

  const state = crypto.randomUUID();
  const returnTo = c.req.query('returnTo') ?? undefined;
  await storeOAuthState(c.env, state, { provider, returnTo, linkUserId });

  const url = buildOAuthAuthorizeUrl(c.env, provider, requestOrigin(c), state);
  if (!url) return json({ message: 'OAuth provider not configured' }, 503);

  return c.redirect(url, 302);
}

export async function handleOAuthCallback(c: Ctx) {
  const rl = await checkIpRateLimit(c.env, 'oauth-callback', getTrustedClientIp(c.req.raw), 20, 60);
  if (!rl.allowed) {
    return c.redirect(`${dashboardBase(c)}/login?error=rate_limited`, 302);
  }

  const provider = c.req.param('provider') ?? '';
  const code = c.req.query('code') ?? null;
  const state = c.req.query('state') ?? null;

  const result = await handleOAuthCallbackFlow(c.env, provider, code, state, requestOrigin(c));
  if ('error' in result && result.error) {
    return c.redirect(`${dashboardBase(c)}/login?error=${encodeURIComponent(result.error)}`, 302);
  }
  if (!('user' in result) || !result.user) {
    return c.redirect(`${dashboardBase(c)}/login?error=oauth_failed`, 302);
  }

  const method = result.provider;
  const user = { userId: result.user.userId, role: result.user.role };
  if (result.linked) {
    await logAdminAction(c.env, user.userId, 'link', 'oauth_identity', user.userId, {
      provider: method,
      viaVerifiedEmail: result.linked === 'email',
    });
  }
  // Linking from a signed-in session already passed the second factor; sign-ins are stepped up.
  const exchange =
    result.linked !== 'session' && (await hasTwoFactor(c.env, user.userId))
      ? { challenge: await createLoginChallenge(c.env, getAppSecret(c), user.userId, method) }
      : { token: (await signIn(c, user, method, false)).token };

  const dest = result.returnTo ?? '/dashboard';
  // Hand the browser a short-lived one-time code, not the token itself, so the
  // JWT never lands in browser history, Referer headers, or intermediary logs.
  const exchangeCode = crypto.randomUUID().replace(/-/g, '');
  await c.env.CACHE.put(`oauth-code:${exchangeCode}`, JSON.stringify(exchange), { expirationTtl: 60 });
  return c.redirect(
    `${dashboardBase(c)}/login?code=${encodeURIComponent(exchangeCode)}&next=${encodeURIComponent(dest)}`,
    302,
  );
}

export async function handleOAuthExchange(c: Ctx) {
  const limited = await rateLimited(c, 'oauth-exchange', 30, 60);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : '';
  if (!code) return badRequest('Missing code');

  const key = `oauth-code:${code}`;
  const stored = await c.env.CACHE.get(key);
  if (!stored) return unauthorized({ message: 'Invalid or expired code' });
  await c.env.CACHE.delete(key);

  let exchange: { token?: unknown; challenge?: unknown };
  try {
    exchange = JSON.parse(stored) as typeof exchange;
  } catch {
    return unauthorized({ message: 'Invalid or expired code' });
  }
  if (typeof exchange.challenge === 'string') {
    return json({ twoFactorRequired: true, challenge: exchange.challenge });
  }

  const token = typeof exchange.token === 'string' ? exchange.token : '';
  const session = token ? await verifySessionToken(c.env, token, getAppSecret(c)) : null;
  if (!session) return unauthorized({ message: 'Invalid or expired code' });

  setSessionCookie(c, token);
  const user = await getUserById(c.env, session.userId);
  return json({
    user: {
      id: session.userId,
      username: user?.username ?? session.userId,
      role: session.role,
    },
  });
}

export async function handleForgotPassword(c: Ctx) {
  const limited = await rateLimited(c, 'forgot-password', 5, 900);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  // Same lookup as sign-in, so accounts registered with an email can recover too.
  const user = await resolveLoginUser(c.env, parsed.data.username);
  if (user) {
    const token = uuid();
    await c.env.CACHE.put(`reset:${token}`, user.userId, { expirationTtl: RESET_TTL });
    const resetUrl = `${dashboardBase(c)}/login?reset=${encodeURIComponent(token)}`;
    const to = user.email ?? user.username;
    const delivered = to.includes('@')
      ? await sendPasswordResetEmail(c.env, to, resetUrl).catch(() => false)
      : false;
    if (!delivered) logUndeliveredLink(c.env, 'password-reset', user.userId, resetUrl);
  }

  return json({ ok: true, message: 'If the account exists, a reset link was sent.' });
}

export async function handleResetPassword(c: Ctx) {
  const limited = await rateLimited(c, 'reset-password', 10, 300);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const userId = await c.env.CACHE.get(`reset:${parsed.data.token}`);
  if (!userId) return badRequest('Invalid or expired reset token');

  const db = createDb(c.env.DB);
  await db
    .update(schema.user)
    .set({ password: hashPassword(parsed.data.password), updatedAt: new Date() })
    .where(eq(schema.user.userId, userId));

  // A reset signs out every device. Two-factor authentication stays on: the next sign-in
  // still asks for the second factor.
  await bumpTokenVersion(c.env, userId);
  await revokeOtherUserSessions(c.env, userId, null);
  await c.env.CACHE.delete(`reset:${parsed.data.token}`);
  await logAdminAction(c.env, userId, 'password_reset', 'user', userId);
  return json({ ok: true });
}

export function getAuth() {
  const auth = new Hono<{ Bindings: Env }>();
  auth.post('/register', handleRegister);
  auth.post('/verify-email', handleVerifyEmail);
  auth.post('/login', handleLogin);
  auth.post('/login/2fa', handleLoginSecondFactor);
  auth.post('/sso', handleSso);
  auth.post('/logout', handleLogout);
  auth.get('/verify', handleVerify);
  auth.post('/forgot-password', handleForgotPassword);
  auth.post('/reset-password', handleResetPassword);
  auth.get('/oauth/:provider', handleOAuthRedirect);
  auth.get('/oauth/:provider/callback', handleOAuthCallback);
  auth.post('/oauth/exchange', handleOAuthExchange);
  return auth;
}
