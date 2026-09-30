import type { Context } from 'hono';
import { DEMO_USER_ID, metricsQuerySchema, ROLES } from '@flareboard/shared';
import type { Env } from '../env';
import { readAuthToken } from '../lib/auth-credentials';
import { startSession, verifySessionToken } from '../lib/auth-token';
import { cachedRead } from '../lib/cache';
import { csrfOriginAllowed } from '../lib/csrf';
import { resolveDemoWebsite, serializeDemoWebsite } from '../lib/demo';
import { DEMO_SESSION_TTL_MS, ensureDemoAccess, isDemoUserId } from '../lib/demo-access';
import { parseStatsRange } from '../lib/parse-range';
import {
  getMetrics,
  getPageMetrics,
  getTrafficHeatmap,
  getWebsiteMetricsSeries,
  getWebsiteStats,
} from '../lib/queries';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { forbidden, getAppSecret, json, notFound } from '../lib/response';
import { setSessionCookie } from '../lib/session-cookie';

type Ctx = Context<{ Bindings: Env }>;

function chartUnit(startAt: number, endAt: number) {
  const periodMs = endAt - startAt;
  if (periodMs <= 48 * 60 * 60 * 1000) return 'hour';
  if (periodMs <= 90 * 24 * 60 * 60 * 1000) return 'day';
  return 'month';
}

/** Demo sign-ins per IP per window: enough to reopen the demo, not to mint sessions in bulk. */
const DEMO_SESSION_LIMIT = 10;
const DEMO_SESSION_WINDOW_SEC = 15 * 60;

/**
 * POST /api/demo/session — signs the browser in as the shared read-only demo account for
 * DEMO_SESSION_TTL_MS. Records the same session row as any sign-in (browser/OS summary only)
 * and no sign-in audit entry. 404 when no demo website exists.
 */
export async function handleSession(c: Ctx) {
  // Sets the session cookie, so a foreign page must not be able to trigger it.
  if (!csrfOriginAllowed(c)) return forbidden('Invalid origin');
  const limited = await checkIpRateLimit(
    c.env,
    'demo-session',
    getTrustedClientIp(c.req.raw),
    DEMO_SESSION_LIMIT,
    DEMO_SESSION_WINDOW_SEC,
  );
  if (!limited.allowed) return json({ message: 'Too many requests' }, 429);

  const access = await ensureDemoAccess(c.env);
  if (!access) return notFound();

  // Already in the demo: keep that session rather than starting another.
  const token = readAuthToken(c);
  const current = token ? await verifySessionToken(c.env, token, getAppSecret(c)) : null;
  if (current && isDemoUserId(current.userId)) return json({ websiteId: access.websiteId });

  const session = await startSession(c, { userId: DEMO_USER_ID, role: ROLES.viewOnly }, 'demo', {
    ttlMs: DEMO_SESSION_TTL_MS,
  });
  setSessionCookie(c, session.token, DEMO_SESSION_TTL_MS / 1000);
  return json({ websiteId: access.websiteId });
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
