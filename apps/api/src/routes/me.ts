import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { checkPassword, hashPassword, updatePasswordSchema, updateProfileSchema } from '@flareboard/shared';
import type { Env } from '../env';
import { bumpTokenVersion, issueAuthToken } from '../lib/auth-token';
import { badRequest, json, unauthorized } from '../lib/response';
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
  });
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
  await bumpTokenVersion(c.env, user.userId);
  const token = await issueAuthToken(c, { userId: user.userId, role: user.role });
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
