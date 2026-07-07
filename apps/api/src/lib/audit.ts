import { and, count, desc, eq } from 'drizzle-orm';
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
  const offset = (page - 1) * pageSize;
  const db = createDb(env.DB);
  const where = and(eq(schema.auditLog.entityType, entityType), eq(schema.auditLog.entityId, entityId));

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
