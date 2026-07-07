import type { Context } from 'hono';
import { statsQuerySchema } from '@flareboard/shared';
import { clampReportRange } from './report-range';

const MS_DAY = 24 * 60 * 60 * 1000;

export type StatsDefaultSpan = '24h' | '30d' | '90d';

const SPAN_MS: Record<StatsDefaultSpan, number> = {
  '24h': MS_DAY,
  '30d': 30 * MS_DAY,
  '90d': 90 * MS_DAY,
};

export type ParsedStatsRange = {
  startAt: number;
  endAt: number;
  unit?: string;
};

export type ParsedStatsRangeWithUnit = ParsedStatsRange & { unit: string };

export type ParseStatsRangeOptions = {
  /** Default window when startAt is omitted. */
  defaultSpan?: StatsDefaultSpan;
  /** Include `unit` from query (defaults to `day`). */
  withUnit?: boolean;
  /** Clamp to report bounds via clampReportRange. */
  clamp?: boolean;
};

/** Shared stats date-range parsing for API routes (replaces 14 local copies). */
export function parseStatsRange(
  c: Context,
  options: ParseStatsRangeOptions & { withUnit: true },
): ParsedStatsRangeWithUnit;
export function parseStatsRange(c: Context, options?: ParseStatsRangeOptions): ParsedStatsRange;
export function parseStatsRange(c: Context, options: ParseStatsRangeOptions = {}): ParsedStatsRange {
  const { defaultSpan = '24h', withUnit = false, clamp = false } = options;
  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt != null ? query.data.endAt : Date.now();
  const startAt =
    query.success && query.data.startAt != null ? query.data.startAt : endAt - SPAN_MS[defaultSpan];
  const unit = withUnit ? (query.success && query.data.unit ? query.data.unit : 'day') : undefined;
  const range: ParsedStatsRange = unit ? { startAt, endAt, unit } : { startAt, endAt };
  if (!clamp) return withUnit ? (range as ParsedStatsRangeWithUnit) : range;
  const clamped = clampReportRange(range.startAt, range.endAt);
  return withUnit ? { ...clamped, unit: unit! } : clamped;
}
