import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  checkPassword,
  createSecureToken,
  forgotPasswordSchema,
  hashPassword,
  loginSchema,
  parseSecureToken,
  registerSchema,
  resetPasswordSchema,
  ROLES,
  ssoSchema,
  uuid,
  verifyEmailSchema,
  verifySsoToken,
} from '@flareboard/shared';
import type { Env } from '../env';
import {
  buildOAuthAuthorizeUrl,
  consumeOAuthState,
  getEnabledOAuthProviders,
  handleOAuthCallbackFlow,
  isProvider,
  storeOAuthState,
} from '../lib/oauth';
import { ensureSubscriptionRow, isHostedMode } from '../lib/billing';
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/email';
import { getUserByEmail, getUserById, getUserByUsername } from '../lib/queries';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { badRequest, getAppSecret, json, unauthorized } from '../lib/response';

type Ctx = Context<{ Bindings: Env }>;

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SEC = 60;
const RESET_TTL = 3600;
const VERIFY_TTL = 86400;

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

  const jwt = await createSecureToken({ userId: user.userId, role: user.role }, getAppSecret(c));
  return json({
    token: jwt,
    user: { id: user.userId, username: user.username, role: user.role },
  });
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

  const user = await getUserByUsername(c.env, parsed.data.username);
  if (!user || !checkPassword(parsed.data.password, user.password)) {
    return unauthorized({ message: 'Invalid username or password' });
  }

  if (isHostedMode(c.env) && user.email && !user.emailVerifiedAt) {
    return json({ message: 'Please verify your email before signing in.' }, 403);
  }

  const token = await createSecureToken({ userId: user.userId, role: user.role }, getAppSecret(c));
  return json({ token, user: { id: user.userId, username: user.username, role: user.role } });
}

export async function handleLogout(_c: Ctx) {
  return json({ ok: true });
}

function getSsoSecret(c: Ctx): string | null {
  if (c.env.ENVIRONMENT === 'production') {
    return c.env.SSO_SECRET ?? null;
  }
  return c.env.SSO_SECRET || getAppSecret(c);
}

export async function handleSso(c: Ctx) {
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
  if (!user) return unauthorized({ message: 'User not found' });

  const role = user.role;
  const token = await createSecureToken({ userId: user.userId, role }, getAppSecret(c));
  return json({
    token,
    user: { id: user.userId, username: user.username, role },
  });
}

export async function handleVerify(c: Ctx) {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return unauthorized();
  }

  const payload = await parseSecureToken(token, getAppSecret(c));
  if (!payload?.userId || !payload?.role) {
    return unauthorized();
  }

  return json({ user: { id: String(payload.userId), role: String(payload.role) } });
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

  const state = crypto.randomUUID();
  const returnTo = c.req.query('returnTo') ?? undefined;
  await storeOAuthState(c.env, state, { provider, returnTo });

  const url = buildOAuthAuthorizeUrl(c.env, provider, requestOrigin(c), state);
  if (!url) return json({ message: 'OAuth provider not configured' }, 503);

  return c.redirect(url, 302);
}

export async function handleOAuthCallback(c: Ctx) {
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

  const jwt = await createSecureToken(
    { userId: result.user.userId, role: result.user.role },
    getAppSecret(c),
  );
  const dest = result.returnTo ?? '/websites';
  return c.redirect(
    `${dashboardBase(c)}/login?token=${encodeURIComponent(jwt)}&next=${encodeURIComponent(dest)}`,
    302,
  );
}

export async function handleForgotPassword(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const user = await getUserByUsername(c.env, parsed.data.username);
  if (user) {
    const token = uuid();
    await c.env.CACHE.put(`reset:${token}`, user.userId, { expirationTtl: RESET_TTL });
    const resetUrl = `${dashboardBase(c)}/login?reset=${encodeURIComponent(token)}`;
    const to = user.email ?? user.username;
    if (to.includes('@')) {
      await sendPasswordResetEmail(c.env, to, resetUrl).catch(() => {
        console.log(`[password-reset] Reset link for ${user.username}: ${resetUrl}`);
      });
    } else {
      console.log(`[password-reset] Reset link for ${user.username}: ${resetUrl}`);
    }
  }

  return json({ ok: true, message: 'If the account exists, a reset link was sent.' });
}

export async function handleResetPassword(c: Ctx) {
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

  await c.env.CACHE.delete(`reset:${parsed.data.token}`);
  return json({ ok: true });
}

export function getAuth() {
  const auth = new Hono<{ Bindings: Env }>();
  auth.post('/register', handleRegister);
  auth.post('/verify-email', handleVerifyEmail);
  auth.post('/login', handleLogin);
  auth.post('/sso', handleSso);
  auth.post('/logout', handleLogout);
  auth.get('/verify', handleVerify);
  auth.post('/forgot-password', handleForgotPassword);
  auth.post('/reset-password', handleResetPassword);
  auth.get('/oauth/:provider', handleOAuthRedirect);
  auth.get('/oauth/:provider/callback', handleOAuthCallback);
  return auth;
}
