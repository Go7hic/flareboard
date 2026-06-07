import type { Context } from 'hono';
import { statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { getSessionDataProperties, getSessionDataValues } from '../lib/queries';
import { badRequest, json } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function parseRange(c: Ctx) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;
  return { startAt, endAt };
}

export async function handleProperties(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = parseRange(c);
  const properties = await getSessionDataProperties(c.env, website!.websiteId, startAt, endAt);
  return json(properties);
}

export async function handleValues(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const propertyName = c.req.query('propertyName');
  if (!propertyName) return badRequest('propertyName query parameter required');
  const { startAt, endAt } = parseRange(c);
  const values = await getSessionDataValues(
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
  const { startAt, endAt } = parseRange(c);

  const rows = await c.env.DB.prepare(
    `SELECT
      COUNT(DISTINCT session_id) as sessions,
      COUNT(*) as values,
      COUNT(DISTINCT string_value) as uniqueValues
     FROM session_data
     WHERE website_id = ?1 AND data_key = ?2
       AND created_at >= ?3 AND created_at <= ?4`,
  )
    .bind(website!.websiteId, propertyName, startAt, endAt)
    .first<{ sessions: number; values: number; uniqueValues: number }>();

  return json({
    propertyName,
    sessions: rows?.sessions ?? 0,
    values: rows?.values ?? 0,
    uniqueValues: rows?.uniqueValues ?? 0,
  });
}
