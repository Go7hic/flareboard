import type { Context } from 'hono';
import { metricsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { cachedRead } from '../lib/cache';
import { resolveDemoWebsite, serializeDemoWebsite } from '../lib/demo';
import { parseStatsRange } from '../lib/parse-range';
import {
  getMetrics,
  getPageMetrics,
  getTrafficHeatmap,
  getWebsiteMetricsSeries,
  getWebsiteStats,
} from '../lib/queries';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { json, notFound } from '../lib/response';

type Ctx = Context<{ Bindings: Env }>;

function chartUnit(startAt: number, endAt: number) {
  const periodMs = endAt - startAt;
  if (periodMs <= 48 * 60 * 60 * 1000) return 'hour';
  if (periodMs <= 90 * 24 * 60 * 60 * 1000) return 'day';
  return 'month';
}

async function requireDemo(c: Ctx) {
  const limited = await checkIpRateLimit(
    c.env,
    'public-demo',
    getTrustedClientIp(c.req.raw),
    120,
    60,
  );
  if (!limited.allowed) return { website: null, response: json({ message: 'Too many requests' }, 429) };
  const website = await resolveDemoWebsite(c.env);
  if (!website) return { website: null, response: notFound() };
  return { website, response: null };
}

export async function handleMeta(c: Ctx) {
  const { website, response } = await requireDemo(c);
  if (response) return response;
  return json({ website: serializeDemoWebsite(website!) });
}

export async function handleOverview(c: Ctx) {
  const { website, response } = await requireDemo(c);
  if (response) return response;

  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const unit = chartUnit(startAt, endAt);
  const websiteId = website!.websiteId;

  const payload = await cachedRead(
    c.env,
    `demo-overview:${websiteId}:${startAt}:${endAt}:${unit}`,
    60,
    async () => {
      const [stats, timeseries] = await Promise.all([
        getWebsiteStats(c.env, websiteId, startAt, endAt),
        getWebsiteMetricsSeries(c.env, websiteId, startAt, endAt, unit),
      ]);
      return {
        website: serializeDemoWebsite(website!),
        stats,
        timeseries,
      };
    },
  );

  return json(payload);
}

export async function handleMetrics(c: Ctx) {
  const { website, response } = await requireDemo(c);
  if (response) return response;

  const query = metricsQuerySchema.safeParse(c.req.query());
  const type = query.success && query.data.type ? query.data.type : c.req.query('type') || 'path';
  const limit = query.success && query.data.limit ? query.data.limit : 10;
  const sortBy = query.success && query.data.sortBy ? query.data.sortBy : undefined;
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const websiteId = website!.websiteId;

  if (type === 'heatmap') {
    const data = await cachedRead(
      c.env,
      `demo-metrics:${websiteId}:${startAt}:${endAt}:heatmap`,
      60,
      () => getTrafficHeatmap(c.env, websiteId, startAt, endAt),
    );
    return json(data);
  }

  const cacheKey = `demo-metrics:${websiteId}:${startAt}:${endAt}:${type}:${limit}:${sortBy ?? ''}`;
  if ((type === 'path' || type === 'url') && sortBy) {
    const data = await cachedRead(c.env, cacheKey, 60, () =>
      getPageMetrics(c.env, websiteId, startAt, endAt, sortBy, limit),
    );
    return json(data);
  }

  const data = await cachedRead(c.env, cacheKey, 60, () =>
    getMetrics(c.env, websiteId, startAt, endAt, type, limit),
  );
  return json(data);
}
