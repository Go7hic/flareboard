import type { Env } from '../env';
import { siteDb } from './site-db';
import { loadWarehouseCredential } from './warehouse-credentials';

/**
 * Stripe warehouse connector: pulls customers, subscriptions, invoices (with line items),
 * charges and refunds with a customer's restricted API key into the website's stripe_* tables.
 *
 * Sync is incremental and resumable, driven by the hourly cron and the "Sync now" button:
 * 1. backfill: page through each list endpoint (newest first, `starting_after`), saving the
 *    cursor after every page so a run that hits its request budget resumes where it stopped;
 * 2. events: afterwards, apply `/v1/events` newer than the cursor captured when the backfill
 *    began (`ending_before` walks forward in time), so updates to existing objects (refunds,
 *    cancellations, paid invoices) arrive too. Stripe keeps events for 30 days: a cursor older
 *    than that restarts the backfill.
 *
 * Every write is an upsert keyed by (data_source_id, object id), so replays are harmless.
 * HTTP goes through an injectable `fetch` (tests use a fake Stripe) and backs off on 429/5xx.
 */

export const STRIPE_API_BASE = 'https://api.stripe.com';
/** Pinned so list payloads have a known shape. Event payloads keep their own version; parsers accept both. */
export const STRIPE_API_VERSION = '2024-06-20';
const PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 8_000;
const DEFAULT_MAX_REQUESTS = 40;
const WRITE_BATCH = 50;

export type StripeSyncOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: number;
  /** Upper bound on Stripe HTTP requests in this run (Worker subrequest limits). */
  maxRequests?: number;
  pageSize?: number;
};

export type StripeSyncState = {
  version: 1;
  phase: 'backfill' | 'events';
  /** Index into BACKFILL_RESOURCES and the `starting_after` cursor inside it. */
  resource: number;
  startingAfter: string | null;
  /** Newest event when the backfill began; events after it are applied in the events phase. */
  eventCursor: string | null;
  /** Unix seconds; used instead of eventCursor when the account had no events yet. */
  eventsSince: number | null;
  backfillStartedAt: number | null;
  backfillCompletedAt: number | null;
};

export type StripeSyncResult = {
  complete: boolean;
  requests: number;
  imported: Record<StripeObjectKind, number>;
  phase: StripeSyncState['phase'];
};

type StripeObjectKind = 'customer' | 'subscription' | 'invoice' | 'charge' | 'refund';
type StripeObject = Record<string, unknown> & { id: string; object?: string };
type StripeList = { object: 'list'; data: StripeObject[]; has_more: boolean };

const BACKFILL_RESOURCES: ReadonlyArray<{ kind: StripeObjectKind; path: string; params: Array<[string, string]> }> = [
  { kind: 'customer', path: '/v1/customers', params: [] },
  { kind: 'subscription', path: '/v1/subscriptions', params: [['status', 'all']] },
  { kind: 'invoice', path: '/v1/invoices', params: [] },
  { kind: 'charge', path: '/v1/charges', params: [] },
  { kind: 'refund', path: '/v1/refunds', params: [] },
];

/** At most 20 types per request (Stripe limit). */
export const STRIPE_EVENT_TYPES = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.finalized',
  'invoice.paid',
  'invoice.updated',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'charge.succeeded',
  'charge.captured',
  'charge.updated',
  'charge.refunded',
  'charge.refund.updated',
  'refund.created',
  'refund.updated',
] as const;

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

/** The run used its request budget; state is saved and the next run continues. */
class StripeBudgetExhausted extends Error {}

export function initialStripeSyncState(): StripeSyncState {
  return {
    version: 1,
    phase: 'backfill',
    resource: 0,
    startingAfter: null,
    eventCursor: null,
    eventsSince: null,
    backfillStartedAt: null,
    backfillCompletedAt: null,
  };
}

export function isStripeApiKey(value: unknown): value is string {
  return typeof value === 'string' && /^rk_(?:live|test)_[A-Za-z0-9]{8,}$/.test(value.trim());
}

// ---------------------------------------------------------------------------------------------
// HTTP

class StripeClient {
  requests = 0;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly maxRequests: number,
  ) {}

  get remaining() {
    return this.maxRequests - this.requests;
  }

  async get<T>(path: string, params: Array<[string, string]> = []): Promise<T> {
    const query = new URLSearchParams(params).toString();
    const url = `${STRIPE_API_BASE}${path}${query ? `?${query}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      if (this.requests >= this.maxRequests) throw new StripeBudgetExhausted();
      this.requests++;
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Stripe-Version': STRIPE_API_VERSION },
        signal: AbortSignal.timeout(20_000),
      });
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        await response.body?.cancel().catch(() => undefined);
        await this.sleep(backoffMs(response.headers.get('retry-after'), attempt));
        continue;
      }
      const body = (await response.json().catch(() => null)) as
        | (T & { error?: { message?: string; code?: string } })
        | null;
      if (!response.ok) {
        const message =
          response.status === 429
            ? 'Stripe rate limit reached; the sync resumes on the next run'
            : body?.error?.message ?? `Stripe HTTP ${response.status}`;
        throw new StripeApiError(message, response.status, body?.error?.code ?? null);
      }
      if (!body) throw new StripeApiError('Stripe returned an unreadable response', response.status, null);
      return body;
    }
  }
}

export function backoffMs(retryAfter: string | null, attempt: number) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  return Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
}

// ---------------------------------------------------------------------------------------------
// Parsing (accepts both the pinned list shape and newer event payload shapes)

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Stripe amounts are integers in the currency's minor unit. */
export function toMajorUnits(amount: number, currency: string) {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return amount;
  if (THREE_DECIMAL.has(code)) return amount / 1000;
  return amount / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Factor turning one billing period's amount into a monthly amount. Uses the price's recurring
 * interval when present, otherwise the period length (newer invoice line shapes omit the price).
 */
export function monthlyFactor(
  interval: string | null,
  intervalCount: number | null,
  periodStart: number | null,
  periodEnd: number | null,
) {
  const count = intervalCount && intervalCount > 0 ? intervalCount : 1;
  switch (interval) {
    case 'month':
      return 1 / count;
    case 'year':
      return 1 / (12 * count);
    case 'week':
      return 52 / 12 / count;
    case 'day':
      return 365 / 12 / count;
  }
  if (periodStart == null || periodEnd == null || periodEnd <= periodStart) return 0;
  const days = (periodEnd - periodStart) / DAY_MS;
  if (days >= 27 && days <= 32) return 1;
  if (days >= 58 && days <= 63) return 1 / 2;
  if (days >= 88 && days <= 93) return 1 / 3;
  if (days >= 180 && days <= 186) return 1 / 6;
  if (days >= 364 && days <= 367) return 1 / 12;
  if (days >= 6 && days <= 8) return 52 / 12;
  return 30.4375 / days;
}

/** Fields dropped before a payload is stored: payment instruments, addresses, hosted links. */
const DROPPED_FIELDS = new Set([
  'address',
  'shipping',
  'phone',
  'billing_details',
  'payment_method_details',
  'source',
  'sources',
  'fraud_details',
  'receipt_url',
  'receipt_email',
  'customer_address',
  'customer_shipping',
  'customer_phone',
  'customer_tax_ids',
  'tax_ids',
  'hosted_invoice_url',
  'invoice_pdf',
  'destination_details',
  'lines',
]);

export function sanitizePayload(object: StripeObject) {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (!DROPPED_FIELDS.has(key)) copy[key] = value;
  }
  return JSON.stringify(copy);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ms(seconds: unknown): number | null {
  const value = num(seconds);
  return value == null ? null : value * 1000;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** An expandable field: either the id string or the expanded object. */
function refId(value: unknown): string | null {
  return str(value) ?? str(record(value)?.id);
}

function path(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) current = record(current)?.[key];
  return current;
}

function currencyOf(object: Record<string, unknown>) {
  return (str(object.currency) ?? 'usd').toUpperCase();
}

const DISTINCT_ID_METADATA_KEYS = ['distinct_id', 'distinctId', 'flareboard_distinct_id', 'posthog_distinct_id'];

export function metadataDistinctId(metadata: unknown) {
  const meta = record(metadata);
  if (!meta) return null;
  for (const key of DISTINCT_ID_METADATA_KEYS) {
    const value = str(meta[key])?.trim();
    if (value) return value.slice(0, 200);
  }
  return null;
}

export type ParsedInvoiceLine = {
  lineId: string;
  subscriptionId: string | null;
  priceId: string | null;
  interval: string | null;
  intervalCount: number | null;
  quantity: number | null;
  proration: boolean;
  amount: number;
  amountMajor: number;
  mrrMajor: number;
  periodStart: number | null;
  periodEnd: number | null;
};

export function parseInvoiceLine(line: Record<string, unknown>, currency: string, invoiceSubscription: string | null): ParsedInvoiceLine {
  const price = record(line.price) ?? record(path(line, 'pricing', 'price_details', 'price'));
  const priceId = refId(line.price) ?? refId(path(line, 'pricing', 'price_details', 'price'));
  const recurring = record(price?.recurring);
  const parentSub = record(path(line, 'parent', 'subscription_item_details'));
  const subscriptionId =
    refId(line.subscription) ?? refId(parentSub?.subscription) ?? (line.type === 'subscription' ? invoiceSubscription : null);
  const proration = line.proration === true || parentSub?.proration === true;
  const discounts = Array.isArray(line.discount_amounts) ? line.discount_amounts : [];
  const discount = discounts.reduce<number>((sum, item) => sum + (num(record(item)?.amount) ?? 0), 0);
  const amount = (num(line.amount) ?? 0) - discount;
  const periodStart = ms(path(line, 'period', 'start'));
  const periodEnd = ms(path(line, 'period', 'end'));
  const interval = str(recurring?.interval);
  const intervalCount = num(recurring?.interval_count);
  const amountMajor = toMajorUnits(amount, currency);
  const recurringLine = Boolean(subscriptionId) && !proration;
  const mrrMajor = recurringLine ? Math.max(0, amountMajor * monthlyFactor(interval, intervalCount, periodStart, periodEnd)) : 0;
  return {
    lineId: str(line.id) ?? '',
    subscriptionId,
    priceId,
    interval,
    intervalCount,
    quantity: num(line.quantity),
    proration,
    amount,
    amountMajor,
    mrrMajor,
    periodStart,
    periodEnd,
  };
}

/** Current MRR of a subscription from its items (list price, before discounts). */
export function subscriptionMrr(subscription: Record<string, unknown>) {
  const items = path(subscription, 'items', 'data');
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const raw of items) {
    const item = record(raw);
    const price = record(item?.price) ?? record(item?.plan);
    if (!price) continue;
    const recurring = record(price.recurring);
    const interval = str(recurring?.interval) ?? str(price.interval);
    const count = num(recurring?.interval_count) ?? num(price.interval_count);
    const unit = num(price.unit_amount) ?? num(price.amount) ?? 0;
    const quantity = num(item?.quantity) ?? 1;
    total += toMajorUnits(unit * quantity, currencyOf(price)) * monthlyFactor(interval, count, null, null);
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Writes

type Ctx = {
  env: Env;
  websiteId: string;
  dataSourceId: string;
  client: StripeClient;
  now: number;
  imported: Record<StripeObjectKind, number>;
};

function kindOf(object: StripeObject): StripeObjectKind | null {
  switch (object.object) {
    case 'customer':
      return 'customer';
    case 'subscription':
      return 'subscription';
    case 'invoice':
      return 'invoice';
    case 'charge':
      return 'charge';
    case 'refund':
      return 'refund';
    default:
      return null;
  }
}

async function writeStatements(ctx: Ctx, statements: D1PreparedStatement[]) {
  const db = siteDb(ctx.env, ctx.websiteId);
  for (let offset = 0; offset < statements.length; offset += WRITE_BATCH) {
    await db.batch(statements.slice(offset, offset + WRITE_BATCH));
  }
}

/** Remaining invoice lines when the embedded list was truncated (10 lines inline). */
async function invoiceLines(ctx: Ctx, invoice: StripeObject) {
  const embedded = record(invoice.lines);
  const lines = Array.isArray(embedded?.data) ? [...(embedded!.data as StripeObject[])] : [];
  let hasMore = embedded?.has_more === true;
  while (hasMore && lines.length) {
    const page = await ctx.client.get<StripeList>(`/v1/invoices/${encodeURIComponent(invoice.id)}/lines`, [
      ['limit', String(PAGE_SIZE)],
      ['starting_after', lines[lines.length - 1]!.id],
    ]);
    lines.push(...page.data);
    hasMore = page.has_more && page.data.length > 0;
  }
  return lines;
}

async function upsertObjects(ctx: Ctx, objects: StripeObject[]) {
  const db = siteDb(ctx.env, ctx.websiteId);
  const { websiteId, dataSourceId, now } = ctx;
  const statements: D1PreparedStatement[] = [];
  for (const object of objects) {
    const kind = kindOf(object);
    if (!kind || !object.id) continue;
    ctx.imported[kind]++;
    if (kind === 'customer') {
      if (object.deleted === true) {
        statements.push(
          db.prepare(
            `INSERT INTO stripe_customer (website_id, data_source_id, customer_id, deleted, payload_json, synced_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)
             ON CONFLICT(data_source_id, customer_id) DO UPDATE SET deleted = 1, synced_at = excluded.synced_at`,
          ).bind(websiteId, dataSourceId, object.id, sanitizePayload(object), now),
        );
        continue;
      }
      const email = str(object.email)?.trim().toLowerCase() ?? null;
      statements.push(
        db.prepare(
          `INSERT INTO stripe_customer
             (website_id, data_source_id, customer_id, email, name, distinct_id, deleted, metadata_json, payload_json, created_at, synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10)
           ON CONFLICT(data_source_id, customer_id) DO UPDATE SET
             email = excluded.email, name = excluded.name,
             distinct_id = COALESCE(excluded.distinct_id, CASE WHEN stripe_customer.email IS excluded.email THEN stripe_customer.distinct_id END),
             deleted = 0, metadata_json = excluded.metadata_json, payload_json = excluded.payload_json,
             created_at = excluded.created_at, synced_at = excluded.synced_at`,
        ).bind(
          websiteId,
          dataSourceId,
          object.id,
          email,
          str(object.name),
          metadataDistinctId(object.metadata),
          JSON.stringify(record(object.metadata) ?? {}),
          sanitizePayload(object),
          ms(object.created),
          now,
        ),
      );
    } else if (kind === 'charge') {
      const currency = currencyOf(object);
      const amount = num(object.amount) ?? 0;
      const captured = object.captured === false ? 0 : num(object.amount_captured) ?? amount;
      statements.push(
        db.prepare(
          `INSERT OR REPLACE INTO stripe_charge
             (website_id, data_source_id, charge_id, customer_id, invoice_id, status, paid, amount, amount_refunded,
              currency, amount_major, payload_json, created_at, synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        ).bind(
          websiteId,
          dataSourceId,
          object.id,
          refId(object.customer),
          refId(object.invoice),
          str(object.status),
          object.paid === true ? 1 : 0,
          amount,
          num(object.amount_refunded) ?? 0,
          currency,
          toMajorUnits(captured, currency),
          sanitizePayload(object),
          ms(object.created) ?? now,
          now,
        ),
      );
    } else if (kind === 'refund') {
      const currency = currencyOf(object);
      const amount = num(object.amount) ?? 0;
      statements.push(
        db.prepare(
          `INSERT OR REPLACE INTO stripe_refund
             (website_id, data_source_id, refund_id, charge_id, status, amount, currency, amount_major, payload_json, created_at, synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        ).bind(
          websiteId,
          dataSourceId,
          object.id,
          refId(object.charge),
          str(object.status),
          amount,
          currency,
          toMajorUnits(amount, currency),
          sanitizePayload(object),
          ms(object.created) ?? now,
          now,
        ),
      );
    } else if (kind === 'subscription') {
      const firstItem = record((path(object, 'items', 'data') as unknown[] | undefined)?.[0]);
      statements.push(
        db.prepare(
          `INSERT OR REPLACE INTO stripe_subscription
             (website_id, data_source_id, subscription_id, customer_id, status, currency, mrr_major, start_date, canceled_at,
              ended_at, cancel_at_period_end, current_period_start, current_period_end, trial_end, payload_json, created_at, synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
        ).bind(
          websiteId,
          dataSourceId,
          object.id,
          refId(object.customer),
          str(object.status),
          currencyOf(object),
          subscriptionMrr(object),
          ms(object.start_date),
          ms(object.canceled_at),
          ms(object.ended_at),
          object.cancel_at_period_end === true ? 1 : 0,
          ms(object.current_period_start) ?? ms(firstItem?.current_period_start),
          ms(object.current_period_end) ?? ms(firstItem?.current_period_end),
          ms(object.trial_end),
          sanitizePayload(object),
          ms(object.created) ?? now,
          now,
        ),
      );
    } else if (kind === 'invoice') {
      const currency = currencyOf(object);
      const subscriptionId =
        refId(object.subscription) ?? refId(path(object, 'parent', 'subscription_details', 'subscription'));
      const customerId = refId(object.customer);
      const amountPaid = num(object.amount_paid) ?? 0;
      statements.push(
        db.prepare(
          `INSERT OR REPLACE INTO stripe_invoice
             (website_id, data_source_id, invoice_id, customer_id, subscription_id, status, currency, total, amount_paid,
              amount_paid_major, period_start, period_end, paid_at, payload_json, created_at, synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
        ).bind(
          websiteId,
          dataSourceId,
          object.id,
          customerId,
          subscriptionId,
          str(object.status),
          currency,
          num(object.total) ?? 0,
          amountPaid,
          toMajorUnits(amountPaid, currency),
          ms(object.period_start),
          ms(object.period_end),
          ms(path(object, 'status_transitions', 'paid_at')),
          sanitizePayload(object),
          ms(object.created) ?? now,
          now,
        ),
      );
      // Lines are replaced as a set so a re-synced invoice never keeps stale lines.
      statements.push(
        db.prepare(`DELETE FROM stripe_invoice_line WHERE data_source_id = ?1 AND invoice_id = ?2`).bind(
          dataSourceId,
          object.id,
        ),
      );
      for (const raw of await invoiceLines(ctx, object)) {
        const line = parseInvoiceLine(raw, currency, subscriptionId);
        if (!line.lineId) continue;
        statements.push(
          db.prepare(
            `INSERT OR REPLACE INTO stripe_invoice_line
               (website_id, data_source_id, invoice_id, line_id, customer_id, subscription_id, price_id, interval, interval_count,
                quantity, proration, amount, currency, amount_major, mrr_major, period_start, period_end, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
          ).bind(
            websiteId,
            dataSourceId,
            object.id,
            line.lineId,
            customerId,
            line.subscriptionId,
            line.priceId,
            line.interval,
            line.intervalCount,
            line.quantity,
            line.proration ? 1 : 0,
            line.amount,
            currency,
            line.amountMajor,
            line.mrrMajor,
            line.periodStart,
            line.periodEnd,
            now,
          ),
        );
      }
    }
  }
  await writeStatements(ctx, statements);
}

/**
 * Links Stripe customers to people: metadata `distinct_id` wins (set at upsert), otherwise the
 * person whose `email` property matches the customer's email.
 */
export async function linkStripeCustomers(env: Env, websiteId: string, dataSourceId: string) {
  const result = await siteDb(env, websiteId)
    .prepare(
      `UPDATE stripe_customer
       SET distinct_id = (
         SELECT p.distinct_id FROM person p
         WHERE p.website_id = ?1 AND json_valid(p.properties_json)
           AND lower(COALESCE(json_extract(p.properties_json, '$.email'), json_extract(p.properties_json, '$."$email"'))) = stripe_customer.email
         ORDER BY p.last_seen_at DESC
         LIMIT 1
       )
       WHERE website_id = ?1 AND data_source_id = ?2 AND distinct_id IS NULL AND email IS NOT NULL AND deleted = 0`,
    )
    .bind(websiteId, dataSourceId)
    .run();
  return result.meta?.changes ?? 0;
}

// ---------------------------------------------------------------------------------------------
// State

export async function loadStripeSyncState(env: Env, websiteId: string, dataSourceId: string): Promise<StripeSyncState> {
  const row = await env.DB.prepare(
    `SELECT state_json AS stateJson FROM warehouse_sync_state WHERE website_id = ?1 AND data_source_id = ?2 LIMIT 1`,
  )
    .bind(websiteId, dataSourceId)
    .first<{ stateJson: string }>();
  if (!row) return initialStripeSyncState();
  try {
    const parsed = JSON.parse(row.stateJson) as StripeSyncState;
    return parsed?.version === 1 ? { ...initialStripeSyncState(), ...parsed } : initialStripeSyncState();
  } catch {
    return initialStripeSyncState();
  }
}

async function saveStripeSyncState(env: Env, websiteId: string, dataSourceId: string, state: StripeSyncState, now: number) {
  await env.DB.prepare(
    `INSERT INTO warehouse_sync_state (data_source_id, website_id, state_json, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(data_source_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
  )
    .bind(dataSourceId, websiteId, JSON.stringify(state), now)
    .run();
}

export async function deleteWarehouseSyncState(env: Env, websiteId: string, dataSourceId: string) {
  await env.DB.prepare(`DELETE FROM warehouse_sync_state WHERE website_id = ?1 AND data_source_id = ?2`)
    .bind(websiteId, dataSourceId)
    .run();
}

export const STRIPE_TABLES = [
  'stripe_customer',
  'stripe_charge',
  'stripe_refund',
  'stripe_invoice',
  'stripe_invoice_line',
  'stripe_subscription',
] as const;

/** Removes everything a Stripe source imported (data source deleted or API key replaced). */
export async function deleteStripeSourceData(env: Env, websiteId: string, dataSourceId: string) {
  const db = siteDb(env, websiteId);
  await db.batch(
    STRIPE_TABLES.map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE website_id = ?1 AND data_source_id = ?2`).bind(websiteId, dataSourceId),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Sync

async function runBackfill(ctx: Ctx, state: StripeSyncState, pageSize: number, save: () => Promise<void>) {
  if (state.backfillStartedAt == null) {
    // Remember where the event stream stands before listing, so changes made while the
    // backfill runs are replayed afterwards.
    const latest = await ctx.client.get<StripeList>('/v1/events', [['limit', '1']]);
    state.eventCursor = latest.data[0]?.id ?? null;
    state.eventsSince = Math.floor(ctx.now / 1000) - 60;
    state.backfillStartedAt = ctx.now;
    await save();
  }
  while (state.resource < BACKFILL_RESOURCES.length) {
    const resource = BACKFILL_RESOURCES[state.resource]!;
    const params: Array<[string, string]> = [['limit', String(pageSize)], ...resource.params];
    if (state.startingAfter) params.push(['starting_after', state.startingAfter]);
    const page = await ctx.client.get<StripeList>(resource.path, params);
    await upsertObjects(ctx, page.data);
    const last = page.data[page.data.length - 1];
    if (page.has_more && last) {
      state.startingAfter = last.id;
    } else {
      state.resource++;
      state.startingAfter = null;
    }
    await save();
  }
  state.phase = 'events';
  state.backfillCompletedAt = ctx.now;
  await save();
}

function eventTypeParams(): Array<[string, string]> {
  return STRIPE_EVENT_TYPES.map((type) => ['types[]', type] as [string, string]);
}

async function applyEvents(ctx: Ctx, newestFirst: StripeObject[]) {
  const objects: StripeObject[] = [];
  for (const event of [...newestFirst].reverse()) {
    const object = record(path(event, 'data', 'object')) as StripeObject | null;
    if (object?.id) objects.push(object);
  }
  // Oldest first: when one page touches an object twice, the newest snapshot is written last.
  await upsertObjects(ctx, objects);
}

async function runEvents(ctx: Ctx, state: StripeSyncState, pageSize: number, save: () => Promise<void>) {
  if (!state.eventCursor) {
    // No cursor (the account had no events when the backfill began): collect everything since
    // then, newest first, and apply once complete so no event is skipped.
    const collected: StripeObject[] = [];
    let startingAfter: string | null = null;
    for (;;) {
      const params: Array<[string, string]> = [
        ['limit', String(pageSize)],
        ['created[gt]', String(state.eventsSince ?? 0)],
        ...eventTypeParams(),
      ];
      if (startingAfter) params.push(['starting_after', startingAfter]);
      const page: StripeList = await ctx.client.get<StripeList>('/v1/events', params);
      collected.push(...page.data);
      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1]!.id;
    }
    if (!collected.length) return;
    await applyEvents(ctx, collected);
    state.eventCursor = collected[0]!.id;
    await save();
  }
  for (;;) {
    const page: StripeList = await ctx.client.get<StripeList>('/v1/events', [
      ['limit', String(pageSize)],
      ['ending_before', state.eventCursor!],
      ...eventTypeParams(),
    ]);
    if (!page.data.length) return;
    await applyEvents(ctx, page.data);
    // `ending_before` pages are the events right after the cursor, newest first.
    state.eventCursor = page.data[0]!.id;
    await save();
    if (!page.has_more) return;
  }
}

/**
 * One sync run for a Stripe data source. Returns `complete: false` when the request budget ran
 * out; the saved state lets the next run continue.
 */
export async function syncStripeDataSource(
  env: Env,
  websiteId: string,
  dataSourceId: string,
  options: StripeSyncOptions = {},
): Promise<StripeSyncResult> {
  const apiKey = await loadWarehouseCredential(env, websiteId, dataSourceId);
  if (!apiKey) throw new Error('Stripe API key is missing. Enter a restricted API key for this source.');
  const now = options.now ?? Date.now();
  const pageSize = Math.min(Math.max(options.pageSize ?? PAGE_SIZE, 1), PAGE_SIZE);
  const client = new StripeClient(
    apiKey,
    options.fetch ?? ((input, init) => fetch(input, init)),
    options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay))),
    options.maxRequests ?? DEFAULT_MAX_REQUESTS,
  );
  const ctx: Ctx = {
    env,
    websiteId,
    dataSourceId,
    client,
    now,
    imported: { customer: 0, subscription: 0, invoice: 0, charge: 0, refund: 0 },
  };
  let state = await loadStripeSyncState(env, websiteId, dataSourceId);
  const save = () => saveStripeSyncState(env, websiteId, dataSourceId, state, now);

  let complete = true;
  try {
    if (state.phase === 'backfill') await runBackfill(ctx, state, pageSize, save);
    try {
      await runEvents(ctx, state, pageSize, save);
    } catch (error) {
      // The cursor event is gone (older than Stripe's 30-day event retention): start over.
      if (error instanceof StripeApiError && (error.status === 404 || error.code === 'resource_missing')) {
        state = initialStripeSyncState();
        await save();
        complete = false;
      } else {
        throw error;
      }
    }
  } catch (error) {
    if (!(error instanceof StripeBudgetExhausted)) throw error;
    complete = false;
  } finally {
    // Also links customers imported by earlier runs to people who identified since.
    await linkStripeCustomers(env, websiteId, dataSourceId).catch(() => 0);
  }
  return { complete, requests: client.requests, imported: ctx.imported, phase: state.phase };
}
