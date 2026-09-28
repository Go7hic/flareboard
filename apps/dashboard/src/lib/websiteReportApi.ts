import { propertyFilterProblem, type PropertyFilter } from '@flareboard/shared/insight-query';

export function websiteReportUrl(
  path: string,
  websiteId: string,
  rangeQs: string,
  segmentId?: string,
  extra = '',
) {
  const segmentQs = segmentId ? `&segmentId=${encodeURIComponent(segmentId)}` : '';
  return `/api/reports/${path}?websiteId=${websiteId}&${rangeQs}${segmentQs}${extra}`;
}

/** Filters that can run; rows still being edited are left out. */
export function completeFilters(filters: PropertyFilter[]): PropertyFilter[] {
  return filters.filter((filter) => filter.key.trim() && !propertyFilterProblem(filter));
}

/** `&filters=<json>` for report endpoints (incomplete filter rows are dropped). */
export function reportFiltersParam(filters: PropertyFilter[]): string {
  const complete = completeFilters(filters);
  return complete.length ? `&filters=${encodeURIComponent(JSON.stringify(complete))}` : '';
}
