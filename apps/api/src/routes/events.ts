import type { Context } from 'hono';
import { eventsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { parseStatsRange } from '../lib/parse-range';
import { requireWebsite } from '../lib/website';
import { getEventCatalog, getEventCatalogDetail } from '../lib/event-catalog';
import { getCustomEvents, getEventSeries, getEventStats } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleEvents(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const data = await getCustomEvents(c.env, website.websiteId, startAt, endAt);
  return json(data);
}

export async function handleCatalog(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
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
  const { startAt, endAt } = parseStatsRange(c);
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
  const { startAt, endAt, unit } = parseStatsRange(c, { withUnit: true });
  const data = await getEventSeries(c.env, website.websiteId, startAt, endAt, eventName, unit);
  return json(data);
}

export async function handleEventStats(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const stats = await getEventStats(c.env, website.websiteId, startAt, endAt);
  return json(stats);
}
