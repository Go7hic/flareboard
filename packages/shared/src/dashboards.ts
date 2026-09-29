/**
 * Dashboards: board layout and filters, board templates, insight alerts, report subscriptions and
 * notebooks. Shared by the API (validation, scheduling, evaluation) and the dashboard (editors).
 */
import { z } from 'zod';
import {
  propertyFiltersSchema,
  type InsightQuery,
  type InsightType,
  type PropertyFilter,
} from './insight-query';
import { siteCalendarParts, siteLocalToUtc, siteStartOfDay, type SiteTimezone } from './timezone';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Board layout and filters (stored in board.parameters)
// ---------------------------------------------------------------------------------------------

export const BOARD_RANGE_PRESETS = ['24h', '7d', '30d', '90d'] as const;
export type BoardRangePresetId = (typeof BOARD_RANGE_PRESETS)[number];

/** Widget widths on a 12-column grid: small 4, medium 6, large 8, full 12. */
export const BOARD_WIDGET_SIZES = ['small', 'medium', 'large', 'full'] as const;
export type BoardWidgetSize = (typeof BOARD_WIDGET_SIZES)[number];
export const BOARD_WIDGET_COLUMNS: Record<BoardWidgetSize, number> = { small: 4, medium: 6, large: 8, full: 12 };

/** Widths saved before sizes existed (`third`, `half`) map onto the new scale. */
export function normalizeBoardWidgetSize(value: unknown): BoardWidgetSize {
  if (value === 'third') return 'small';
  if (value === 'half') return 'medium';
  return typeof value === 'string' && (BOARD_WIDGET_SIZES as readonly string[]).includes(value)
    ? (value as BoardWidgetSize)
    : 'medium';
}

/** Board-wide property filters, merged into every insight widget when the board runs. */
export function parseBoardFilters(parameters: unknown): PropertyFilter[] {
  if (!parameters || typeof parameters !== 'object') return [];
  const parsed = propertyFiltersSchema.safeParse((parameters as { filters?: unknown }).filters ?? []);
  return parsed.success ? parsed.data : [];
}

export function parseBoardRangePreset(parameters: unknown): BoardRangePresetId {
  const raw = parameters && typeof parameters === 'object' ? (parameters as { rangePreset?: unknown }).rangePreset : null;
  return typeof raw === 'string' && (BOARD_RANGE_PRESETS as readonly string[]).includes(raw)
    ? (raw as BoardRangePresetId)
    : '7d';
}

/** Validation of the parts of board.parameters the API understands (widgets stay open-ended). */
export const boardParametersSchema = z
  .object({
    rangePreset: z.enum(BOARD_RANGE_PRESETS).optional(),
    filters: propertyFiltersSchema.optional(),
    widgets: z.array(z.record(z.unknown())).max(50).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------------------------
// Board templates
// ---------------------------------------------------------------------------------------------

export type BoardTemplateWidget = {
  /** Stable key; the dashboard localizes names by it (`boardTemplateWidget_<key>`). */
  key: string;
  name: string;
  type: InsightType;
  query: InsightQuery;
  size: BoardWidgetSize;
};

export type BoardTemplate = {
  id: 'product-analytics' | 'web-analytics' | 'revenue';
  name: string;
  description: string;
  rangePreset: BoardRangePresetId;
  widgets: BoardTemplateWidget[];
};

const REVENUE_SET: PropertyFilter = { type: 'event', key: 'revenue', operator: 'is_set' };

export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: 'product-analytics',
    name: 'Product analytics',
    description: 'Active users, engagement, retention and the most used events.',
    rangePreset: '30d',
    widgets: [
      {
        key: 'dau',
        name: 'Daily active users',
        type: 'trend',
        size: 'medium',
        query: { version: 2, interval: 'day', compare: true, series: [{ kind: 'all', math: 'unique_users', label: 'Active users' }] },
      },
      {
        key: 'wau',
        name: 'Weekly active users',
        type: 'trend',
        size: 'medium',
        query: { version: 2, interval: 'week', series: [{ kind: 'all', math: 'unique_users', label: 'Active users' }] },
      },
      {
        key: 'retention',
        name: 'Weekly retention',
        type: 'retention',
        size: 'large',
        query: {
          version: 2,
          countBy: 'person',
          retention: { startEvent: { kind: 'all' }, returnEvent: { kind: 'all' }, period: 'week', periods: 8 },
        },
      },
      {
        key: 'stickiness',
        name: 'Stickiness',
        type: 'stickiness',
        size: 'small',
        query: { version: 2, countBy: 'person', series: [{ kind: 'all', math: 'total' }] },
      },
      {
        key: 'lifecycle',
        name: 'User lifecycle',
        type: 'lifecycle',
        size: 'medium',
        query: { version: 2, interval: 'week', countBy: 'person', series: [{ kind: 'all', math: 'total' }] },
      },
      {
        key: 'topEvents',
        name: 'Top events',
        type: 'table',
        size: 'medium',
        query: { version: 2, table: { dimension: 'event', limit: 10 } },
      },
    ],
  },
  {
    id: 'web-analytics',
    name: 'Web analytics',
    description: 'Traffic, visitors, top pages, sources, countries and devices.',
    rangePreset: '30d',
    widgets: [
      {
        key: 'pageviews',
        name: 'Pageviews and visitors',
        type: 'trend',
        size: 'full',
        query: {
          version: 2,
          interval: 'day',
          compare: true,
          series: [
            { kind: 'pageview', math: 'total', label: 'Pageviews' },
            { kind: 'pageview', math: 'unique_users', label: 'Visitors' },
          ],
        },
      },
      { key: 'topPages', name: 'Top pages', type: 'table', size: 'medium', query: { version: 2, table: { dimension: 'path', limit: 10 } } },
      {
        key: 'topReferrers',
        name: 'Top referrers',
        type: 'table',
        size: 'medium',
        query: { version: 2, table: { dimension: 'referrer', limit: 10 } },
      },
      {
        key: 'channels',
        name: 'Channels',
        type: 'table',
        size: 'small',
        query: { version: 2, table: { dimension: 'channel', limit: 10 } },
      },
      {
        key: 'countries',
        name: 'Countries',
        type: 'table',
        size: 'small',
        query: { version: 2, table: { dimension: 'country', limit: 10 } },
      },
      { key: 'devices', name: 'Devices', type: 'table', size: 'small', query: { version: 2, table: { dimension: 'device', limit: 10 } } },
    ],
  },
  {
    id: 'revenue',
    name: 'Revenue',
    description: 'Revenue, orders, paying customers and average order value from events with a `revenue` property.',
    rangePreset: '30d',
    widgets: [
      {
        key: 'revenue',
        name: 'Revenue',
        type: 'trend',
        size: 'large',
        query: {
          version: 2,
          interval: 'day',
          compare: true,
          series: [{ kind: 'event', event: null, math: 'sum', mathProperty: 'revenue', filters: [REVENUE_SET], label: 'Revenue' }],
        },
      },
      {
        key: 'orders',
        name: 'Orders',
        type: 'trend',
        size: 'small',
        query: {
          version: 2,
          interval: 'day',
          series: [{ kind: 'event', event: null, math: 'total', filters: [REVENUE_SET], label: 'Orders' }],
        },
      },
      {
        key: 'payingCustomers',
        name: 'Paying customers',
        type: 'trend',
        size: 'medium',
        query: {
          version: 2,
          interval: 'week',
          series: [{ kind: 'event', event: null, math: 'unique_users', filters: [REVENUE_SET], label: 'Paying customers' }],
        },
      },
      {
        key: 'averageOrderValue',
        name: 'Average order value',
        type: 'trend',
        size: 'medium',
        query: {
          version: 2,
          interval: 'week',
          formula: 'A / B',
          series: [
            { kind: 'event', event: null, math: 'sum', mathProperty: 'revenue', filters: [REVENUE_SET], label: 'Revenue' },
            { kind: 'event', event: null, math: 'total', filters: [REVENUE_SET], label: 'Orders' },
          ],
        },
      },
      {
        key: 'revenueByCountry',
        name: 'Revenue by country',
        type: 'trend',
        size: 'full',
        query: {
          version: 2,
          interval: 'week',
          breakdown: { type: 'dimension', key: 'country' },
          series: [{ kind: 'event', event: null, math: 'sum', mathProperty: 'revenue', filters: [REVENUE_SET], label: 'Revenue' }],
        },
      },
    ],
  },
];

export function findBoardTemplate(id: string): BoardTemplate | null {
  return BOARD_TEMPLATES.find((template) => template.id === id) ?? null;
}

export const createBoardFromTemplateSchema = z.object({
  websiteId: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  /** Localized board description (defaults to the template's English one). */
  description: z.string().trim().max(500).optional(),
  teamId: z.string().uuid().nullable().optional(),
  /** Localized insight names by template widget key. */
  names: z.record(z.string().trim().min(1).max(120)).optional(),
});

// ---------------------------------------------------------------------------------------------
// Insight alerts
// ---------------------------------------------------------------------------------------------

export const MAX_INSIGHT_ALERTS_PER_WEBSITE = 20;

export const INSIGHT_ALERT_CONDITIONS = ['value_above', 'value_below', 'increase_above', 'decrease_above'] as const;
export type InsightAlertCondition = (typeof INSIGHT_ALERT_CONDITIONS)[number];

export const INSIGHT_ALERT_INTERVALS = ['hour', 'day', 'week'] as const;
export type InsightAlertInterval = (typeof INSIGHT_ALERT_INTERVALS)[number];

export const INSIGHT_ALERT_CHANNELS = ['email', 'webhook'] as const;
export type InsightAlertChannel = (typeof INSIGHT_ALERT_CHANNELS)[number];

/** Result lines an alert can watch: series letters or the formula line. */
export const INSIGHT_ALERT_SERIES_KEYS = ['A', 'B', 'C', 'D', 'E', 'formula'] as const;

function alertTargetProblem(channel: InsightAlertChannel, target: string | null | undefined): string | null {
  const value = target?.trim() ?? '';
  if (!value) return channel === 'email' ? 'Enter an email address' : 'Enter a webhook URL';
  if (channel === 'email') return z.string().email().safeParse(value).success ? null : 'Enter a valid email address';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'Webhook URL must use http or https';
  } catch {
    return 'Enter a valid webhook URL';
  }
}

const insightAlertFields = {
  name: z.string().trim().min(1).max(120),
  condition: z.enum(INSIGHT_ALERT_CONDITIONS),
  threshold: z.number().finite().min(-1e12).max(1e12),
  seriesKey: z.enum(INSIGHT_ALERT_SERIES_KEYS).default('A'),
  checkInterval: z.enum(INSIGHT_ALERT_INTERVALS).default('day'),
  channel: z.enum(INSIGHT_ALERT_CHANNELS).default('email'),
  target: z.string().trim().max(2000),
  enabled: z.boolean().default(true),
};

export const createInsightAlertSchema = z
  .object(insightAlertFields)
  .superRefine((value, ctx) => {
    const problem = alertTargetProblem(value.channel, value.target);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['target'] });
    if (value.condition !== 'value_above' && value.condition !== 'value_below' && value.threshold < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent change must be positive', path: ['threshold'] });
    }
  });

export const updateInsightAlertSchema = z.object({
  name: insightAlertFields.name.optional(),
  condition: insightAlertFields.condition.optional(),
  threshold: insightAlertFields.threshold.optional(),
  seriesKey: z.enum(INSIGHT_ALERT_SERIES_KEYS).optional(),
  checkInterval: z.enum(INSIGHT_ALERT_INTERVALS).optional(),
  channel: z.enum(INSIGHT_ALERT_CHANNELS).optional(),
  target: insightAlertFields.target.optional(),
  enabled: z.boolean().optional(),
  /** Snooze until this time (ms); null clears the snooze. */
  snoozedUntil: z.number().int().min(0).nullable().optional(),
});

/** Re-check a patched alert as a whole (a channel change needs a matching target). */
export function insightAlertTargetProblem(channel: InsightAlertChannel, target: string | null | undefined) {
  return alertTargetProblem(channel, target);
}

export type AlertInterval = { startAt: number; endAt: number };

/** Start of the local hour / day / ISO week (Monday) containing `ms`. */
function intervalStart(ms: number, interval: InsightAlertInterval, timezone: SiteTimezone): number {
  if (interval === 'day') return siteStartOfDay(ms, timezone);
  const p = siteCalendarParts(ms, timezone);
  const hour = p.hour === 24 ? 0 : p.hour;
  if (interval === 'hour') return siteLocalToUtc(p.year, p.month, p.day, hour, 0, 0, 0, timezone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return siteLocalToUtc(p.year, p.month, p.day - mondayOffset, 0, 0, 0, 0, timezone);
}

/**
 * The last complete interval before `now` and the one before it (for percent change), in the
 * site's calendar. Endpoints are half-open: `endAt` is the next interval's start minus 1 ms.
 */
export function alertIntervals(
  now: number,
  interval: InsightAlertInterval,
  timezone: SiteTimezone,
): { current: AlertInterval; previous: AlertInterval } {
  const currentEnd = intervalStart(now, interval, timezone);
  const step = interval === 'hour' ? HOUR_MS : interval === 'day' ? DAY_MS : 7 * DAY_MS;
  // Step back past the boundary, then snap: stays right across daylight-saving changes.
  const currentStart = intervalStart(currentEnd - step / 2, interval, timezone);
  const previousStart = intervalStart(currentStart - step / 2, interval, timezone);
  return {
    current: { startAt: currentStart, endAt: currentEnd - 1 },
    previous: { startAt: previousStart, endAt: currentStart - 1 },
  };
}

/** Whether an alert fires for a value (and the previous interval's value for percent changes). */
export function alertConditionMet(
  condition: InsightAlertCondition,
  threshold: number,
  value: number,
  previous: number | null,
): boolean {
  switch (condition) {
    case 'value_above':
      return value > threshold;
    case 'value_below':
      return value < threshold;
    case 'increase_above':
    case 'decrease_above': {
      // Percent change from zero is undefined: no alert rather than an infinite spike.
      if (previous === null || previous === 0) return false;
      const change = ((value - previous) / Math.abs(previous)) * 100;
      return condition === 'increase_above' ? change > threshold : -change > threshold;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Report subscriptions
// ---------------------------------------------------------------------------------------------

export const SUBSCRIPTION_FREQUENCIES = ['daily', 'weekly'] as const;
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];
export const MAX_SUBSCRIPTION_RECIPIENTS = 10;
export const MAX_SUBSCRIPTIONS_PER_TARGET = 10;

const recipientsSchema = z
  .array(z.string().trim().toLowerCase().email().max(200))
  .min(1)
  .max(MAX_SUBSCRIPTION_RECIPIENTS)
  .transform((list) => [...new Set(list)]);

export const createSubscriptionSchema = z.object({
  targetType: z.enum(['board', 'insight']),
  targetId: z.string().uuid(),
  title: z.string().trim().max(120).optional(),
  frequency: z.enum(SUBSCRIPTION_FREQUENCIES),
  /** 0 = Sunday … 6 = Saturday (weekly only). */
  weekday: z.number().int().min(0).max(6).default(1),
  hour: z.number().int().min(0).max(23).default(8),
  timezone: z.string().trim().max(64).optional(),
  recipients: recipientsSchema,
  enabled: z.boolean().default(true),
});

export const updateSubscriptionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  frequency: z.enum(SUBSCRIPTION_FREQUENCIES).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().trim().max(64).optional(),
  recipients: recipientsSchema.optional(),
  enabled: z.boolean().optional(),
});

export type SubscriptionSchedule = {
  frequency: SubscriptionFrequency;
  hour: number;
  weekday: number;
  timezone: SiteTimezone;
};

/** First scheduled send strictly after `after` (local `hour`, and `weekday` for weekly). */
export function nextSubscriptionRunAt(schedule: SubscriptionSchedule, after: number): number {
  const p = siteCalendarParts(after, schedule.timezone);
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    if (schedule.frequency === 'weekly' && date.getUTCDay() !== schedule.weekday) continue;
    const candidate = siteLocalToUtc(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      schedule.hour,
      0,
      0,
      0,
      schedule.timezone,
    );
    if (candidate > after) return candidate;
  }
  // Unreachable for valid schedules; fall back to one period later.
  return after + (schedule.frequency === 'weekly' ? 7 : 1) * DAY_MS;
}

/**
 * Period a send covers: the previous local day (daily) or the previous 7 local days (weekly),
 * ending at the start of the send day, plus the period before it for deltas.
 */
export function subscriptionPeriods(frequency: SubscriptionFrequency, runAt: number, timezone: SiteTimezone) {
  const days = frequency === 'daily' ? 1 : 7;
  const end = siteStartOfDay(runAt, timezone);
  const p = siteCalendarParts(end, timezone);
  const start = siteLocalToUtc(p.year, p.month, p.day - days, 0, 0, 0, 0, timezone);
  const previousStart = siteLocalToUtc(p.year, p.month, p.day - 2 * days, 0, 0, 0, 0, timezone);
  return {
    current: { startAt: start, endAt: end - 1 },
    previous: { startAt: previousStart, endAt: start - 1 },
  };
}

// ---------------------------------------------------------------------------------------------
// Notebooks
// ---------------------------------------------------------------------------------------------

export const MAX_NOTEBOOK_BLOCKS = 100;
export const MAX_NOTEBOOK_TEXT_LENGTH = 20_000;

/** Removes control characters (keeps tab and newline) and normalizes line endings. */
export function sanitizeNotebookText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .slice(0, MAX_NOTEBOOK_TEXT_LENGTH);
}

const blockId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const notebookBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: blockId,
    type: z.literal('text'),
    text: z.string().max(MAX_NOTEBOOK_TEXT_LENGTH * 2).transform(sanitizeNotebookText),
  }),
  z.object({
    id: blockId,
    type: z.literal('insight'),
    insightId: z.string().uuid(),
    rangePreset: z.enum(BOARD_RANGE_PRESETS).optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal('replay'),
    sessionId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,128}$/, 'Invalid session id'),
    label: z.string().max(200).transform(sanitizeNotebookText).optional(),
  }),
]);
export type NotebookBlock = z.infer<typeof notebookBlockSchema>;

export const notebookContentSchema = z.object({
  blocks: z.array(notebookBlockSchema).max(MAX_NOTEBOOK_BLOCKS),
});
export type NotebookContent = z.infer<typeof notebookContentSchema>;

export const createNotebookSchema = z.object({
  title: z.string().trim().min(1).max(200).transform(sanitizeNotebookText),
  content: notebookContentSchema.default({ blocks: [] }),
});

export const updateNotebookSchema = z.object({
  title: z.string().trim().min(1).max(200).transform(sanitizeNotebookText).optional(),
  content: notebookContentSchema.optional(),
});

// ---------------------------------------------------------------------------------------------
// Shares of a board or an insight
// ---------------------------------------------------------------------------------------------

export const createEntityShareSchema = z.object({
  name: z.string().trim().max(100).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
