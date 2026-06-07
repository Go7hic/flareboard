import type { Context } from 'hono';
import { statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { getRevenueSessions } from '../lib/queries';
import { json } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleSessions(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;

  const data = await getRevenueSessions(c.env, website!.websiteId, startAt, endAt);
  return json(data);
}
