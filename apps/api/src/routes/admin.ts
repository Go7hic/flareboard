import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  ROLES,
  createAdminUserSchema,
  createAdminWebsiteSchema,
  hashPassword,
  updateAdminUserSchema,
  uuid,
} from '@flareboard/shared';
import type { Env } from '../env';
import { bumpTokenVersion } from '../lib/auth-token';
import { logAdminAction, listAuditLog } from '../lib/audit';
import { getAllTeamsAdmin, getAllUsers, getAllWebsitesAdmin } from '../lib/queries';
import { badRequest, forbidden, json } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function requireAdmin(c: Ctx) {
  if (c.get('user').role !== ROLES.admin) return forbidden();
  return null;
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(values: unknown[]) {
  return `${values.map(csvEscape).join(',')}\n`;
}

export async function handleListUsers(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const users = await getAllUsers(c.env);
  return json(users);
}

export async function handleCreateUser(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => null);
  const parsed = createAdminUserSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const userId = uuid();
  const now = new Date();
  const role = parsed.data.role ?? ROLES.user;
  const db = createDb(c.env.DB);
  await db.insert(schema.user).values({
    userId,
    username: parsed.data.username,
    password: hashPassword(parsed.data.password),
    role,
    createdAt: now,
    updatedAt: now,
  });

  await logAdminAction(c.env, c.get('user').userId, 'create', 'user', userId, {
    username: parsed.data.username,
    role,
  });

  return json({ id: userId, username: parsed.data.username, role }, 201);
}

export async function handleListWebsites(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const websites = await getAllWebsitesAdmin(c.env);
  return json(
    websites.map((w) => ({
      id: w.websiteId,
      name: w.name,
      domain: w.domain,
      userId: w.userId,
      teamId: w.teamId,
      createdAt: w.createdAt,
    })),
  );
}

export async function handleListTeams(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const teams = await getAllTeamsAdmin(c.env);
  return json(teams);
}

export async function handleCreateTeam(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => null);
  const name = (body as { name?: string })?.name;
  if (!name?.trim()) return badRequest('name required');

  const teamId = uuid();
  const accessCode = crypto.randomUUID().slice(0, 8);
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.team).values({
    teamId,
    name: name.trim(),
    accessCode,
    createdAt: now,
    updatedAt: now,
  });

  await logAdminAction(c.env, c.get('user').userId, 'create', 'team', teamId, { name: name.trim() });

  return json({ id: teamId, name: name.trim(), accessCode }, 201);
}

export async function handleCreateWebsite(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => null);
  const parsed = createAdminWebsiteSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const websiteId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.website).values({
    websiteId,
    name: parsed.data.name,
    domain: parsed.data.domain ?? null,
    userId: parsed.data.userId,
    createdBy: c.get('user').userId,
    createdAt: now,
    updatedAt: now,
  });

  await c.env.CACHE.put(`website:${websiteId}`, '1', { expirationTtl: 3600 });
  await logAdminAction(c.env, c.get('user').userId, 'create', 'website', websiteId, {
    name: parsed.data.name,
    userId: parsed.data.userId,
  });

  return json({ id: websiteId, name: parsed.data.name, userId: parsed.data.userId }, 201);
}

export async function handleUpdateUser(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const userId = c.req.param('userId');
  if (!userId) return badRequest('userId required');

  const body = await c.req.json().catch(() => null);
  const parsed = updateAdminUserSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const db = createDb(c.env.DB);
  const [user] = await db.select().from(schema.user).where(eq(schema.user.userId, userId)).limit(1);
  if (!user) return json({ message: 'User not found' }, 404);

  const nextRole = parsed.data.role ?? user.role;
  const passwordChanged = Boolean(parsed.data.password);
  const roleChanged = nextRole !== user.role;

  await db
    .update(schema.user)
    .set({
      username: parsed.data.username ?? user.username,
      role: nextRole,
      password: passwordChanged ? hashPassword(parsed.data.password!) : user.password,
      updatedAt: new Date(),
    })
    .where(eq(schema.user.userId, userId));

  if (passwordChanged || roleChanged) {
    await bumpTokenVersion(c.env, userId);
  }

  await logAdminAction(c.env, c.get('user').userId, 'update', 'user', userId, {
    username: parsed.data.username,
    role: parsed.data.role,
  });

  return json({
    id: userId,
    username: parsed.data.username ?? user.username,
    role: parsed.data.role ?? user.role,
  });
}

export async function handleDeleteUser(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const userId = c.req.param('userId');
  if (!userId) return badRequest('userId required');
  if (userId === c.get('user').userId) return badRequest('Cannot delete your own account');

  const db = createDb(c.env.DB);
  const [user] = await db.select().from(schema.user).where(eq(schema.user.userId, userId)).limit(1);
  if (!user) return json({ message: 'User not found' }, 404);

  await db
    .update(schema.user)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.user.userId, userId));

  await bumpTokenVersion(c.env, userId);

  await logAdminAction(c.env, c.get('user').userId, 'delete', 'user', userId, {
    username: user.username,
  });

  return json({ ok: true });
}

export async function handleAuditLog(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 50)));
  const result = await listAuditLog(c.env, page, pageSize);
  return json(result);
}

export async function handleExport(c: Ctx) {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const type = c.req.query('type') ?? 'users';
  const websiteId = c.req.query('websiteId') ?? null;
  const db = createDb(c.env.DB);

  let header: string;
  let rows: string[];

  if (type === 'users') {
    const users = await getAllUsers(c.env);
    header = csvLine(['id', 'username', 'role', 'displayName', 'createdAt']);
    rows = users.map((u) =>
      csvLine([u.id, u.username, u.role, u.displayName ?? '', u.createdAt ?? '']),
    );
  } else if (type === 'websites') {
    const websites = await getAllWebsitesAdmin(c.env);
    header = csvLine(['id', 'name', 'domain', 'userId', 'teamId', 'createdAt']);
    rows = websites.map((w) =>
      csvLine([w.websiteId, w.name, w.domain ?? '', w.userId ?? '', w.teamId ?? '', w.createdAt ?? '']),
    );
  } else if (type === 'events') {
    if (!websiteId) return badRequest('websiteId required for events export');
    const events = await db
      .select({
        eventId: schema.websiteEvent.eventId,
        sessionId: schema.websiteEvent.sessionId,
        visitId: schema.websiteEvent.visitId,
        urlPath: schema.websiteEvent.urlPath,
        eventType: schema.websiteEvent.eventType,
        eventName: schema.websiteEvent.eventName,
        createdAt: schema.websiteEvent.createdAt,
      })
      .from(schema.websiteEvent)
      .where(eq(schema.websiteEvent.websiteId, websiteId))
      .orderBy(schema.websiteEvent.createdAt)
      .limit(50000);
    header = csvLine(['eventId', 'sessionId', 'visitId', 'urlPath', 'eventType', 'eventName', 'createdAt']);
    rows = events.map((e) =>
      csvLine([
        e.eventId,
        e.sessionId,
        e.visitId,
        e.urlPath,
        e.eventType,
        e.eventName ?? '',
        e.createdAt ?? '',
      ]),
    );
  } else {
    return badRequest('type must be users, websites, or events');
  }

  await logAdminAction(c.env, c.get('user').userId, 'export', type, websiteId, { type, websiteId });

  const body = header + rows.join('');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="flareboard-${type}${websiteId ? `-${websiteId}` : ''}.csv"`,
    },
  });
}
