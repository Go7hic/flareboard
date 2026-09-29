import { describe, expect, it } from 'vitest';
import {
  alertConditionMet,
  alertIntervals,
  BOARD_TEMPLATES,
  createInsightAlertSchema,
  createSubscriptionSchema,
  nextSubscriptionRunAt,
  normalizeBoardWidgetSize,
  notebookContentSchema,
  parseBoardFilters,
  sanitizeNotebookText,
  subscriptionPeriods,
} from './dashboards';
import { parseInsightQuery } from './insight-query';

const iso = (ms: number) => new Date(ms).toISOString();

describe('board layout and filters', () => {
  it('maps legacy widths onto sizes', () => {
    expect(normalizeBoardWidgetSize('third')).toBe('small');
    expect(normalizeBoardWidgetSize('half')).toBe('medium');
    expect(normalizeBoardWidgetSize('large')).toBe('large');
    expect(normalizeBoardWidgetSize('huge')).toBe('medium');
  });

  it('keeps valid board filters and drops invalid ones', () => {
    expect(parseBoardFilters({ filters: [{ type: 'dimension', key: 'country', operator: 'is', value: ['US'] }] })).toHaveLength(1);
    expect(parseBoardFilters({ filters: [{ type: 'dimension', key: 'nope', operator: 'is', value: ['US'] }] })).toEqual([]);
    expect(parseBoardFilters(null)).toEqual([]);
  });

  it('ships templates whose queries validate', () => {
    for (const template of BOARD_TEMPLATES) {
      for (const widget of template.widgets) {
        const parsed = parseInsightQuery(widget.type, widget.query);
        expect(parsed.ok, `${template.id}/${widget.key}`).toBe(true);
      }
    }
  });
});

describe('alert intervals and conditions', () => {
  it('returns the last complete day and the day before in the site timezone', () => {
    const now = Date.UTC(2026, 8, 29, 3, 30); // 05:30 in Berlin (UTC+2)
    const { current, previous } = alertIntervals(now, 'day', 'Europe/Berlin');
    expect(iso(current.startAt)).toBe('2026-09-27T22:00:00.000Z');
    expect(iso(current.endAt + 1)).toBe('2026-09-28T22:00:00.000Z');
    expect(iso(previous.startAt)).toBe('2026-09-26T22:00:00.000Z');
  });

  it('handles hours and ISO weeks', () => {
    const now = Date.UTC(2026, 8, 30, 10, 15); // Wednesday
    const hour = alertIntervals(now, 'hour', 'UTC');
    expect(iso(hour.current.startAt)).toBe('2026-09-30T09:00:00.000Z');
    expect(iso(hour.previous.startAt)).toBe('2026-09-30T08:00:00.000Z');
    const week = alertIntervals(now, 'week', 'UTC');
    expect(iso(week.current.startAt)).toBe('2026-09-21T00:00:00.000Z');
    expect(iso(week.current.endAt + 1)).toBe('2026-09-28T00:00:00.000Z');
    expect(iso(week.previous.startAt)).toBe('2026-09-14T00:00:00.000Z');
  });

  it('evaluates absolute and relative conditions', () => {
    expect(alertConditionMet('value_above', 10, 11, null)).toBe(true);
    expect(alertConditionMet('value_above', 10, 10, null)).toBe(false);
    expect(alertConditionMet('value_below', 10, 3, null)).toBe(true);
    expect(alertConditionMet('increase_above', 50, 16, 10)).toBe(true);
    expect(alertConditionMet('increase_above', 50, 15, 10)).toBe(false);
    expect(alertConditionMet('decrease_above', 20, 7, 10)).toBe(true);
    expect(alertConditionMet('increase_above', 1, 5, 0)).toBe(false);
  });

  it('validates the alert target for its channel', () => {
    const base = { name: 'Drop', condition: 'value_below', threshold: 5 } as const;
    expect(createInsightAlertSchema.safeParse({ ...base, channel: 'email', target: 'ops@example.com' }).success).toBe(true);
    expect(createInsightAlertSchema.safeParse({ ...base, channel: 'email', target: 'nope' }).success).toBe(false);
    expect(createInsightAlertSchema.safeParse({ ...base, channel: 'webhook', target: 'javascript:alert(1)' }).success).toBe(false);
    expect(createInsightAlertSchema.safeParse({ ...base, channel: 'webhook', target: 'https://hooks.example.com/x' }).success).toBe(true);
  });
});

describe('subscription schedule', () => {
  it('schedules daily sends at the local hour', () => {
    const tz = 'Asia/Shanghai'; // UTC+8
    const after = Date.UTC(2026, 8, 29, 1, 0); // 09:00 local
    expect(iso(nextSubscriptionRunAt({ frequency: 'daily', hour: 8, weekday: 1, timezone: tz }, after))).toBe(
      '2026-09-30T00:00:00.000Z',
    );
    expect(iso(nextSubscriptionRunAt({ frequency: 'daily', hour: 10, weekday: 1, timezone: tz }, after))).toBe(
      '2026-09-29T02:00:00.000Z',
    );
  });

  it('schedules weekly sends on the chosen weekday', () => {
    const after = Date.UTC(2026, 8, 29, 12, 0); // Tuesday
    expect(iso(nextSubscriptionRunAt({ frequency: 'weekly', hour: 8, weekday: 1, timezone: 'UTC' }, after))).toBe(
      '2026-10-05T08:00:00.000Z',
    );
    // A slot is never scheduled at the same instant twice.
    const slot = Date.UTC(2026, 9, 5, 8, 0);
    expect(nextSubscriptionRunAt({ frequency: 'weekly', hour: 8, weekday: 1, timezone: 'UTC' }, slot)).toBe(slot + 7 * 86_400_000);
  });

  it('covers the previous day or week', () => {
    const runAt = Date.UTC(2026, 9, 5, 8, 0);
    const weekly = subscriptionPeriods('weekly', runAt, 'UTC');
    expect(iso(weekly.current.startAt)).toBe('2026-09-28T00:00:00.000Z');
    expect(iso(weekly.current.endAt + 1)).toBe('2026-10-05T00:00:00.000Z');
    expect(iso(weekly.previous.startAt)).toBe('2026-09-21T00:00:00.000Z');
    const daily = subscriptionPeriods('daily', runAt, 'UTC');
    expect(iso(daily.current.startAt)).toBe('2026-10-04T00:00:00.000Z');
  });

  it('normalizes and deduplicates recipients', () => {
    const parsed = createSubscriptionSchema.parse({
      targetType: 'board',
      targetId: '00000000-0000-4000-8000-000000000001',
      frequency: 'weekly',
      recipients: ['A@Example.com', 'a@example.com'],
    });
    expect(parsed.recipients).toEqual(['a@example.com']);
  });
});

describe('notebook content', () => {
  it('strips control characters and rejects unknown blocks', () => {
    expect(sanitizeNotebookText('a\u0000b\r\nc‮')).toBe('ab\nc');
    const parsed = notebookContentSchema.parse({ blocks: [{ id: 'b1', type: 'text', text: 'hi\u0007' }] });
    expect(parsed.blocks[0]).toEqual({ id: 'b1', type: 'text', text: 'hi' });
    expect(notebookContentSchema.safeParse({ blocks: [{ id: 'b1', type: 'html', html: '<b>' }] }).success).toBe(false);
    expect(
      notebookContentSchema.safeParse({ blocks: [{ id: 'b1', type: 'replay', sessionId: '"><script>' }] }).success,
    ).toBe(false);
  });
});
