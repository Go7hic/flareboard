import type { Context } from 'hono';
import { compareQuerySchema, metricsQuerySchema, statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import { getMetrics, getPageviews, getSegmentById, getWebsiteById, getWebsiteStats } from '../lib/queries';
import {
  getMetricsFiltered,
  getPageviewsFiltered,
  getWebsiteStatsFiltered,
} from '../lib/segment-stats';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function websiteParam(c: Ctx) {
  return c.req.param('websiteId') || null;
}

async function requireWebsite(c: Ctx) {
  const websiteId = websiteParam(c);
  if (!websiteId) return null;
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return null;
  }
  return website;
}

function parseRange(c: Ctx) {
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 24 * 60 * 60 * 1000;
  const unit = query.success && query.data.unit ? query.data.unit : 'day';
  return { startAt, endAt, unit };
}

async function segmentParams(c: Ctx, websiteId: string) {
  const segmentId = c.req.query('segmentId');
  if (!segmentId) return null;
  const segment = await getSegmentById(c.env, segmentId);
  if (!segment || segment.websiteId !== websiteId) return null;
  return segment.parameters as Record<string, unknown>;
}

export async function handleStats(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const segment = await segmentParams(c, website.websiteId);
  const stats = segment
    ? await getWebsiteStatsFiltered(c.env, website.websiteId, startAt, endAt, segment)
    : await getWebsiteStats(c.env, website.websiteId, startAt, endAt);
  return json(stats);
}

export async function handlePageviews(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt, unit } = parseRange(c);
  const segment = await segmentParams(c, website.websiteId);
  const data = segment
    ? await getPageviewsFiltered(c.env, website.websiteId, startAt, endAt, unit, segment)
    : await getPageviews(c.env, website.websiteId, startAt, endAt, unit);
  return json(data);
}

export async function handleMetrics(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const query = metricsQuerySchema.safeParse(c.req.query());
  const type = query.success && query.data.type ? query.data.type : c.req.query('type') || 'path';
  const limit = query.success && query.data.limit ? query.data.limit : 10;
  const { startAt, endAt } = parseRange(c);
  const segment = await segmentParams(c, website.websiteId);
  const data = segment
    ? await getMetricsFiltered(c.env, website.websiteId, startAt, endAt, type, limit, segment)
    : await getMetrics(c.env, website.websiteId, startAt, endAt, type, limit);
  return json(data);
}

export async function handleOverview(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt, unit } = parseRange(c);
  const query = metricsQuerySchema.safeParse(c.req.query());
  const metricType = query.success && query.data.type ? query.data.type : c.req.query('metricType') || 'path';
  const limit = query.success && query.data.limit ? query.data.limit : 10;
  const segment = await segmentParams(c, website.websiteId);

  if (segment) {
    const [stats, pageviews, metrics] = await Promise.all([
      getWebsiteStatsFiltered(c.env, website.websiteId, startAt, endAt, segment),
      getPageviewsFiltered(c.env, website.websiteId, startAt, endAt, unit, segment),
      getMetricsFiltered(c.env, website.websiteId, startAt, endAt, metricType, limit, segment),
    ]);
    return json({ stats, pageviews, metrics });
  }

  const [stats, pageviews, metrics] = await Promise.all([
    getWebsiteStats(c.env, website.websiteId, startAt, endAt),
    getPageviews(c.env, website.websiteId, startAt, endAt, unit),
    getMetrics(c.env, website.websiteId, startAt, endAt, metricType, limit),
  ]);

  return json({ stats, pageviews, metrics });
}

export async function handleCompare(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const compareQuery = compareQuerySchema.safeParse(c.req.query());
  const periodMs = endAt - startAt;
  const compareEndAt =
    compareQuery.success && compareQuery.data.compareEndAt
      ? compareQuery.data.compareEndAt
      : startAt;
  const compareStartAt =
    compareQuery.success && compareQuery.data.compareStartAt
      ? compareQuery.data.compareStartAt
      : compareEndAt - periodMs;
  const segment = await segmentParams(c, website.websiteId);

  const load = (from: number, to: number) =>
    segment
      ? getWebsiteStatsFiltered(c.env, website.websiteId, from, to, segment)
      : getWebsiteStats(c.env, website.websiteId, from, to);

  const [primary, compare] = await Promise.all([
    load(startAt, endAt),
    load(compareStartAt, compareEndAt),
  ]);

  return json({
    primary: { startAt, endAt, stats: primary },
    compare: { startAt: compareStartAt, endAt: compareEndAt, stats: compare },
  });
}
