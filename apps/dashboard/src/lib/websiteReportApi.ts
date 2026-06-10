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
