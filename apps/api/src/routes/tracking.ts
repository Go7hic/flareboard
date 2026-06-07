import type { Context } from 'hono';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import { getWebsiteById } from '../lib/queries';
import { json, notFound } from '../lib/response';
import { getTrackingStatus } from '../lib/tracking';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function handleTrackingStatus(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();

  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }

  const status = await getTrackingStatus(c.env, websiteId);
  return json(status);
}
