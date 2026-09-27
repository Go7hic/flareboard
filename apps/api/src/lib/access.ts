import { and, eq, isNull } from 'drizzle-orm';
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

/** The caller's membership in a team that still exists (deleted teams grant nothing). */
export async function userHasTeamAccess(env: Env, userId: string, teamId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select({ membership: schema.teamUser })
    .from(schema.teamUser)
    .innerJoin(schema.team, eq(schema.team.teamId, schema.teamUser.teamId))
    .where(
      and(
        eq(schema.teamUser.teamId, teamId),
        eq(schema.teamUser.userId, userId),
        isNull(schema.team.deletedAt),
      ),
    )
    .limit(1);
  return rows[0]?.membership ?? null;
}

async function isTeamLive(env: Env, teamId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select({ teamId: schema.team.teamId })
    .from(schema.team)
    .where(and(eq(schema.team.teamId, teamId), isNull(schema.team.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Team websites belong to the team: access comes from membership. The creator
 * (website.userId) keeps access only once the team itself is gone, so a member who
 * is removed from the team loses the sites they created there.
 */
async function teamWebsiteMembership(env: Env, website: Website, userId: string) {
  const membership = await userHasTeamAccess(env, userId, website.teamId!);
  if (membership) return { role: membership.role };
  if (website.userId === userId && !(await isTeamLive(env, website.teamId!))) return { role: null };
  return null;
}

/**
 * Whether a user id (not necessarily the caller) can access a website —
 * used to validate references like error-issue assignees.
 */
export async function userIdHasWebsiteAccess(env: Env, website: Website, userId: string) {
  if (website.teamId) return Boolean(await teamWebsiteMembership(env, website, userId));
  return website.userId === userId;
}

export async function canAccessWebsite(env: Env, website: Website, user: AuthUser) {
  if (user.role === ROLES.admin) return true;
  return userIdHasWebsiteAccess(env, website, user.userId);
}

export async function canMutateWebsite(env: Env, website: Website, user: AuthUser) {
  if (user.role === ROLES.admin) return true;
  if (isGlobalReadOnly(user.role)) return false;
  if (!website.teamId) return website.userId === user.userId;
  const membership = await teamWebsiteMembership(env, website, user.userId);
  return Boolean(membership) && !(membership!.role && isTeamReadOnly(membership!.role));
}

function websiteModulePermissions(canView: boolean, canEdit: boolean, canManageTeam: boolean) {
  const editableModule = { canView, canEdit };
  return {
    // Saved insights, action definitions and people edits: the API authorizes these with
    // canMutateWebsite, so the module must not be hard-wired read-only.
    analytics: editableModule,
    boards: editableModule,
    featureFlags: editableModule,
    experiments: editableModule,
    errors: editableModule,
    logs: editableModule,
    surveys: editableModule,
    warehouse: editableModule,
    settings: editableModule,
    team: { canView, canEdit: canManageTeam },
  };
}

export async function getWebsitePermissions(env: Env, website: Website, user: AuthUser) {
  if (user.role === ROLES.admin) {
    return {
      role: ROLES.admin,
      canView: true,
      canEdit: true,
      canManageTeam: true,
      capabilities: {
        viewAnalytics: true,
        editWebsite: true,
        manageMembers: true,
        manageWebsites: true,
      },
      modules: websiteModulePermissions(true, true, true),
    };
  }

  const membership = website.teamId ? await userHasTeamAccess(env, user.userId, website.teamId) : null;
  const canView = website.userId === user.userId || Boolean(membership);
  const canEdit = await canMutateWebsite(env, website, user);
  const role = membership?.role ?? user.role;
  const canManageTeam =
    Boolean(membership && (membership.role === ROLES.teamOwner || membership.role === ROLES.teamManager)) &&
    !isGlobalReadOnly(user.role);

  return {
    role,
    canView,
    canEdit,
    canManageTeam,
    capabilities: {
      viewAnalytics: canView,
      editWebsite: canEdit,
      manageMembers: canManageTeam,
      manageWebsites: canManageTeam,
    },
    modules: websiteModulePermissions(canView, canEdit, canManageTeam),
  };
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
