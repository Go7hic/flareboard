import type { Context } from 'hono';
import type { Env } from '../env';
import {
  getAccessibleWebsites,
  getAggregateMetricsForWebsites,
  getDashboardMetricsByWebsite,
  getPageviews,
} from '../lib/queries';
import { cachedRead } from '../lib/cache';
import { json } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const CACHE_TTL = 60;
const MAX_MS = MAX_DAYS * 24 * 60 * 60 * 1000;
const MAX_SITES = 100;
const RANKING_LIMIT = 10;
const CARD_LIMIT = 12;

function chartUnit(startAt: number, endAt: number): 'hour' | 'day' {
  return endAt - startAt <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
}

function resolveRange(c: Ctx): { startAt: number; endAt: number; cacheKey: string } {
  const startRaw = c.req.query('startAt');
  const endRaw = c.req.query('endAt');
  const startAt = startRaw ? Number(startRaw) : NaN;
  const endAt = endRaw ? Number(endRaw) : NaN;

  if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt) {
    const span = Math.min(endAt - startAt, MAX_MS);
    const clampedStart = endAt - span;
    return {
      startAt: clampedStart,
      endAt,
      cacheKey: `${clampedStart}:${endAt}`,
    };
  }

  const daysParam = Number(c.req.query('days') ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysParam)
    ? Math.min(MAX_DAYS, Math.max(1, Math.floor(daysParam)))
    : DEFAULT_DAYS;
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  return { startAt: start, endAt: end, cacheKey: `days:${days}` };
}

export async function handleDashboard(c: Ctx) {
  const userId = c.get('user').userId;
  const { startAt, endAt, cacheKey } = resolveRange(c);
  const unit = chartUnit(startAt, endAt);

  return cachedRead(c.env, `dashboard-overview:${userId}:${cacheKey}:${unit}`, CACHE_TTL, async () => {
    const accessible = await getAccessibleWebsites(c.env, userId);
    const siteCount = accessible.length;
    const capped = accessible.slice(0, MAX_SITES);
    const websiteIds = capped.map((w) => w.websiteId);
    const byId = new Map(capped.map((w) => [w.websiteId, w]));

    const [metrics, aggregateMetrics] = await Promise.all([
      getDashboardMetricsByWebsite(c.env, websiteIds, startAt, endAt),
      getAggregateMetricsForWebsites(c.env, websiteIds, startAt, endAt, unit),
    ]);

    const totals = metrics.reduce(
      (acc, row) => ({
        pageviews: acc.pageviews + row.pageviews,
        visitors: acc.visitors + row.visitors,
        visits: acc.visits + row.visits,
      }),
      { pageviews: 0, visitors: 0, visits: 0 },
    );

    const ranking = metrics.slice(0, RANKING_LIMIT).map((row) => {
      const site = byId.get(row.websiteId);
      return {
        id: row.websiteId,
        name: site?.name ?? row.websiteId,
        domain: site?.domain ?? undefined,
        pageviews: row.pageviews,
        visitors: row.visitors,
      };
    });

    const metricsById = new Map(metrics.map((row) => [row.websiteId, row]));
    const cardSites = [...capped]
      .sort((a, b) => {
        const pageviewsA = metricsById.get(a.websiteId)?.pageviews ?? 0;
        const pageviewsB = metricsById.get(b.websiteId)?.pageviews ?? 0;
        return pageviewsB - pageviewsA;
      })
      .slice(0, CARD_LIMIT);
    const websites = await Promise.all(
      cardSites.map(async (site) => {
        const row = metricsById.get(site.websiteId);
        const series = await getPageviews(c.env, site.websiteId, startAt, endAt, unit);
        return {
          id: site.websiteId,
          name: site.name,
          domain: site.domain ?? undefined,
          pageviews: row?.pageviews ?? 0,
          visitors: row?.visitors ?? 0,
          visits: row?.visits ?? 0,
          series: series.pageviews,
        };
      }),
    );

    return {
      websites,
      ranking,
      siteCount,
      cardsLimit: CARD_LIMIT,
      cardsTruncated: siteCount > CARD_LIMIT,
      siteCountCapped: siteCount > MAX_SITES,
      totals,
      aggregateMetrics,
      period: { startAt, endAt, unit },
    };
  }).then((payload) => json(payload));
}
