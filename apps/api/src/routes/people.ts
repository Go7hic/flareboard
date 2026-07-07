import type { Context } from 'hono';
import { patchPersonSchema, statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getPersonDetail, listPeople, patchPerson } from '../lib/people';
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
  const limit = Number(c.req.query('limit') ?? 100);
  const search = c.req.query('q')?.trim();
  const people = await listPeople(c.env, website!.websiteId, startAt, endAt, limit, {
    search: search || undefined,
  });
  return json({ people, startAt, endAt });
}

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const personId = decodeURIComponent(c.req.param('personId') ?? '');
  const detail = await getPersonDetail(c.env, website!.websiteId, personId);
  if (!detail) return notFound();
  return json(detail);
}

export async function handlePatch(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const user = c.get('user');
  if (!(await canMutateWebsite(c.env, website!, user))) {
    return json({ message: 'Forbidden' }, 403);
  }

  const parsed = patchPersonSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid body');

  const personId = decodeURIComponent(c.req.param('personId') ?? '');
  const updated = await patchPerson(c.env, website!.websiteId, personId, parsed.data.properties);
  if (!updated) return notFound();

  const detail = await getPersonDetail(c.env, website!.websiteId, personId);
  if (!detail) return notFound();
  return json(detail);
}
