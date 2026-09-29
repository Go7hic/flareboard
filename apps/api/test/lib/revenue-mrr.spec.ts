import { describe, expect, it } from 'vitest';
import { computeMrrSeries, monthSnapshots, type MrrLine } from '../../src/lib/revenue-analytics';
import { backoffMs, monthlyFactor, parseInvoiceLine, toMajorUnits } from '../../src/lib/stripe-connector';

const d = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day);

function monthly(customerId: string, amount: number, from: [number, number, number], months: number, currency = 'USD') {
  const lines: MrrLine[] = [];
  for (let i = 0; i < months; i++) {
    lines.push({
      customerId,
      currency,
      start: d(from[0], from[1] + i, from[2]),
      end: d(from[0], from[1] + i + 1, from[2]),
      mrr: amount,
    });
  }
  return lines;
}

/**
 * Hand-computed fixture, snapshots at the end of Jan–Apr 2026:
 * A  $100/mo all along, plus a $10/mo add-on from March (two subscriptions, one customer)
 * B  $50 in Jan → $80 in Feb (expansion) → $60 in Mar (contraction) → gone in Apr (churn)
 * C  $1,200/yr from Feb 15 ($100 MRR)
 * D  $30/mo Jan 10 – Feb 10 only (churns in Feb)
 * E  €40/mo from Mar 5 (separate currency, never summed with USD)
 */
const LINES: MrrLine[] = [
  ...monthly('A', 100, [2026, 1, 1], 4),
  ...monthly('A', 10, [2026, 3, 1], 2),
  { customerId: 'B', currency: 'USD', start: d(2026, 1, 1), end: d(2026, 2, 1), mrr: 50 },
  { customerId: 'B', currency: 'USD', start: d(2026, 2, 1), end: d(2026, 3, 1), mrr: 80 },
  { customerId: 'B', currency: 'USD', start: d(2026, 3, 1), end: d(2026, 4, 1), mrr: 60 },
  { customerId: 'C', currency: 'USD', start: d(2026, 2, 15), end: d(2027, 2, 15), mrr: 100 },
  { customerId: 'D', currency: 'USD', start: d(2026, 1, 10), end: d(2026, 2, 10), mrr: 30 },
  ...monthly('E', 40, [2026, 3, 5], 2, 'EUR'),
];

describe('computeMrrSeries', () => {
  const { points, baselineAt } = monthSnapshots(d(2026, 1, 1), d(2026, 5, 1) - 1);
  const series = computeMrrSeries(LINES, points, baselineAt);
  const usd = series.filter((point) => point.currency === 'USD');
  const eur = series.filter((point) => point.currency === 'EUR');

  it('snapshots the last instant of each month', () => {
    expect(points.map((point) => point.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(points[0]!.at).toBe(d(2026, 2, 1) - 1);
    expect(baselineAt).toBe(d(2026, 1, 1) - 1);
    // A range ending mid-month snapshots at its end.
    expect(monthSnapshots(d(2026, 3, 10), d(2026, 3, 20)).points).toEqual([{ period: '2026-03', at: d(2026, 3, 20) }]);
  });

  it('January: everyone is new', () => {
    expect(usd[0]).toEqual({
      period: '2026-01',
      at: d(2026, 2, 1) - 1,
      currency: 'USD',
      mrr: 180,
      arr: 2160,
      subscribers: 3,
      newMrr: 180,
      expansionMrr: 0,
      contractionMrr: 0,
      churnedMrr: 0,
      newSubscribers: 3,
      churnedSubscribers: 0,
      churnRate: null,
      arpu: 60,
    });
  });

  it('February: C is new, B expands, D churns', () => {
    expect(usd[1]).toMatchObject({
      mrr: 280, // A 100 + B 80 + C 100
      subscribers: 3,
      newMrr: 100,
      expansionMrr: 30,
      contractionMrr: 0,
      churnedMrr: 30,
      newSubscribers: 1,
      churnedSubscribers: 1,
      churnRate: 0.3333, // 1 of 3
      arpu: 93.33,
    });
  });

  it('March: A expands with a second subscription, B contracts', () => {
    expect(usd[2]).toMatchObject({
      mrr: 270, // A 110 + B 60 + C 100
      subscribers: 3,
      newMrr: 0,
      expansionMrr: 10,
      contractionMrr: 20,
      churnedMrr: 0,
      churnRate: 0,
      arpu: 90,
    });
  });

  it('April: B churns', () => {
    expect(usd[3]).toMatchObject({
      mrr: 210, // A 110 + C 100
      arr: 2520,
      subscribers: 2,
      churnedMrr: 60,
      churnedSubscribers: 1,
      churnRate: 0.3333,
      arpu: 105,
    });
  });

  it('keeps currencies apart', () => {
    expect(eur.map((point) => [point.period, point.mrr, point.subscribers, point.newMrr])).toEqual([
      ['2026-01', 0, 0, 0],
      ['2026-02', 0, 0, 0],
      ['2026-03', 40, 1, 40],
      ['2026-04', 40, 1, 0],
    ]);
    expect(eur[0]).toMatchObject({ churnRate: null, arpu: null });
  });

  it('movement reconciles: previous + new + expansion − contraction − churned = current', () => {
    for (let i = 1; i < usd.length; i++) {
      const p = usd[i]!;
      expect(usd[i - 1]!.mrr + p.newMrr + p.expansionMrr - p.contractionMrr - p.churnedMrr).toBeCloseTo(p.mrr, 6);
    }
  });
});

describe('Stripe amount helpers', () => {
  it('converts minor units per currency', () => {
    expect(toMajorUnits(1999, 'usd')).toBe(19.99);
    expect(toMajorUnits(500, 'JPY')).toBe(500);
    expect(toMajorUnits(1500, 'kwd')).toBe(1.5);
  });

  it('normalizes billing intervals to a month', () => {
    expect(monthlyFactor('month', 1, null, null)).toBe(1);
    expect(monthlyFactor('month', 3, null, null)).toBeCloseTo(1 / 3);
    expect(monthlyFactor('year', 1, null, null)).toBeCloseTo(1 / 12);
    expect(monthlyFactor('week', 2, null, null)).toBeCloseTo(52 / 24);
    // Without a price, the period length decides.
    expect(monthlyFactor(null, null, d(2026, 2, 1), d(2026, 3, 1))).toBe(1);
    expect(monthlyFactor(null, null, d(2026, 1, 1), d(2027, 1, 1))).toBeCloseTo(1 / 12);
    expect(monthlyFactor(null, null, null, null)).toBe(0);
  });

  it('parses the newer invoice line shape (parent.subscription_item_details, pricing) with discounts', () => {
    const line = parseInvoiceLine(
      {
        id: 'il_new',
        amount: 12000,
        discount_amounts: [{ amount: 2000 }],
        period: { start: d(2026, 1, 1) / 1000, end: d(2027, 1, 1) / 1000 },
        pricing: { price_details: { price: 'price_123' } },
        parent: { subscription_item_details: { subscription: 'sub_9', proration: false } },
      },
      'EUR',
      null,
    );
    expect(line).toMatchObject({ subscriptionId: 'sub_9', priceId: 'price_123', proration: false, amount: 10000, amountMajor: 100 });
    expect(line.mrrMajor).toBeCloseTo(100 / 12);
  });

  it('honors Retry-After and otherwise backs off exponentially', () => {
    expect(backoffMs('2', 0)).toBe(2000);
    expect(backoffMs(null, 0)).toBe(500);
    expect(backoffMs(null, 2)).toBe(2000);
    expect(backoffMs('600', 0)).toBe(8000);
  });
});
