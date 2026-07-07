import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  ROLES,
  createTeamSchema,
  createTeamWebsiteSchema,
  getPlan,
  joinTeamSchema,
  updateTeamSchema,
  updateTeamUserSchema,
  uuid,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateTeam, userHasTeamAccess } from '../lib/access';
import { getUserSubscription, isHostedMode } from '../lib/billing';
import { getTeamByAccessCode, getTeamById, getTeamWebsites, getUserTeams } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

async function requireTeamsPlan(c: Ctx): Promise<Response | null> {
  if (!isHostedMode(c.env)) return null;
  const sub = await getUserSubscription(c.env, c.get('user').userId);
  if (!getPlan(sub.planId).teamsEnabled) {
    return json({ message: 'Teams require a paid plan.' }, 403);
  }
  return null;
}

function randomAccessCode() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function serializeTeam(team: { teamId: string; name: string; accessCode: string | null; createdAt?: Date | null }, role?: string) {
  return {
    id: team.teamId,
    name: team.name,
    accessCode: team.accessCode ?? undefined,
    role,
    createdAt: team.createdAt,
  };
}

export async function handleList(c: Ctx) {
  const user = c.get('user');
  const teams = await getUserTeams(c.env, user.userId);
  return json(teams.map((t) => serializeTeam({ teamId: t.id, name: t.name, accessCode: t.accessCode, createdAt: t.createdAt }, t.role)));
}

export async function handleCreate(c: Ctx) {
  const planDenied = await requireTeamsPlan(c);
  if (planDenied) return planDenied;

  const body = await c.req.json().catch(() => null);
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const user = c.get('user');
  const teamId = uuid();
  const teamUserId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);

  await db.insert(schema.team).values({
    teamId,
    name: parsed.data.name,
    accessCode: randomAccessCode(),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.teamUser).values({
    teamUserId,
    teamId,
    userId: user.userId,
    role: ROLES.teamOwner,
    createdAt: now,
    updatedAt: now,
  });

  const team = await getTeamById(c.env, teamId);
  return json(serializeTeam(team!, ROLES.teamOwner), 201);
}

export async function handleGet(c: Ctx) {
  const teamId = c.req.param('teamId');
  if (!teamId) return notFound();
  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  if (!membership && c.get('user').role !== ROLES.admin) {
    return notFound();
  }

  const websites = await getTeamWebsites(c.env, teamId);
  return json({
    ...serializeTeam(team, membership?.role),
    websites: websites.map((w) => ({
      id: w.websiteId,
      name: w.name,
      domain: w.domain ?? undefined,
    })),
  });
}

export async function handleStatus(c: Ctx) {
  const teamId = c.req.param('teamId');
  if (!teamId) return notFound();
  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  const isAdmin = c.get('user').role === ROLES.admin;
  if (!membership && !isAdmin) {
    return notFound();
  }

  const db = createDb(c.env.DB);
  const members = await db
    .select({
      userId: schema.teamUser.userId,
      username: schema.user.username,
      role: schema.teamUser.role,
      createdAt: schema.teamUser.createdAt,
    })
    .from(schema.teamUser)
    .innerJoin(schema.user, eq(schema.teamUser.userId, schema.user.userId))
    .where(eq(schema.teamUser.teamId, teamId));
  const websites = await getTeamWebsites(c.env, teamId);
  const roles = members.reduce<Record<string, number>>((acc, member) => {
    acc[member.role] = (acc[member.role] ?? 0) + 1;
    return acc;
  }, {});
  const readonlyMemberCount = members.filter((member) => member.role === ROLES.teamViewOnly).length;

  return json({
    teamId,
    teamName: team.name,
    currentUserRole: membership?.role ?? ROLES.admin,
    canManageMembers: canManageMembers(membership?.role, isAdmin),
    memberCount: members.length,
    editableMemberCount: members.length - readonlyMemberCount,
    readonlyMemberCount,
    websiteCount: websites.length,
    roles,
    members: members.map((member) => ({
      userId: member.userId,
      username: member.username,
      role: member.role,
      createdAt: member.createdAt,
    })),
  });
}

export async function handleUpdate(c: Ctx) {
  const teamId = c.req.param('teamId');
  if (!teamId) return notFound();
  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  if (
    !membership ||
    (membership.role !== ROLES.teamOwner && membership.role !== ROLES.teamManager && c.get('user').role !== ROLES.admin)
  ) {
    return notFound();
  }
  if (!(await canMutateTeam(c.env, teamId, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateTeamSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  await db
    .update(schema.team)
    .set({ name: parsed.data.name ?? team.name, updatedAt: new Date() })
    .where(eq(schema.team.teamId, teamId));

  const updated = await getTeamById(c.env, teamId);
  return json(serializeTeam(updated!, membership.role));
}

export async function handleDelete(c: Ctx) {
  const teamId = c.req.param('teamId');
  if (!teamId) return notFound();
  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  if (membership?.role !== ROLES.teamOwner && c.get('user').role !== ROLES.admin) {
    return notFound();
  }

  const db = createDb(c.env.DB);
  await db
    .update(schema.team)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.team.teamId, teamId));

  return json({ ok: true });
}

export async function handleJoin(c: Ctx) {
  const planDenied = await requireTeamsPlan(c);
  if (planDenied) return planDenied;

  const ip = getTrustedClientIp(c.req.raw);
  const rl = await checkIpRateLimit(c.env, 'team-join', ip, 10, 60);
  if (!rl.allowed) {
    return json({ message: 'Too many join attempts' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = joinTeamSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const team = await getTeamByAccessCode(c.env, parsed.data.accessCode);
  if (!team) return notFound('Team not found');

  const user = c.get('user');
  const existing = await userHasTeamAccess(c.env, user.userId, team.teamId);
  if (existing) {
    return json(serializeTeam(team, existing.role));
  }

  const db = createDb(c.env.DB);
  const now = new Date();
  await db.insert(schema.teamUser).values({
    teamUserId: uuid(),
    teamId: team.teamId,
    userId: user.userId,
    role: ROLES.teamMember,
    createdAt: now,
    updatedAt: now,
  });

  return json(serializeTeam(team, ROLES.teamMember), 201);
}

export async function handleCreateWebsite(c: Ctx) {
  const planDenied = await requireTeamsPlan(c);
  if (planDenied) return planDenied;

  const teamId = c.req.param('teamId');
  if (!teamId) return notFound();

  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  if (
    !membership ||
    (membership.role !== ROLES.teamOwner &&
      membership.role !== ROLES.teamManager &&
      c.get('user').role !== ROLES.admin)
  ) {
    return notFound();
  }
  if (!(await canMutateTeam(c.env, teamId, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createTeamWebsiteSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const { checkWebsiteLimit } = await import('../lib/billing');
  const user = c.get('user');
  const limit = await checkWebsiteLimit(c.env, user.userId);
  if (!limit.ok) return badRequest(limit.message);

  const websiteId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);

  await db.insert(schema.website).values({
    websiteId,
    name: parsed.data.name,
    domain: parsed.data.domain,
    teamId,
    userId: user.userId,
    createdBy: user.userId,
    createdAt: now,
    updatedAt: now,
  });

  await c.env.CACHE.put(`website:${websiteId}`, '1', { expirationTtl: 3600 });
  const website = await getTeamWebsites(c.env, teamId);
  const created = website.find((w) => w.websiteId === websiteId);
  return json(
    {
      id: websiteId,
      name: parsed.data.name,
      domain: parsed.data.domain,
      teamId,
    },
    201,
  );
}

function canManageMembers(role: string | undefined, isAdmin: boolean) {
  return isAdmin || role === ROLES.teamOwner || role === ROLES.teamManager;
}

export async function handleListUsers(c: Ctx) {
  const teamId = c.req.param('teamId');
  if (!teamId) return notFound();
  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  if (!membership && c.get('user').role !== ROLES.admin) {
    return notFound();
  }

  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      id: schema.teamUser.teamUserId,
      userId: schema.teamUser.userId,
      username: schema.user.username,
      role: schema.teamUser.role,
      createdAt: schema.teamUser.createdAt,
    })
    .from(schema.teamUser)
    .innerJoin(schema.user, eq(schema.teamUser.userId, schema.user.userId))
    .where(eq(schema.teamUser.teamId, teamId));

  return json(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username,
      role: r.role,
      createdAt: r.createdAt,
    })),
  );
}

export async function handleUpdateUser(c: Ctx) {
  const teamId = c.req.param('teamId');
  const targetUserId = c.req.param('userId');
  if (!teamId || !targetUserId) return notFound();

  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  if (!canManageMembers(membership?.role, c.get('user').role === ROLES.admin)) {
    return notFound();
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateTeamUserSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  const [row] = await db
    .select()
    .from(schema.teamUser)
    .where(and(eq(schema.teamUser.teamId, teamId), eq(schema.teamUser.userId, targetUserId)))
    .limit(1);
  if (!row) return notFound();

  if (row.role === ROLES.teamOwner && membership?.role !== ROLES.teamOwner && c.get('user').role !== ROLES.admin) {
    return badRequest('Only team owners can change owner roles');
  }

  if (row.role === ROLES.teamOwner && parsed.data.role !== ROLES.teamOwner) {
    const owners = await db
      .select()
      .from(schema.teamUser)
      .where(and(eq(schema.teamUser.teamId, teamId), eq(schema.teamUser.role, ROLES.teamOwner)));
    if (owners.length <= 1) return badRequest('Team must have at least one owner');
  }

  await db
    .update(schema.teamUser)
    .set({ role: parsed.data.role, updatedAt: new Date() })
    .where(eq(schema.teamUser.teamUserId, row.teamUserId));

  return json({ userId: targetUserId, role: parsed.data.role });
}

export async function handleDeleteUser(c: Ctx) {
  const teamId = c.req.param('teamId');
  const targetUserId = c.req.param('userId');
  if (!teamId || !targetUserId) return notFound();

  const team = await getTeamById(c.env, teamId);
  if (!team) return notFound();

  const membership = await userHasTeamAccess(c.env, c.get('user').userId, teamId);
  const isAdmin = c.get('user').role === ROLES.admin;
  const self = targetUserId === c.get('user').userId;
  if (!self && !canManageMembers(membership?.role, isAdmin)) {
    return notFound();
  }

  const db = createDb(c.env.DB);
  const [row] = await db
    .select()
    .from(schema.teamUser)
    .where(and(eq(schema.teamUser.teamId, teamId), eq(schema.teamUser.userId, targetUserId)))
    .limit(1);
  if (!row) return notFound();

  if (row.role === ROLES.teamOwner && !self && membership?.role !== ROLES.teamOwner && !isAdmin) {
    return badRequest('Only team owners can remove owners');
  }

  if (row.role === ROLES.teamOwner) {
    const owners = await db
      .select()
      .from(schema.teamUser)
      .where(and(eq(schema.teamUser.teamId, teamId), eq(schema.teamUser.role, ROLES.teamOwner)));
    if (owners.length <= 1) return badRequest('Cannot remove the only team owner');
  }

  await db.delete(schema.teamUser).where(eq(schema.teamUser.teamUserId, row.teamUserId));
  return json({ ok: true });
}
