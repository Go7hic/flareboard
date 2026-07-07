import type { Context } from 'hono';
import { eventsQuerySchema, statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import { getEventCatalog, getEventCatalogDetail } from '../lib/event-catalog';
import { getCustomEvents, getEventSeries, getEventStats, getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function websiteParam(c: Ctx) {
  return c.req.param('websiteId') || null;
}

function parseRange(c: Ctx) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 24 * 60 * 60 * 1000;
  const unit = query.success && query.data.unit ? query.data.unit : 'day';
  return { startAt, endAt, unit };
}

async function requireWebsite(c: Ctx) {
  const websiteId = websiteParam(c);
  if (!websiteId) return null;
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return null;
  }
  return website;
}

export async function handleEvents(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const data = await getCustomEvents(c.env, website.websiteId, startAt, endAt);
  return json(data);
}

export async function handleCatalog(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const events = await getEventCatalog(c.env, website.websiteId, startAt, endAt, {
    search: c.req.query('q'),
  });
  return json({ events, startAt, endAt });
}

export async function handleCatalogDetail(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const eventName = c.req.param('eventName');
  if (!eventName) return badRequest('event name required');
  const { startAt, endAt } = parseRange(c);
  const detail = await getEventCatalogDetail(
    c.env,
    website.websiteId,
    decodeURIComponent(eventName),
    startAt,
    endAt,
  );
  if (!detail) return notFound();
  return json(detail);
}

export async function handleEventSeries(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const query = eventsQuerySchema.safeParse(c.req.query());
  const eventName = query.success ? query.data.event : c.req.query('event');
  if (!eventName) {
    return badRequest('event query parameter required');
  }
  const { startAt, endAt, unit } = parseRange(c);
  const data = await getEventSeries(c.env, website.websiteId, startAt, endAt, eventName, unit);
  return json(data);
}

export async function handleEventStats(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const stats = await getEventStats(c.env, website.websiteId, startAt, endAt);
  return json(stats);
}
