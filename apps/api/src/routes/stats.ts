import type { Context } from 'hono';
import { compareQuerySchema, metricsQuerySchema, statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite } from '../lib/access';
import {
  getMetrics,
  getPageviews,
  getPageMetrics,
  getSegmentById,
  getTrafficHeatmap,
  getWebsiteById,
  getWebsiteMetricsSeries,
  getWebsiteStats,
} from '../lib/queries';
import {
  getMetricsFiltered,
  getPageMetricsFiltered,
  getPageviewsFiltered,
  getTrafficHeatmapFiltered,
  getWebsiteMetricsSeriesFiltered,
  getWebsiteStatsFiltered,
} from '../lib/segment-stats';
import { resolveCohortMemberJoin } from '../lib/cohorts';
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

async function cohortJoin(c: Ctx, websiteId: string) {
  const cohortId = c.req.query('cohort') || c.req.query('cohortId');
  if (!cohortId) return null;
  return resolveCohortMemberJoin(c.env, websiteId, cohortId);
}

function useFilteredQueries(segment: Record<string, unknown> | null, cohort: Awaited<ReturnType<typeof cohortJoin>>) {
  return Boolean(segment || cohort);
}

export async function handleStats(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt } = parseRange(c);
  const segment = await segmentParams(c, website.websiteId);
  const cohort = await cohortJoin(c, website.websiteId);
  const stats = useFilteredQueries(segment, cohort)
    ? await getWebsiteStatsFiltered(c.env, website.websiteId, startAt, endAt, segment, cohort)
    : await getWebsiteStats(c.env, website.websiteId, startAt, endAt);
  return json(stats);
}

export async function handlePageviews(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const { startAt, endAt, unit } = parseRange(c);
  const segment = await segmentParams(c, website.websiteId);
  const cohort = await cohortJoin(c, website.websiteId);
  const data = useFilteredQueries(segment, cohort)
    ? await getPageviewsFiltered(c.env, website.websiteId, startAt, endAt, unit, segment, cohort)
    : await getPageviews(c.env, website.websiteId, startAt, endAt, unit);
  return json(data);
}

export async function handleMetrics(c: Ctx) {
  const website = await requireWebsite(c);
  if (!website) return notFound();
  const query = metricsQuerySchema.safeParse(c.req.query());
  const type = query.success && query.data.type ? query.data.type : c.req.query('type') || 'path';
  const limit = query.success && query.data.limit ? query.data.limit : 10;
  const sortBy = query.success && query.data.sortBy ? query.data.sortBy : undefined;
  const { startAt, endAt } = parseRange(c);
  const segment = await segmentParams(c, website.websiteId);
  const cohort = await cohortJoin(c, website.websiteId);
  const filtered = useFilteredQueries(segment, cohort);

  if (type === 'heatmap') {
    const data = filtered
      ? await getTrafficHeatmapFiltered(c.env, website.websiteId, startAt, endAt, segment)
      : await getTrafficHeatmap(c.env, website.websiteId, startAt, endAt);
    return json(data);
  }

  if ((type === 'path' || type === 'url') && sortBy) {
    const data = filtered
      ? await getPageMetricsFiltered(
          c.env,
          website.websiteId,
          startAt,
          endAt,
          sortBy,
          limit,
          segment,
          cohort,
        )
      : await getPageMetrics(c.env, website.websiteId, startAt, endAt, sortBy, limit);
    return json(data);
  }

  const data = filtered
    ? await getMetricsFiltered(c.env, website.websiteId, startAt, endAt, type, limit, segment, cohort)
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
  const sortBy = query.success && query.data.sortBy ? query.data.sortBy : undefined;
  const segment = await segmentParams(c, website.websiteId);
  const cohort = await cohortJoin(c, website.websiteId);
  const filtered = useFilteredQueries(segment, cohort);

  if (filtered) {
    const metricsPromise =
      (metricType === 'path' || metricType === 'url') && sortBy
        ? getPageMetricsFiltered(
            c.env,
            website.websiteId,
            startAt,
            endAt,
            sortBy,
            limit,
            segment,
            cohort,
          )
        : getMetricsFiltered(
            c.env,
            website.websiteId,
            startAt,
            endAt,
            metricType,
            limit,
            segment,
            cohort,
          );
    const [stats, pageviews, metrics] = await Promise.all([
      getWebsiteStatsFiltered(c.env, website.websiteId, startAt, endAt, segment, cohort),
      getPageviewsFiltered(c.env, website.websiteId, startAt, endAt, unit, segment, cohort),
      metricsPromise,
    ]);
    return json({ stats, pageviews, metrics });
  }

  const metricsPromise =
    (metricType === 'path' || metricType === 'url') && sortBy
      ? getPageMetrics(c.env, website.websiteId, startAt, endAt, sortBy, limit)
      : getMetrics(c.env, website.websiteId, startAt, endAt, metricType, limit);

  const [stats, pageviews, metrics] = await Promise.all([
    getWebsiteStats(c.env, website.websiteId, startAt, endAt),
    getPageviews(c.env, website.websiteId, startAt, endAt, unit),
    metricsPromise,
  ]);

  return json({ stats, pageviews, metrics });
}

function compareChartUnit(startAt: number, endAt: number) {
  const periodMs = endAt - startAt;
  if (periodMs <= 48 * 60 * 60 * 1000) return 'hour';
  if (periodMs <= 90 * 24 * 60 * 60 * 1000) return 'day';
  return 'month';
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
  const unit = compareChartUnit(startAt, endAt);

  const load = (from: number, to: number) =>
    segment
      ? getWebsiteStatsFiltered(c.env, website.websiteId, from, to, segment)
      : getWebsiteStats(c.env, website.websiteId, from, to);

  const loadSeries = (from: number, to: number) =>
    segment
      ? getWebsiteMetricsSeriesFiltered(c.env, website.websiteId, from, to, unit, segment)
      : getWebsiteMetricsSeries(c.env, website.websiteId, from, to, unit);

  const [primary, compare, primarySeries, compareSeries] = await Promise.all([
    load(startAt, endAt),
    load(compareStartAt, compareEndAt),
    loadSeries(startAt, endAt),
    loadSeries(compareStartAt, compareEndAt),
  ]);

  return json({
    primary: { startAt, endAt, stats: primary },
    compare: { startAt: compareStartAt, endAt: compareEndAt, stats: compare },
    unit,
    series: {
      primary: primarySeries,
      compare: compareSeries,
    },
  });
}
