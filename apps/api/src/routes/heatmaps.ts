import type { Context } from 'hono';
import { statsQuerySchema, getPlan } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import { getUserSubscription, isHostedMode } from '../lib/billing';
import { getHeatmapData, getHeatmapPaths } from '../lib/heatmaps';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

async function requireHeatmapsPlan(c: Ctx): Promise<Response | null> {
  if (!isHostedMode(c.env)) return null;
  const sub = await getUserSubscription(c.env, c.get('user').userId);
  if (!getPlan(sub.planId).heatmapsEnabled) {
    return json({ message: 'Heatmaps require a paid plan.' }, 403);
  }
  return null;
}

export async function handleGetPaths(c: Ctx) {
  const planDenied = await requireHeatmapsPlan(c);
  if (planDenied) return planDenied;

  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;

  const paths = await getHeatmapPaths(c.env, websiteId, startAt, endAt);
  return json(paths);
}

export async function handleGet(c: Ctx) {
  const planDenied = await requireHeatmapsPlan(c);
  if (planDenied) return planDenied;

  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;
  const urlPath = c.req.query('urlPath') ?? '/';
  const kind = c.req.query('kind') === 'scroll' ? 'scroll' : 'click';
  const deviceClass = c.req.query('deviceClass') ?? undefined;
  if (deviceClass && !['desktop', 'mobile', 'tablet'].includes(deviceClass)) {
    return badRequest('Invalid deviceClass');
  }

  if (!urlPath || urlPath.length > 500) return badRequest('Invalid urlPath');

  const data = await getHeatmapData(
    c.env,
    websiteId,
    urlPath,
    startAt,
    endAt,
    kind,
    deviceClass,
  );
  return json(data);
}
