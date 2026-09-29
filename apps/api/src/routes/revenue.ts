import type { Context } from 'hono';
import { getPlan, statsQuerySchema } from '@flareboard/shared';
import type { Env } from '../env';
import { getWebsitePlanId, isHostedMode } from '../lib/billing';
import { csvDownload, inBatches } from '../lib/csv-stream';
import { parseStatsRange } from '../lib/parse-range';
import { getRevenueSessions } from '../lib/queries';
import {
  ATTRIBUTION_DIMENSIONS,
  getRevenueAttribution,
  getSubscriptionMetrics,
  REVENUE_EXPORT_ROW_CAP,
  REVENUE_TRANSACTION_COLUMNS,
  revenueTransactionBatches,
  type AttributionDimension,
} from '../lib/revenue-analytics';
import { badRequest, json } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export async function handleSessions(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;

  const data = await getRevenueSessions(c.env, website!.websiteId, startAt, endAt);
  return json(data);
}

function parseDimension(c: Ctx): AttributionDimension | null {
  const value = c.req.query('dimension') ?? 'utm_source';
  return (ATTRIBUTION_DIMENSIONS as readonly string[]).includes(value) ? (value as AttributionDimension) : null;
}

/** MRR needs whole months: the range is widened to at least 12 months back from its end. */
function subscriptionRange(c: Ctx) {
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '90d' });
  return { startAt: Math.min(startAt, endAt - YEAR_MS), endAt };
}

export async function handleSubscriptions(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const { startAt, endAt } = subscriptionRange(c);
  return json(await getSubscriptionMetrics(c.env, website!.websiteId, startAt, endAt));
}

export async function handleAttribution(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const dimension = parseDimension(c);
  if (!dimension) return badRequest(`dimension must be one of ${ATTRIBUTION_DIMENSIONS.join(', ')}`);
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  const rows = await getRevenueAttribution(c.env, website!.websiteId, startAt, endAt, dimension);
  return json({ dimension, rows });
}

const EXPORT_TABLES = ['transactions', 'attribution', 'mrr'] as const;

/**
 * GET /revenue/export?table=transactions|attribution|mrr — CSV download. Transactions stream
 * newest first, capped at REVENUE_EXPORT_ROW_CAP rows (X-Row-Cap header).
 */
export async function handleExport(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (isHostedMode(c.env)) {
    const planId = await getWebsitePlanId(c.env, website!, c.get('user').userId);
    if (!getPlan(planId).dataPortabilityEnabled) {
      return json({ message: 'CSV export requires a paid plan.' }, 403);
    }
  }
  const table = c.req.query('table') ?? 'transactions';
  if (!(EXPORT_TABLES as readonly string[]).includes(table)) {
    return badRequest(`table must be one of ${EXPORT_TABLES.join(', ')}`);
  }
  const websiteId = website!.websiteId;
  const capHeader = { 'X-Row-Cap': String(REVENUE_EXPORT_ROW_CAP) };

  if (table === 'attribution') {
    const dimension = parseDimension(c);
    if (!dimension) return badRequest(`dimension must be one of ${ATTRIBUTION_DIMENSIONS.join(', ')}`);
    const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
    const rows = await getRevenueAttribution(c.env, websiteId, startAt, endAt, dimension);
    return csvDownload(
      `${websiteId}-revenue-attribution-${dimension}.csv`,
      [dimension, 'currency', 'total', 'transactions', 'customers'],
      inBatches(rows.map((row) => [row.value, row.currency, row.total, row.transactions, row.customers])),
    );
  }
  if (table === 'mrr') {
    const { startAt, endAt } = subscriptionRange(c);
    const { series } = await getSubscriptionMetrics(c.env, websiteId, startAt, endAt);
    return csvDownload(
      `${websiteId}-revenue-mrr.csv`,
      [
        'month',
        'currency',
        'mrr',
        'arr',
        'subscribers',
        'newMrr',
        'expansionMrr',
        'contractionMrr',
        'churnedMrr',
        'newSubscribers',
        'churnedSubscribers',
        'churnRate',
        'arpu',
      ],
      inBatches(
        series.map((point) => [
          point.period,
          point.currency,
          point.mrr,
          point.arr,
          point.subscribers,
          point.newMrr,
          point.expansionMrr,
          point.contractionMrr,
          point.churnedMrr,
          point.newSubscribers,
          point.churnedSubscribers,
          point.churnRate,
          point.arpu,
        ]),
      ),
    );
  }
  const { startAt, endAt } = parseStatsRange(c, { defaultSpan: '30d' });
  return csvDownload(
    `${websiteId}-revenue-transactions.csv`,
    REVENUE_TRANSACTION_COLUMNS,
    revenueTransactionBatches(c.env, websiteId, startAt, endAt),
    capHeader,
  );
}
