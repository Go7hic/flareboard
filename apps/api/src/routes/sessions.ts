import type { Context } from 'hono';
import { statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import {
  exportEventsCsv,
  getSession,
  getSessionActivity,
  getSessionProperties,
  getSessionReplays,
  getSessionStats,
  getSessionWeekly,
  listSessions,
} from '../lib/sessions';
import { getSessionContext } from '../lib/session-context';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function parseRange(c: Ctx) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;
  return { startAt, endAt };
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseRange(c);
  const page = Number(c.req.query('page') || 1);
  const pageSize = Math.min(Number(c.req.query('pageSize') || 20), 100);
  const data = await listSessions(c.env, website!.websiteId, startAt, endAt, page, pageSize);
  return json(data);
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const session = await getSession(c.env, website!.websiteId, c.req.param('sessionId') ?? '');
  if (!session) return notFound();
  return json(session);
}

export async function handleStats(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseRange(c);
  const stats = await getSessionStats(c.env, website!.websiteId, startAt, endAt);
  return json(stats);
}

export async function handleWeekly(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const weeks = Number(c.req.query('weeks') || 12);
  const data = await getSessionWeekly(c.env, website!.websiteId, weeks);
  return json(data);
}

export async function handleActivity(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const activity = await getSessionActivity(
    c.env,
    website!.websiteId,
    c.req.param('sessionId') ?? '',
  );
  return json(activity);
}

export async function handleContext(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const context = await getSessionContext(
    c.env,
    website!.websiteId,
    c.req.param('sessionId') ?? '',
  );
  return json(context);
}

export async function handleProperties(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const props = await getSessionProperties(
    c.env,
    website!.websiteId,
    c.req.param('sessionId') ?? '',
  );
  return json(props);
}

export async function handleSessionReplays(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const replays = await getSessionReplays(
    c.env,
    website!.websiteId,
    c.req.param('sessionId') ?? '',
  );
  return json(replays);
}

export async function handleExport(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseRange(c);
  const type = c.req.query('type') === 'pageviews' ? 'pageviews' : 'events';
  const csv = await exportEventsCsv(c.env, website!.websiteId, startAt, endAt, type);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${website!.websiteId}-${type}.csv"`,
    },
  });
}
