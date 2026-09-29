import { and, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { uuid } from '@flareboard/shared';
import type { Env } from '../env';

export async function logAdminAction(
  env: Env,
  userId: string,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
) {
  const db = createDb(env.DB);
  await db.insert(schema.auditLog).values({
    id: uuid(),
    userId,
    action,
    entityType,
    entityId: entityId ?? null,
    metadata: metadata ?? null,
    createdAt: new Date(),
  });
}

export async function listAuditLog(env: Env, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const db = createDb(env.DB);

  const rows = await db
    .select({
      id: schema.auditLog.id,
      userId: schema.auditLog.userId,
      username: schema.user.username,
      action: schema.auditLog.action,
      entityType: schema.auditLog.entityType,
      entityId: schema.auditLog.entityId,
      metadata: schema.auditLog.metadata,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .innerJoin(schema.user, eq(schema.auditLog.userId, schema.user.userId))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [countRow] = await db.select({ count: count() }).from(schema.auditLog);

  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata,
      createdAt: r.createdAt,
    })),
    page,
    pageSize,
    total: countRow?.count ?? 0,
  };
}

export async function listEntityAuditLog(env: Env, entityType: string, entityId: string, page: number, pageSize: number) {
  return listAuditLogWhere(
    env,
    and(eq(schema.auditLog.entityType, entityType), eq(schema.auditLog.entityId, entityId)),
    page,
    pageSize,
  );
}

/**
 * Account activity: everything recorded against the user's own account, including sign-ins
 * and failed sign-in attempts (which are filed under the account they targeted).
 */
export async function listUserAuditLog(env: Env, userId: string, page: number, pageSize: number) {
  return listAuditLogWhere(env, eq(schema.auditLog.userId, userId), page, pageSize);
}

/** Team activity: membership and settings changes, plus changes to the team's websites. */
export async function listTeamAuditLog(env: Env, teamId: string, page: number, pageSize: number) {
  return listAuditLogWhere(
    env,
    or(
      and(eq(schema.auditLog.entityType, 'team'), eq(schema.auditLog.entityId, teamId)),
      and(
        eq(schema.auditLog.entityType, 'website'),
        sql`${schema.auditLog.entityId} IN (SELECT website_id FROM website WHERE team_id = ${teamId})`,
      ),
    ),
    page,
    pageSize,
  );
}

async function listAuditLogWhere(env: Env, where: SQL | undefined, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const db = createDb(env.DB);

  const rows = await db
    .select({
      id: schema.auditLog.id,
      userId: schema.auditLog.userId,
      username: schema.user.username,
      action: schema.auditLog.action,
      entityType: schema.auditLog.entityType,
      entityId: schema.auditLog.entityId,
      metadata: schema.auditLog.metadata,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .innerJoin(schema.user, eq(schema.auditLog.userId, schema.user.userId))
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [countRow] = await db.select({ count: count() }).from(schema.auditLog).where(where);

  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata,
      createdAt: r.createdAt,
    })),
    page,
    pageSize,
    total: countRow?.count ?? 0,
  };
}
