import type { Context } from 'hono';
import {
  createWarehouseDataSourceSchema,
  createWarehouseScheduledQuerySchema,
  createWarehouseSavedQuerySchema,
  updateWarehouseDataSourceSchema,
  updateWarehouseScheduledQuerySchema,
  updateWarehouseSavedQuerySchema,
  warehouseQuerySchema,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { checkIpRateLimit } from '../lib/rate-limit';
import {
  createWarehouseDataSource,
  createWarehouseSavedQuery,
  createWarehouseScheduledQuery,
  deleteWarehouseDataSource,
  deleteWarehouseScheduledQuery,
  deleteWarehouseSavedQuery,
  getWarehouseDataSource,
  getWarehouseScheduledQuery,
  getWarehouseSavedQuery,
  getWarehouseSchema,
  listWarehouseDataSources,
  listWarehouseQueryHistory,
  listWarehouseScheduledQueries,
  listWarehouseSavedQueries,
  recordWarehouseQueryHistory,
  runDueWarehouseScheduledQueries,
  runWarehouseQuery,
  updateWarehouseDataSource,
  updateWarehouseScheduledQuery,
  updateWarehouseSavedQuery,
} from '../lib/warehouse';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleSchema(c: Ctx) {
  const { response } = await requireWebsiteOr404(c);
  if (response) return response;
  return json(getWarehouseSchema());
}

export async function handleQuery(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const body = await c.req.json().catch(() => null);
  const parsed = warehouseQuerySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const rateLimit = await checkIpRateLimit(
    c.env,
    `warehouse-query:${website!.websiteId}:${c.get('user').userId}`,
    c.get('user').userId,
    20,
    60,
  );
  if (!rateLimit.allowed) return json({ message: 'Rate limit exceeded' }, 429);

  const startedAt = Date.now();
  try {
    const result = await runWarehouseQuery(c.env, website!.websiteId, parsed.data.sql);
    await recordWarehouseQueryHistory(c.env, website!.websiteId, c.get('user').userId, {
      sql: parsed.data.sql,
      status: 'success',
      rowCount: result.rowCount,
      error: null,
      durationMs: Date.now() - startedAt,
    });
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordWarehouseQueryHistory(c.env, website!.websiteId, c.get('user').userId, {
      sql: parsed.data.sql,
      status: 'failed',
      rowCount: 0,
      error: message,
      durationMs: Date.now() - startedAt,
    });
    return badRequest(message);
  }
}

export async function handleHistoryList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const limit = Number(c.req.query('limit') ?? 100);
  const history = await listWarehouseQueryHistory(c.env, website!.websiteId, Number.isFinite(limit) ? limit : 100);
  return json({ history });
}

export async function handleSavedQueryList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const savedQueries = await listWarehouseSavedQueries(c.env, website!.websiteId);
  return json({ savedQueries });
}

export async function handleScheduleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const schedules = await listWarehouseScheduledQueries(c.env, website!.websiteId);
  return json({ schedules });
}

export async function handleScheduleCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createWarehouseScheduledQuerySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const schedule = await createWarehouseScheduledQuery(c.env, website!.websiteId, c.get('user').userId, parsed.data);
    return json(schedule, 201);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : String(error));
  }
}

export async function handleScheduleRunDue(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const result = await runDueWarehouseScheduledQueries(c.env, website!.websiteId);
  return json(result);
}

export async function handleScheduleUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const scheduledQueryId = c.req.param('scheduledQueryId')?.trim();
  if (!scheduledQueryId || !(await getWarehouseScheduledQuery(c.env, website!.websiteId, scheduledQueryId))) {
    return notFound();
  }
  const body = await c.req.json().catch(() => null);
  const parsed = updateWarehouseScheduledQuerySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const schedule = await updateWarehouseScheduledQuery(c.env, website!.websiteId, scheduledQueryId, parsed.data);
    if (!schedule) return notFound();
    return json(schedule);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : String(error));
  }
}

export async function handleScheduleDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const scheduledQueryId = c.req.param('scheduledQueryId')?.trim();
  if (!scheduledQueryId) return notFound();
  const deleted = await deleteWarehouseScheduledQuery(c.env, website!.websiteId, scheduledQueryId);
  if (!deleted) return notFound();
  return json({ ok: true });
}

export async function handleDataSourceList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const dataSources = await listWarehouseDataSources(c.env, website!.websiteId);
  return json({ dataSources });
}

export async function handleDataSourceCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createWarehouseDataSourceSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const dataSource = await createWarehouseDataSource(c.env, website!.websiteId, c.get('user').userId, parsed.data);
  return json(dataSource, 201);
}

export async function handleDataSourceUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const dataSourceId = c.req.param('dataSourceId')?.trim();
  if (!dataSourceId || !(await getWarehouseDataSource(c.env, website!.websiteId, dataSourceId))) return notFound();
  const body = await c.req.json().catch(() => null);
  const parsed = updateWarehouseDataSourceSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const dataSource = await updateWarehouseDataSource(c.env, website!.websiteId, dataSourceId, parsed.data);
  if (!dataSource) return notFound();
  return json(dataSource);
}

export async function handleDataSourceDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const dataSourceId = c.req.param('dataSourceId')?.trim();
  if (!dataSourceId) return notFound();
  const deleted = await deleteWarehouseDataSource(c.env, website!.websiteId, dataSourceId);
  if (!deleted) return notFound();
  return json({ ok: true });
}

export async function handleSavedQueryCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createWarehouseSavedQuerySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const saved = await createWarehouseSavedQuery(c.env, website!.websiteId, c.get('user').userId, parsed.data);
    return json(saved, 201);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : String(error));
  }
}

export async function handleSavedQueryUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const savedQueryId = c.req.param('savedQueryId')?.trim();
  if (!savedQueryId || !(await getWarehouseSavedQuery(c.env, website!.websiteId, savedQueryId))) return notFound();
  const body = await c.req.json().catch(() => null);
  const parsed = updateWarehouseSavedQuerySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    const saved = await updateWarehouseSavedQuery(c.env, website!.websiteId, savedQueryId, parsed.data);
    if (!saved) return notFound();
    return json(saved);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : String(error));
  }
}

export async function handleSavedQueryDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const savedQueryId = c.req.param('savedQueryId')?.trim();
  if (!savedQueryId) return notFound();
  const deleted = await deleteWarehouseSavedQuery(c.env, website!.websiteId, savedQueryId);
  if (!deleted) return notFound();
  return json({ ok: true });
}
