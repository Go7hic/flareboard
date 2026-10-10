import type { Context } from 'hono';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { checkPassword, hashPassword, ROLES, updatePasswordSchema, updateProfileSchema } from '@flareboard/shared';
import type { Env } from '../env';
import { logAdminAction } from '../lib/audit';
import { twoFactorBlockedTeams } from '../lib/access';
import { bumpTokenVersion, issueAuthToken, startSession } from '../lib/auth-token';
import { handOverTeamWebsites, stripeRequest } from '../lib/billing';
import { DELETION_GRACE_DAYS } from '../lib/data-deletion';
import { isDemoUserId } from '../lib/demo-access';
import { badRequest, json, unauthorized } from '../lib/response';
import { clearSessionCookie, setSessionCookie } from '../lib/session-cookie';
import { hasKnownPassword } from '../lib/sign-in-methods';
import { hasTwoFactor } from '../lib/two-factor';
import { extendUserSession, revokeOtherUserSessions } from '../lib/user-sessions';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleMe(c: Ctx) {
  const db = createDb(c.env.DB);
  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.userId, c.get('user').userId))
    .limit(1);
  if (!user) return unauthorized();
  return json({
    id: user.userId,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    createdAt: user.createdAt,
    // Accounts created through Google/GitHub have no password the user knows.
    passwordRequired: await hasKnownPassword(c.env, user),
    twoFactorEnabled: await hasTwoFactor(c.env, user.userId),
    // Teams that stay locked until this user enables two-factor authentication.
    twoFactorRequiredBy: await twoFactorBlockedTeams(c.env, user.userId),
    // The shared read-only demo account: the dashboard shows the demo banner and hides changes.
    isDemo: isDemoUserId(user.userId),
  });
}

const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

/**
 * Self-service account deletion. Cancels any paid subscription, soft-deletes the account and
 * the websites that belong only to it, and signs the user out everywhere. The scheduled
 * deletion job (lib/data-deletion.ts) erases the data after DELETION_GRACE_DAYS.
 */
export async function handleDeleteAccount(c: Ctx) {
  const body = (await c.req.json().catch(() => null)) as { confirm?: unknown; password?: unknown } | null;
  const db = createDb(c.env.DB);
  const [user] = await db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.userId, c.get('user').userId), isNull(schema.user.deletedAt)))
    .limit(1);
  if (!user) return unauthorized();

  if (typeof body?.confirm !== 'string' || body.confirm.trim().toLowerCase() !== user.username.toLowerCase()) {
    return badRequest('Type your username to confirm.');
  }
  if (await hasKnownPassword(c.env, user)) {
    if (typeof body.password !== 'string' || !checkPassword(body.password, user.password)) {
      return unauthorized({ message: 'Password is incorrect' });
    }
  }

  if (user.role === ROLES.admin) {
    const [otherAdmin] = await db
      .select({ userId: schema.user.userId })
      .from(schema.user)
      .where(and(eq(schema.user.role, ROLES.admin), ne(schema.user.userId, user.userId), isNull(schema.user.deletedAt)))
      .limit(1);
    if (!otherAdmin) {
      return json(
        { code: 'only_admin', message: 'You are the only admin. Make another user an admin before deleting your account.' },
        409,
      );
    }
  }

  // Teams: a sole member takes the team with them; an owner with members must hand it over first.
  const memberships = await db
    .select({ teamId: schema.teamUser.teamId, role: schema.teamUser.role, name: schema.team.name })
    .from(schema.teamUser)
    .innerJoin(schema.team, eq(schema.team.teamId, schema.teamUser.teamId))
    .where(and(eq(schema.teamUser.userId, user.userId), isNull(schema.team.deletedAt)));
  const soleTeams: string[] = [];
  const blocking: string[] = [];
  for (const membership of memberships) {
    const others = await db
      .select({ role: schema.teamUser.role })
      .from(schema.teamUser)
      .where(and(eq(schema.teamUser.teamId, membership.teamId), ne(schema.teamUser.userId, user.userId)));
    if (!others.length) soleTeams.push(membership.teamId);
    else if (membership.role === ROLES.teamOwner && !others.some((other) => other.role === ROLES.teamOwner)) {
      blocking.push(membership.name);
    }
  }
  if (blocking.length) {
    return json(
      {
        code: 'team_owner_required',
        message: `Make another member an owner of ${blocking.join(', ')} before deleting your account.`,
        teams: blocking,
      },
      409,
    );
  }

  // Cancel billing first: if Stripe fails, nothing else changes and the user can retry.
  const [subscription] = await db
    .select()
    .from(schema.userSubscription)
    .where(eq(schema.userSubscription.userId, user.userId))
    .limit(1);
  if (subscription?.stripeSubscriptionId && LIVE_SUBSCRIPTION_STATUSES.has(subscription.status ?? '')) {
    try {
      await stripeRequest(c.env, `/subscriptions/${encodeURIComponent(subscription.stripeSubscriptionId)}`, {}, 'DELETE');
    } catch (err) {
      console.error(JSON.stringify({ event: 'account_delete_stripe_cancel_failed', userId: user.userId, error: String(err) }));
      return json(
        { code: 'billing_cancel_failed', message: 'We could not cancel your subscription. Please try again or contact support.' },
        502,
      );
    }
    await db
      .update(schema.userSubscription)
      .set({ status: 'canceled', planId: 'free', updatedAt: new Date() })
      .where(eq(schema.userSubscription.userId, user.userId));
  }

  const now = new Date();
  if (soleTeams.length) {
    await db.update(schema.team).set({ deletedAt: now, updatedAt: now }).where(inArray(schema.team.teamId, soleTeams));
    await db
      .update(schema.website)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(schema.website.teamId, soleTeams), isNull(schema.website.deletedAt)));
  }
  await db
    .update(schema.website)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(schema.website.userId, user.userId), isNull(schema.website.teamId), isNull(schema.website.deletedAt)));
  // Team websites they created were billed to them (and their plan was just cancelled): a teammate takes over.
  await handOverTeamWebsites(c.env, user.userId, now.getTime());
  await db.delete(schema.teamUser).where(eq(schema.teamUser.userId, user.userId));
  await db.update(schema.user).set({ deletedAt: now, updatedAt: now }).where(eq(schema.user.userId, user.userId));

  await bumpTokenVersion(c.env, user.userId);
  await revokeOtherUserSessions(c.env, user.userId, null);
  await logAdminAction(c.env, user.userId, 'delete', 'user', user.userId, { self: true });
  clearSessionCookie(c);
  return json({ ok: true, erasedWithinDays: DELETION_GRACE_DAYS });
}

export async function handleUpdatePassword(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = updatePasswordSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.userId, c.get('user').userId))
    .limit(1);
  if (!user || !checkPassword(parsed.data.currentPassword, user.password)) {
    return unauthorized({ message: 'Current password is incorrect' });
  }

  await db
    .update(schema.user)
    .set({ password: hashPassword(parsed.data.newPassword), updatedAt: new Date() })
    .where(eq(schema.user.userId, user.userId));

  // Invalidate other sessions, then hand this device a fresh token so it stays signed in.
  const current = c.get('sessionId');
  const revoked = await revokeOtherUserSessions(c.env, user.userId, current);
  await bumpTokenVersion(c.env, user.userId);
  let sessionId = current;
  if (sessionId) await extendUserSession(c.env, sessionId);
  else sessionId = (await startSession(c, { userId: user.userId, role: user.role }, 'password')).sessionId;
  const token = await issueAuthToken(c, { userId: user.userId, role: user.role }, sessionId);
  setSessionCookie(c, token);
  await logAdminAction(c.env, user.userId, 'password_change', 'user', user.userId, { sessionsRevoked: revoked });
  return json({ ok: true, token });
}

export async function handleUpdateProfile(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.userId, c.get('user').userId))
    .limit(1);
  if (!user) return unauthorized();

  await db
    .update(schema.user)
    .set({
      displayName: parsed.data.displayName !== undefined ? parsed.data.displayName : user.displayName,
      logoUrl: parsed.data.logoUrl !== undefined ? parsed.data.logoUrl : user.logoUrl,
      updatedAt: new Date(),
    })
    .where(eq(schema.user.userId, user.userId));

  return json({
    id: user.userId,
    username: user.username,
    role: user.role,
    displayName: parsed.data.displayName !== undefined ? parsed.data.displayName : user.displayName,
    logoUrl: parsed.data.logoUrl !== undefined ? parsed.data.logoUrl : user.logoUrl,
  });
}
