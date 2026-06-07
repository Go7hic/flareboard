/** Bounds for advanced report queries (retention, journey, etc.). */
export const MAX_REPORT_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
export const MAX_JOURNEY_LIMIT = 100;
export const DEFAULT_JOURNEY_LIMIT = 20;
export const MAX_JOURNEY_VISIT_SAMPLE = 5000;
export const MAX_JOURNEY_PATH_STEPS = 12;

export function clampReportRange(startAt: number, endAt: number) {
  const end = Math.min(endAt, Date.now());
  let start = startAt;
  if (end - start > MAX_REPORT_RANGE_MS) {
    start = end - MAX_REPORT_RANGE_MS;
  }
  if (start >= end) {
    start = end - 30 * 24 * 60 * 60 * 1000;
  }
  return { startAt: start, endAt: end };
}

export function clampJourneyLimit(limit: number) {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_JOURNEY_LIMIT;
  return Math.min(Math.floor(limit), MAX_JOURNEY_LIMIT);
}
