import type { Context } from 'hono';
import type { Env } from '../env';
import { parseStatsRange } from '../lib/parse-range';
import {
  getEventDataProperties,
  getEventDataStats,
  getEventDataValues,
} from '../lib/queries';
import { badRequest, json } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleProperties(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const properties = await getEventDataProperties(c.env, website!.websiteId, startAt, endAt);
  return json(properties);
}

export async function handleValues(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const propertyName = c.req.query('propertyName');
  if (!propertyName) return badRequest('propertyName query parameter required');
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const values = await getEventDataValues(
    c.env,
    website!.websiteId,
    propertyName,
    startAt,
    endAt,
    c.req.query('search'),
  );
  return json(values);
}

export async function handleStats(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const propertyName = c.req.query('propertyName');
  if (!propertyName) return badRequest('propertyName query parameter required');
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const stats = await getEventDataStats(c.env, website!.websiteId, propertyName, startAt, endAt);
  return json(stats);
}

export async function handleFields(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });

  const rows = await c.env.DB.prepare(
    `SELECT data_key as field, COUNT(*) as count
     FROM event_data
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
     GROUP BY data_key
     ORDER BY count DESC
     LIMIT 100`,
  )
    .bind(website!.websiteId, startAt, endAt)
    .all<{ field: string; count: number }>();

  return json(rows.results ?? []);
}
