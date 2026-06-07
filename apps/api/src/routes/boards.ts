import type { Context } from 'hono';
import { eq, inArray, or } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { ENTITY_TYPE, createBoardSchema, updateBoardSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { getUserTeams } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function serializeBoard(b: typeof schema.board.$inferSelect) {
  return {
    id: b.boardId,
    type: b.type,
    name: b.name,
    description: b.description,
    parameters: b.parameters,
    userId: b.userId,
    teamId: b.teamId,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export async function handleList(c: Ctx) {
  const db = createDb(c.env.DB);
  const userId = c.get('user').userId;
  const teams = await getUserTeams(c.env, userId);
  const teamIds = teams.map((t) => t.id);
  const rows = await db
    .select()
    .from(schema.board)
    .where(
      teamIds.length
        ? or(eq(schema.board.userId, userId), inArray(schema.board.teamId, teamIds))
        : eq(schema.board.userId, userId),
    )
    .orderBy(schema.board.createdAt);
  return json(rows.map(serializeBoard));
}

async function canAccessBoard(c: Ctx, board: typeof schema.board.$inferSelect) {
  if (board.userId === c.get('user').userId) return true;
  if (!board.teamId) return false;
  const teams = await getUserTeams(c.env, c.get('user').userId);
  return teams.some((t) => t.id === board.teamId);
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createBoardSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const boardId = uuid();
  const now = new Date();
  const db = createDb(c.env.DB);
  await db.insert(schema.board).values({
    boardId,
    type: parsed.data.type,
    name: parsed.data.name,
    description: parsed.data.description ?? '',
    parameters: parsed.data.parameters,
    userId: c.get('user').userId,
    teamId: parsed.data.teamId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  return json(serializeBoard(board!), 201);
}

export async function handleGet(c: Ctx) {
  const boardId = c.req.param('boardId') ?? '';
  const db = createDb(c.env.DB);
  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  if (!board || !(await canAccessBoard(c, board))) return notFound();
  return json(serializeBoard(board));
}

export async function handleUpdate(c: Ctx) {
  const boardId = c.req.param('boardId') ?? '';
  const db = createDb(c.env.DB);
  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  if (!board || board.userId !== c.get('user').userId) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateBoardSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  await db
    .update(schema.board)
    .set({
      name: parsed.data.name ?? board.name,
      description: parsed.data.description ?? board.description,
      parameters: parsed.data.parameters ?? board.parameters,
      updatedAt: new Date(),
    })
    .where(eq(schema.board.boardId, boardId));

  const [updated] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  return json(serializeBoard(updated!));
}

export async function handleDelete(c: Ctx) {
  const boardId = c.req.param('boardId') ?? '';
  const db = createDb(c.env.DB);
  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  if (!board || board.userId !== c.get('user').userId) return notFound();
  await db.delete(schema.board).where(eq(schema.board.boardId, boardId));
  await db.delete(schema.share).where(eq(schema.share.entityId, boardId));
  return json({ ok: true });
}

export async function handleShareCreate(c: Ctx) {
  const boardId = c.req.param('boardId') ?? '';
  const db = createDb(c.env.DB);
  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  if (!board || board.userId !== c.get('user').userId) return notFound();

  const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
  const shareId = uuid();
  const slug = crypto.randomUUID().replace(/-/g, '');
  const now = new Date();
  await db.insert(schema.share).values({
    shareId,
    entityId: boardId,
    name: body?.name ?? board.name,
    shareType: ENTITY_TYPE.board,
    slug,
    parameters: { boardId },
    createdAt: now,
    updatedAt: now,
  });

  return json({ id: shareId, slug, entityId: boardId }, 201);
}
