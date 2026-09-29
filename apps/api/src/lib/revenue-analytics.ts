import type { Env } from '../env';
import { siteDb } from './site-db';

/**
 * Revenue analytics over one website's store. Two sources, never summed across currencies:
 * - `revenue`: revenue events sent by the tracker / SDK;
 * - Stripe (lib/stripe-connector.ts): succeeded charges (+) and refunds (−) as transactions,
 *   subscription invoice lines for MRR.
 * Everything here reads site tables only, through `siteDb`.
 */

/**
 * One row per transaction in [?2, ?3] for website ?1. `distinct_id` is the person behind the
 * transaction when known (session of a revenue event, or the linked Stripe customer).
 */
export const REVENUE_LEDGER_CTE = `ledger AS (
  SELECT 'event' AS source, r.revenue_id AS id, r.session_id AS session_id, s.distinct_id AS distinct_id,
         r.event_name AS event_name, UPPER(r.currency) AS currency, COALESCE(r.revenue, 0) AS amount,
         r.created_at AS created_at
  FROM revenue r
  LEFT JOIN session s ON s.session_id = r.session_id
  WHERE r.website_id = ?1 AND r.created_at >= ?2 AND r.created_at <= ?3
  UNION ALL
  SELECT 'stripe', 'stripe:' || c.charge_id, NULL, cu.distinct_id, 'stripe_charge', c.currency, c.amount_major, c.created_at
  FROM stripe_charge c
  LEFT JOIN stripe_customer cu ON cu.data_source_id = c.data_source_id AND cu.customer_id = c.customer_id
  WHERE c.website_id = ?1 AND c.paid = 1 AND c.status = 'succeeded' AND c.created_at >= ?2 AND c.created_at <= ?3
  UNION ALL
  SELECT 'stripe', 'stripe:' || f.refund_id, NULL, cu.distinct_id, 'stripe_refund', f.currency, -f.amount_major, f.created_at
  FROM stripe_refund f
  LEFT JOIN stripe_charge c ON c.data_source_id = f.data_source_id AND c.charge_id = f.charge_id
  LEFT JOIN stripe_customer cu ON cu.data_source_id = c.data_source_id AND cu.customer_id = c.customer_id
  WHERE f.website_id = ?1 AND f.status IN ('succeeded', 'pending') AND f.created_at >= ?2 AND f.created_at <= ?3
)`;

export type RevenueTotals = { currency: string; total: number; transactions: number };

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export async function getRevenueReport(env: Env, websiteId: string, startAt: number, endAt: number) {
  const db = siteDb(env, websiteId);
  const [byDay, byEvent, totals] = await Promise.all([
    db
      .prepare(
        `WITH ${REVENUE_LEDGER_CTE}
         SELECT date(created_at / 1000, 'unixepoch') as date, currency, SUM(amount) as total, COUNT(*) as transactions
         FROM ledger GROUP BY date, currency ORDER BY date DESC`,
      )
      .bind(websiteId, startAt, endAt)
      .all<{ date: string; currency: string; total: number; transactions: number }>(),
    db
      .prepare(
        `WITH ${REVENUE_LEDGER_CTE}
         SELECT event_name as eventName, source, currency, SUM(amount) as total, COUNT(*) as transactions
         FROM ledger GROUP BY event_name, source, currency ORDER BY total DESC LIMIT 50`,
      )
      .bind(websiteId, startAt, endAt)
      .all<{ eventName: string; source: 'event' | 'stripe'; currency: string; total: number; transactions: number }>(),
    db
      .prepare(
        `WITH ${REVENUE_LEDGER_CTE}
         SELECT currency, SUM(amount) as total, COUNT(*) as transactions
         FROM ledger GROUP BY currency ORDER BY total DESC`,
      )
      .bind(websiteId, startAt, endAt)
      .all<RevenueTotals>(),
  ]);
  return {
    byDay: byDay.results ?? [],
    byEvent: byEvent.results ?? [],
    totals: totals.results ?? [],
  };
}

// ---------------------------------------------------------------------------------------------
// Attribution

export const ATTRIBUTION_DIMENSIONS = ['utm_source', 'utm_medium', 'utm_campaign', 'referrer_domain'] as const;
export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

export type AttributionRow = {
  value: string | null;
  currency: string;
  total: number;
  transactions: number;
  customers: number;
};

/**
 * First-touch attribution: each transaction is credited to the first pageview of the person's
 * first session (the transaction's own session when the person is unknown), and grouped by
 * that pageview's UTM parameter or referrer domain.
 */
export async function getRevenueAttribution(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  dimension: AttributionDimension,
): Promise<AttributionRow[]> {
  if (!ATTRIBUTION_DIMENSIONS.includes(dimension)) throw new Error(`Unknown attribution dimension: ${dimension}`);
  const rows = await siteDb(env, websiteId)
    .prepare(
      `WITH ${REVENUE_LEDGER_CTE},
       attributed AS (
         SELECT l.*, COALESCE(
           (SELECT fs.session_id FROM session fs
            WHERE l.distinct_id IS NOT NULL AND fs.website_id = ?1 AND fs.distinct_id = l.distinct_id
            ORDER BY fs.created_at ASC LIMIT 1),
           l.session_id) AS touch_session
         FROM ledger l
       ),
       touched AS (
         SELECT a.*, (
           SELECT NULLIF(e.${dimension}, '') FROM website_event e
           WHERE a.touch_session IS NOT NULL AND e.session_id = a.touch_session AND e.event_type = 1
           ORDER BY e.created_at ASC LIMIT 1
         ) AS touch_value
         FROM attributed a
       )
       SELECT touch_value AS value, currency, SUM(amount) AS total, COUNT(*) AS transactions,
              COUNT(DISTINCT COALESCE(distinct_id, touch_session, id)) AS customers
       FROM touched
       GROUP BY touch_value, currency
       ORDER BY total DESC
       LIMIT 100`,
    )
    .bind(websiteId, startAt, endAt)
    .all<AttributionRow>();
  return (rows.results ?? []).map((row) => ({ ...row, total: round2(Number(row.total) || 0) }));
}

// ---------------------------------------------------------------------------------------------
// Subscription metrics (MRR)

/** A recurring invoice line: `mrr` (monthly, decimal units) applies on [start, end). */
export type MrrLine = { customerId: string; currency: string; start: number; end: number; mrr: number };

export type MrrPoint = {
  period: string;
  at: number;
  currency: string;
  mrr: number;
  arr: number;
  subscribers: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  newSubscribers: number;
  churnedSubscribers: number;
  /** Churned subscribers ÷ subscribers at the previous snapshot; null when there were none. */
  churnRate: number | null;
  /** MRR ÷ subscribers; null without subscribers. */
  arpu: number | null;
};

const EPSILON = 1e-9;

/** MRR per customer and currency at instant `at`. */
export function customerMrrAt(lines: MrrLine[], at: number) {
  const byCustomer = new Map<string, { currency: string; mrr: number }>();
  for (const line of lines) {
    if (line.start > at || line.end <= at) continue;
    const key = `${line.currency}\u0000${line.customerId}`;
    const current = byCustomer.get(key);
    if (current) current.mrr += line.mrr;
    else byCustomer.set(key, { currency: line.currency, mrr: line.mrr });
  }
  return byCustomer;
}

/**
 * MRR snapshots and their movement. Each point compares every customer's MRR at `at` with the
 * previous snapshot (`baselineAt` for the first point):
 * new = customers from 0 to > 0, churned = from > 0 to 0, expansion / contraction = change for
 * customers paying at both instants. Per currency, never converted.
 */
export function computeMrrSeries(
  lines: MrrLine[],
  points: Array<{ period: string; at: number }>,
  baselineAt: number,
): MrrPoint[] {
  const currencies = [...new Set(lines.map((line) => line.currency))].sort();
  const out: MrrPoint[] = [];
  let previous = customerMrrAt(lines, baselineAt);
  for (const point of points) {
    const current = customerMrrAt(lines, point.at);
    for (const currency of currencies) {
      let mrr = 0;
      let subscribers = 0;
      let previousSubscribers = 0;
      let newMrr = 0;
      let expansionMrr = 0;
      let contractionMrr = 0;
      let churnedMrr = 0;
      let newSubscribers = 0;
      let churnedSubscribers = 0;
      const keys = new Set<string>();
      for (const [key, value] of current) if (value.currency === currency) keys.add(key);
      for (const [key, value] of previous) if (value.currency === currency) keys.add(key);
      for (const key of keys) {
        const now = current.get(key)?.mrr ?? 0;
        const before = previous.get(key)?.mrr ?? 0;
        const paying = now > EPSILON;
        const paid = before > EPSILON;
        if (paying) {
          mrr += now;
          subscribers++;
        }
        if (paid) previousSubscribers++;
        if (paying && !paid) {
          newMrr += now;
          newSubscribers++;
        } else if (!paying && paid) {
          churnedMrr += before;
          churnedSubscribers++;
        } else if (paying && paid) {
          if (now > before + EPSILON) expansionMrr += now - before;
          else if (now < before - EPSILON) contractionMrr += before - now;
        }
      }
      out.push({
        period: point.period,
        at: point.at,
        currency,
        mrr: round2(mrr),
        arr: round2(mrr * 12),
        subscribers,
        newMrr: round2(newMrr),
        expansionMrr: round2(expansionMrr),
        contractionMrr: round2(contractionMrr),
        churnedMrr: round2(churnedMrr),
        newSubscribers,
        churnedSubscribers,
        churnRate: previousSubscribers ? Math.round((churnedSubscribers / previousSubscribers) * 10_000) / 10_000 : null,
        arpu: subscribers ? round2(mrr / subscribers) : null,
      });
    }
    previous = current;
  }
  return out;
}

/** Month snapshots covering [startAt, endAt]: the last instant of each month, capped at endAt. */
export function monthSnapshots(startAt: number, endAt: number) {
  const points: Array<{ period: string; at: number }> = [];
  const cursor = new Date(startAt);
  let year = cursor.getUTCFullYear();
  let month = cursor.getUTCMonth();
  for (let guard = 0; guard < 240; guard++) {
    const monthStart = Date.UTC(year, month, 1);
    if (monthStart > endAt) break;
    const nextStart = Date.UTC(year, month + 1, 1);
    points.push({
      period: `${year}-${String(month + 1).padStart(2, '0')}`,
      at: Math.min(nextStart - 1, endAt),
    });
    month++;
    if (month === 12) {
      month = 0;
      year++;
    }
  }
  const first = new Date(startAt);
  const baselineAt = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) - 1;
  return { points, baselineAt };
}

/** Cap on invoice lines loaded for one MRR computation. */
const MRR_LINE_LIMIT = 200_000;

/**
 * Recurring Stripe invoice lines overlapping [from, to]. Only open or paid invoices count
 * (drafts may be discarded, void / uncollectible never paid). A line stops counting when its
 * subscription ended (immediate cancellations end mid-period).
 */
export async function loadMrrLines(env: Env, websiteId: string, from: number, to: number): Promise<MrrLine[]> {
  const rows = await siteDb(env, websiteId)
    .prepare(
      `SELECT COALESCE(l.customer_id, l.subscription_id) AS customerId, l.currency AS currency,
              l.period_start AS start, l.period_end AS periodEnd, sub.ended_at AS endedAt, l.mrr_major AS mrr
       FROM stripe_invoice_line l
       JOIN stripe_invoice i ON i.data_source_id = l.data_source_id AND i.invoice_id = l.invoice_id
       LEFT JOIN stripe_subscription sub ON sub.data_source_id = l.data_source_id AND sub.subscription_id = l.subscription_id
       WHERE l.website_id = ?1 AND l.mrr_major > 0 AND l.proration = 0 AND l.subscription_id IS NOT NULL
         AND l.period_start IS NOT NULL AND l.period_end IS NOT NULL
         AND i.status IN ('open', 'paid')
         AND l.period_end > ?2 AND l.period_start <= ?3
       LIMIT ${MRR_LINE_LIMIT}`,
    )
    .bind(websiteId, from, to)
    .all<{ customerId: string; currency: string; start: number; periodEnd: number; endedAt: number | null; mrr: number }>();
  return (rows.results ?? []).map((row) => ({
    customerId: row.customerId,
    currency: row.currency,
    start: row.start,
    end: row.endedAt != null ? Math.min(row.periodEnd, row.endedAt) : row.periodEnd,
    mrr: Number(row.mrr) || 0,
  }));
}

export async function getSubscriptionMetrics(env: Env, websiteId: string, startAt: number, endAt: number) {
  const { points, baselineAt } = monthSnapshots(startAt, endAt);
  const lines = await loadMrrLines(env, websiteId, baselineAt, endAt);
  const series = computeMrrSeries(lines, points, baselineAt);
  const currencies = [...new Set(series.map((point) => point.currency))];
  const latest = currencies.map((currency) => {
    const points = series.filter((point) => point.currency === currency);
    return points[points.length - 1]!;
  });
  return { currencies, latest, series };
}

// ---------------------------------------------------------------------------------------------
// CSV export

/** Most transactions one revenue CSV export contains (newest first). */
export const REVENUE_EXPORT_ROW_CAP = 50_000;
const EXPORT_PAGE = 1_000;

export const REVENUE_TRANSACTION_COLUMNS = [
  'createdAt',
  'source',
  'eventName',
  'currency',
  'amount',
  'sessionId',
  'distinctId',
  'transactionId',
];

type LedgerExportRow = {
  createdAt: number;
  source: string;
  eventName: string;
  currency: string;
  amount: number;
  sessionId: string | null;
  distinctId: string | null;
  id: string;
};

/**
 * Ledger rows in pages of EXPORT_PAGE (keyset on created_at, id), newest first, stopping at
 * `cap` rows. Each page is a separate store read, so memory stays flat.
 */
export async function* revenueTransactionBatches(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  cap = REVENUE_EXPORT_ROW_CAP,
): AsyncGenerator<unknown[][]> {
  const db = siteDb(env, websiteId);
  let emitted = 0;
  let after: { createdAt: number; id: string } | null = null;
  while (emitted < cap) {
    const limit = Math.min(EXPORT_PAGE, cap - emitted);
    const keyset: string = after ? 'WHERE created_at < ?4 OR (created_at = ?4 AND id < ?5)' : '';
    const binds: Array<string | number> = [websiteId, startAt, endAt];
    if (after) binds.push(after.createdAt, after.id);
    const page: D1Result<LedgerExportRow> = await db
      .prepare(
        `WITH ${REVENUE_LEDGER_CTE}
         SELECT created_at AS createdAt, source, event_name AS eventName, currency, amount,
                session_id AS sessionId, distinct_id AS distinctId, id
         FROM ledger ${keyset}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit}`,
      )
      .bind(...binds)
      .all<LedgerExportRow>();
    const rows: LedgerExportRow[] = page.results ?? [];
    if (!rows.length) return;
    emitted += rows.length;
    yield rows.map((row) => [
      new Date(row.createdAt).toISOString(),
      row.source,
      row.eventName,
      row.currency,
      row.amount,
      row.sessionId,
      row.distinctId,
      row.id,
    ]);
    if (rows.length < limit) return;
    const last: LedgerExportRow = rows[rows.length - 1]!;
    after = { createdAt: last.createdAt, id: last.id };
  }
}
