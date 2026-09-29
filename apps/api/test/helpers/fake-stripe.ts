/**
 * In-memory Stripe API for connector tests: list endpoints with `limit` / `starting_after`,
 * `/v1/events` with `ending_before` / `created[gt]`, invoice line pagination, and scripted 429s.
 * Lists are returned newest first, like Stripe. No network is ever touched.
 */
export type FakeObject = { id: string; object: string; created: number; [key: string]: unknown };

export type FakeStripe = {
  fetch: typeof fetch;
  calls: string[];
  customers: FakeObject[];
  subscriptions: FakeObject[];
  invoices: FakeObject[];
  charges: FakeObject[];
  refunds: FakeObject[];
  events: FakeObject[];
  invoiceLines: Map<string, FakeObject[]>;
  /** The next N requests answer 429 with Retry-After: 1. */
  rateLimitNext: number;
  /** Adds an event (newest) carrying a snapshot of `object`. */
  emit(type: string, object: FakeObject, created: number): void;
};

function newestFirst(list: FakeObject[]) {
  return [...list].sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function createFakeStripe(apiKey: string): FakeStripe {
  let eventSeq = 0;
  const stripe: FakeStripe = {
    calls: [],
    customers: [],
    subscriptions: [],
    invoices: [],
    charges: [],
    refunds: [],
    events: [],
    invoiceLines: new Map(),
    rateLimitNext: 0,
    emit(type, object, created) {
      eventSeq++;
      stripe.events.push({
        id: `evt_${String(eventSeq).padStart(4, '0')}`,
        object: 'event',
        type,
        created,
        data: { object: structuredClone(object) },
      });
    },
    fetch: async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      stripe.calls.push(`${url.pathname}${url.search}`);
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== `Bearer ${apiKey}`) {
        return json({ error: { message: 'Invalid API Key provided', code: 'api_key_invalid' } }, 401);
      }
      if (stripe.rateLimitNext > 0) {
        stripe.rateLimitNext--;
        return json({ error: { message: 'Too many requests' } }, 429, { 'Retry-After': '1' });
      }
      const params = url.searchParams;
      const limit = Number(params.get('limit') ?? 10);
      const lineMatch = /^\/v1\/invoices\/([^/]+)\/lines$/.exec(url.pathname);
      let source: FakeObject[];
      if (lineMatch) source = stripe.invoiceLines.get(decodeURIComponent(lineMatch[1]!)) ?? [];
      else {
        const byPath: Record<string, FakeObject[]> = {
          '/v1/customers': stripe.customers,
          '/v1/subscriptions': stripe.subscriptions,
          '/v1/invoices': stripe.invoices,
          '/v1/charges': stripe.charges,
          '/v1/refunds': stripe.refunds,
          '/v1/events': stripe.events,
        };
        const list = byPath[url.pathname];
        if (!list) return json({ error: { message: `Unknown path ${url.pathname}` } }, 404);
        source = newestFirst(list);
      }
      const createdGt = params.get('created[gt]');
      if (createdGt) source = source.filter((item) => item.created > Number(createdGt));

      const endingBefore = params.get('ending_before');
      if (endingBefore) {
        const index = source.findIndex((item) => item.id === endingBefore);
        if (index < 0) {
          return json({ error: { message: `No such event: '${endingBefore}'`, code: 'resource_missing' } }, 400);
        }
        const newer = source.slice(0, index);
        return json({ object: 'list', data: newer.slice(-limit), has_more: newer.length > limit });
      }
      const startingAfter = params.get('starting_after');
      if (startingAfter) {
        const index = source.findIndex((item) => item.id === startingAfter);
        source = source.slice(index + 1);
      }
      return json({ object: 'list', data: source.slice(0, limit), has_more: source.length > limit });
    },
  };
  return stripe;
}

const DAY = 24 * 60 * 60;

/** Seconds since epoch for a UTC date. */
export function unix(year: number, month: number, day: number) {
  return Date.UTC(year, month - 1, day) / 1000;
}

export function subscriptionLine(
  id: string,
  subscription: string,
  amount: number,
  start: number,
  months = 1,
  extra: Record<string, unknown> = {},
): FakeObject {
  return {
    id,
    object: 'line_item',
    created: start,
    type: 'subscription',
    subscription,
    amount,
    currency: 'usd',
    proration: false,
    quantity: 1,
    discount_amounts: [],
    period: { start, end: start + Math.round(months * 30.4375 * DAY) },
    price: { id: `price_${id}`, recurring: { interval: months === 12 ? 'year' : 'month', interval_count: 1 } },
    ...extra,
  };
}
