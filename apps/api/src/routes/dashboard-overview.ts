import type { Context } from 'hono';
import type { Env } from '../env';
import { getAccessibleWebsites, getPageviews, getWebsiteStats } from '../lib/queries';
import { cachedRead } from '../lib/cache';
import { json } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const CACHE_TTL = 60;

export async function handleDashboard(c: Ctx) {
  const userId = c.get('user').userId;
  const daysParam = Number(c.req.query('days') ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysParam)
    ? Math.min(MAX_DAYS, Math.max(1, Math.floor(daysParam)))
    : DEFAULT_DAYS;

  return cachedRead(c.env, `dashboard-overview:${userId}:${days}`, CACHE_TTL, async () => {
    const websites = await getAccessibleWebsites(c.env, userId);
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;

    const totals = { pageviews: 0, visitors: 0, visits: 0 };
    const siteStats = await Promise.all(
      websites.slice(0, 20).map(async (w) => {
        const [stats, series] = await Promise.all([
          getWebsiteStats(c.env, w.websiteId, startAt, endAt),
          getPageviews(c.env, w.websiteId, startAt, endAt, 'day'),
        ]);
        totals.pageviews += stats.pageviews.value;
        totals.visitors += stats.visitors.value;
        totals.visits += stats.visits.value;
        return {
          id: w.websiteId,
          name: w.name,
          domain: w.domain ?? undefined,
          pageviews: stats.pageviews.value,
          visitors: stats.visitors.value,
          visits: stats.visits.value,
          series: series.pageviews,
        };
      }),
    );

    return {
      websites: siteStats,
      totals,
      period: { startAt, endAt, days },
    };
  }).then((payload) => json(payload));
}
