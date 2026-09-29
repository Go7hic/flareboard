import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  BOARD_TEMPLATES,
  ENTITY_TYPE,
  boardParametersSchema,
  createBoardFromTemplateSchema,
  createBoardSchema,
  createEntityShareSchema,
  findBoardTemplate,
  parseBoardFilters,
  propertyFiltersSchema,
  updateBoardSchema,
  uuid,
  type PropertyFilter,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessTeamResource, canMutateTeam, canMutateTeamResource, canMutateWebsite } from '../lib/access';
import { boardRunRange, runBoardWidgets } from '../lib/board-run';
import {
  parseBoardWidgets,
  validateBoardWidgetsForUser,
} from '../lib/board-widgets';
import { logAdminAction } from '../lib/audit';
import { deleteBoardDependents } from '../lib/dashboard-cleanup';
import { resolveInsightQuery } from '../lib/insights';
import { getAccessibleBoards, getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;
type BoardRow = typeof schema.board.$inferSelect;

function serializeBoard(b: BoardRow) {
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

/** Rejects malformed range presets and board filters before they are saved. */
function parametersProblem(parameters: unknown): string | null {
  const parsed = boardParametersSchema.safeParse(parameters ?? {});
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid board parameters';
}

export async function handleList(c: Ctx) {
  const rows = await getAccessibleBoards(c.env, c.get('user').userId);
  const boards = await Promise.all(
    rows.map(async (row) => ({ ...serializeBoard(row), canEdit: await canMutateTeamResource(c.env, row, c.get('user')) })),
  );
  return json(boards);
}

async function loadBoard(c: Ctx): Promise<BoardRow | null> {
  const boardId = c.req.param('boardId') ?? '';
  const db = createDb(c.env.DB);
  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  return board ?? null;
}

export async function handleCreate(c: Ctx) {
  const body = await c.req.json().catch(() => null);
  const parsed = createBoardSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  if (parsed.data.teamId && !(await canMutateTeam(c.env, parsed.data.teamId, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const problem = parametersProblem(parsed.data.parameters);
  if (problem) return badRequest(problem);

  const widgetError = await validateBoardWidgetsForUser(
    c.env,
    c.get('user'),
    parseBoardWidgets(parsed.data.parameters),
  );
  if (widgetError) return badRequest(widgetError);

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
  const board = await loadBoard(c);
  if (!board || !(await canAccessTeamResource(c.env, board, c.get('user')))) return notFound();
  return json({ ...serializeBoard(board), canEdit: await canMutateTeamResource(c.env, board, c.get('user')) });
}

export async function handleUpdate(c: Ctx) {
  const board = await loadBoard(c);
  if (!board || !(await canAccessTeamResource(c.env, board, c.get('user')))) return notFound();
  if (!(await canMutateTeamResource(c.env, board, c.get('user')))) return json({ message: 'Read-only access' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = updateBoardSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const nextParameters = parsed.data.parameters ?? board.parameters;
  const problem = parametersProblem(nextParameters);
  if (problem) return badRequest(problem);
  const widgetError = await validateBoardWidgetsForUser(
    c.env,
    c.get('user'),
    parseBoardWidgets(nextParameters),
  );
  if (widgetError) return badRequest(widgetError);

  const db = createDb(c.env.DB);
  await db
    .update(schema.board)
    .set({
      name: parsed.data.name ?? board.name,
      description: parsed.data.description ?? board.description,
      parameters: nextParameters,
      updatedAt: new Date(),
    })
    .where(eq(schema.board.boardId, board.boardId));

  const [updated] = await db.select().from(schema.board).where(eq(schema.board.boardId, board.boardId)).limit(1);
  return json(serializeBoard(updated!));
}

export async function handleDelete(c: Ctx) {
  const board = await loadBoard(c);
  if (!board || !(await canMutateTeamResource(c.env, board, c.get('user')))) return notFound();
  await deleteBoardDependents(c.env, board.boardId);
  const db = createDb(c.env.DB);
  await db.delete(schema.board).where(eq(schema.board.boardId, board.boardId));
  return json({ ok: true });
}

/**
 * Every widget of the board with data: `?startAt=&endAt=` override the board range and
 * `?filters=<json>` replaces the saved board filters (unsaved, URL-shared state).
 */
export async function handleRun(c: Ctx) {
  const board = await loadBoard(c);
  if (!board || !(await canAccessTeamResource(c.env, board, c.get('user')))) return notFound();

  let filters: PropertyFilter[] = parseBoardFilters(board.parameters);
  const raw = c.req.query('filters');
  if (raw !== undefined) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return badRequest('filters must be JSON');
    }
    const parsed = propertyFiltersSchema.safeParse(value);
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid filters');
    filters = parsed.data;
  }
  const preset = (board.parameters as { rangePreset?: unknown } | null)?.rangePreset;
  const { startAt, endAt } = boardRunRange(c.req.query(), preset);
  const widgets = await runBoardWidgets(c.env, c.get('user'), board.parameters, { startAt, endAt, filters });
  return json({ period: { startAt, endAt }, filters, widgets });
}

export async function handleShareCreate(c: Ctx) {
  const board = await loadBoard(c);
  if (!board || !(await canAccessTeamResource(c.env, board, c.get('user')))) return notFound();
  if (!(await canMutateTeamResource(c.env, board, c.get('user')))) return json({ message: 'Read-only access' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const parsed = createEntityShareSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest(parsed.error.message);
  const shareId = uuid();
  const slug = crypto.randomUUID().replace(/-/g, '');
  const now = new Date();
  const db = createDb(c.env.DB);
  const expiresAt = parsed.data.expiresInDays ? new Date(now.getTime() + parsed.data.expiresInDays * 86_400_000) : null;
  await db.insert(schema.share).values({
    shareId,
    entityId: board.boardId,
    name: parsed.data.name || board.name,
    shareType: ENTITY_TYPE.board,
    slug,
    parameters: { boardId: board.boardId },
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  await logAdminAction(c.env, c.get('user').userId, 'create', 'share', shareId, {
    boardId: board.boardId,
    teamId: board.teamId ?? null,
    name: parsed.data.name || board.name,
  });
  return json({ id: shareId, slug, entityId: board.boardId, expiresAt }, 201);
}

export async function handleListTemplates() {
  return json(
    BOARD_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      rangePreset: template.rangePreset,
      widgets: template.widgets.map((widget) => ({ key: widget.key, name: widget.name, type: widget.type, size: widget.size })),
    })),
  );
}

/** Creates the template's insights on a website and a board laid out with them. */
export async function handleCreateFromTemplate(c: Ctx) {
  const template = findBoardTemplate(c.req.param('templateId') ?? '');
  if (!template) return notFound();
  const body = await c.req.json().catch(() => null);
  const parsed = createBoardFromTemplateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const user = c.get('user');
  const website = await getWebsiteById(c.env, parsed.data.websiteId);
  if (!website || !(await canMutateWebsite(c.env, website, user))) return notFound();
  // A board for a team website is shared with that team unless the caller picks otherwise.
  const teamId = parsed.data.teamId === undefined ? website.teamId ?? null : parsed.data.teamId;
  if (teamId && !(await canMutateTeam(c.env, teamId, user))) return json({ message: 'Read-only access' }, 403);

  const now = new Date();
  const db = createDb(c.env.DB);
  const widgets: Array<Record<string, unknown>> = [];
  for (const widget of template.widgets) {
    const insightId = uuid();
    const name = parsed.data.names?.[widget.key] ?? widget.name;
    await db.insert(schema.insight).values({
      insightId,
      websiteId: website.websiteId,
      userId: user.userId,
      type: widget.type,
      name,
      description: '',
      query: resolveInsightQuery(widget.type, widget.query),
      createdAt: now,
      updatedAt: now,
    });
    widgets.push({ type: 'insight', insightId, label: name, width: widget.size });
  }

  const boardId = uuid();
  await db.insert(schema.board).values({
    boardId,
    type: 'dashboard',
    name: parsed.data.name ?? template.name,
    description: parsed.data.description ?? template.description,
    parameters: { rangePreset: template.rangePreset, filters: [], widgets, template: template.id },
    userId: user.userId,
    teamId,
    createdAt: now,
    updatedAt: now,
  });
  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, boardId)).limit(1);
  return json(serializeBoard(board!), 201);
}
