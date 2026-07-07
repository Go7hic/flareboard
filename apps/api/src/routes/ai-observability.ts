import type { Context } from 'hono';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import { parseStatsRange } from '../lib/parse-range';
import { getAiEvents, getAiStats } from '../lib/ai-observability';
import { getWebsiteById } from '../lib/queries';
import { json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

async function requireWebsite(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return null;
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) return null;
  return website;
}

function normalizeOptionalParam(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

export async function handleList(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseStatsRange(c);
  const filters = {
    model: normalizeOptionalParam(c.req.query('model')),
    status: normalizeOptionalParam(c.req.query('status')),
    provider: normalizeOptionalParam(c.req.query('provider')),
    quality: normalizeOptionalParam(c.req.query('quality')),
    release: normalizeOptionalParam(c.req.query('release')),
    environment: normalizeOptionalParam(c.req.query('environment')),
  };
  const [stats, events] = await Promise.all([
    getAiStats(c.env, website.websiteId, startAt, endAt, filters),
    getAiEvents(c.env, website.websiteId, startAt, endAt, filters),
  ]);
  return json({ stats, events });
}
