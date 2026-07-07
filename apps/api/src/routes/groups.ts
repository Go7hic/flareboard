import type { Context } from 'hono';
import { statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { getGroupDetail, listGroups, listGroupTypes } from '../lib/groups';
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

export async function handleTypes(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const types = await listGroupTypes(c.env, website!.websiteId);
  return json({ types });
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const groupType = c.req.query('type')?.trim();
  if (!groupType) return badRequest('type query parameter required');
  const { startAt, endAt } = parseRange(c);
  const groups = await listGroups(c.env, website!.websiteId, groupType, startAt, endAt, 100, {
    search: c.req.query('q'),
  });
  return json({ groupType, groups, startAt, endAt });
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const groupType = c.req.param('groupType');
  const groupKey = c.req.param('groupKey');
  if (!groupType || !groupKey) return badRequest('group type and key required');
  const detail = await getGroupDetail(
    c.env,
    website!.websiteId,
    decodeURIComponent(groupType),
    decodeURIComponent(groupKey),
  );
  if (!detail) return notFound();
  return json(detail);
}
