import type { Context } from 'hono';
import type { Website } from '@flareboard/db';
import type { Env } from '../env';
import { canAccessWebsite } from './access';
import { getWebsiteById } from './queries';
import { notFound } from './response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

export async function requireWebsite(c: Ctx): Promise<Website | null> {
  const websiteId = c.req.param('websiteId') || null;
  if (!websiteId) return null;
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return null;
  }
  return website;
}

export async function requireWebsiteOr404(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return { website: null, response: notFound() };
  return { website, response: null };
}
