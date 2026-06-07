import { and, eq } from 'drizzle-orm';
import { createDb, schema, type Website } from '@flareboard/db';

type Link = typeof schema.link.$inferSelect;
type Pixel = typeof schema.pixel.$inferSelect;
import { ROLES, type AuthUser } from '@flareboard/shared';
import type { Env } from '../env';

export function isGlobalReadOnly(role: string) {
  return role === ROLES.viewOnly || role === ROLES.teamViewOnly;
}

export function isTeamReadOnly(teamRole: string) {
  return teamRole === ROLES.teamViewOnly;
}

export async function userHasTeamAccess(env: Env, userId: string, teamId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.teamUser)
    .where(and(eq(schema.teamUser.teamId, teamId), eq(schema.teamUser.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function canAccessWebsite(env: Env, website: Website, user: AuthUser) {
  if (user.role === ROLES.admin) return true;
  if (website.userId === user.userId) return true;
  if (website.teamId) {
    const membership = await userHasTeamAccess(env, user.userId, website.teamId);
    return Boolean(membership);
  }
  return false;
}

export async function canMutateWebsite(env: Env, website: Website, user: AuthUser) {
  if (user.role === ROLES.admin) return true;
  if (isGlobalReadOnly(user.role)) return false;
  if (website.userId === user.userId) return true;
  if (website.teamId) {
    const membership = await userHasTeamAccess(env, user.userId, website.teamId);
    if (!membership) return false;
    return !isTeamReadOnly(membership.role);
  }
  return false;
}

export async function canMutateTeam(
  env: Env,
  teamId: string,
  user: AuthUser,
  allowSelfLeave = false,
) {
  if (user.role === ROLES.admin) return true;
  if (isGlobalReadOnly(user.role)) return false;
  const membership = await userHasTeamAccess(env, user.userId, teamId);
  if (!membership) return false;
  if (allowSelfLeave) return true;
  return !isTeamReadOnly(membership.role);
}

export async function canAccessTeamResource(
  env: Env,
  resource: { userId: string | null; teamId: string | null },
  user: AuthUser,
) {
  if (user.role === ROLES.admin) return true;
  if (resource.userId === user.userId) return true;
  if (resource.teamId) {
    const membership = await userHasTeamAccess(env, user.userId, resource.teamId);
    return Boolean(membership);
  }
  return false;
}

export async function canMutateTeamResource(
  env: Env,
  resource: { userId: string | null; teamId: string | null },
  user: AuthUser,
) {
  if (user.role === ROLES.admin) return true;
  if (isGlobalReadOnly(user.role)) return false;
  if (resource.userId === user.userId) return true;
  if (resource.teamId) {
    const membership = await userHasTeamAccess(env, user.userId, resource.teamId);
    if (!membership) return false;
    return !isTeamReadOnly(membership.role);
  }
  return false;
}

export async function canAccessLink(env: Env, link: Link, user: AuthUser) {
  return canAccessTeamResource(env, link, user);
}

export async function canAccessPixel(env: Env, pixel: Pixel, user: AuthUser) {
  return canAccessTeamResource(env, pixel, user);
}

export async function canMutateLink(env: Env, link: Link, user: AuthUser) {
  return canMutateTeamResource(env, link, user);
}

export async function canMutatePixel(env: Env, pixel: Pixel, user: AuthUser) {
  return canMutateTeamResource(env, pixel, user);
}
