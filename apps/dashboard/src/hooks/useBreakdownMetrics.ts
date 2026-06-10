import { useQuery } from '@tanstack/react-query';
import { api, type MetricRow } from '../lib/api';
import { formatMetricLabel } from '../lib/metric-labels';
import type { MetricTab } from '../lib/breakdown-dimensions';

export type PathSortBy = 'views' | 'visitors' | 'time';

export function useBreakdownMetrics({
  websiteId,
  rangeQs,
  segmentQs = '',
  metricTab,
  pathSortBy = 'views',
  enabled = true,
}: {
  websiteId: string | undefined;
  rangeQs: string;
  segmentQs?: string;
  metricTab: MetricTab;
  pathSortBy?: PathSortBy;
  enabled?: boolean;
}) {
  const useSegmentFilter = Boolean(segmentQs);

  const overviewQuery = useQuery({
    queryKey: ['breakdown-overview', websiteId, metricTab, pathSortBy, rangeQs],
    enabled: Boolean(websiteId) && !useSegmentFilter && enabled,
    queryFn: () => {
      const sortQs = metricTab === 'path' ? `&sortBy=${pathSortBy}` : '';
      return api<{ metrics: MetricRow[] }>(
        `/api/websites/${websiteId}/stats/overview?unit=day&type=${metricTab}&${rangeQs}${sortQs}`,
      );
    },
  });

  const metricsQuery = useQuery({
    queryKey: ['breakdown-metrics', websiteId, metricTab, pathSortBy, rangeQs, segmentQs],
    enabled: Boolean(websiteId) && useSegmentFilter && enabled,
    queryFn: () => {
      const sortQs = metricTab === 'path' ? `&sortBy=${pathSortBy}` : '';
      return api<MetricRow[]>(
        `/api/websites/${websiteId}/metrics?type=${metricTab}&${rangeQs}${segmentQs}${sortQs}`,
      );
    },
  });

  const rawRows = useSegmentFilter ? (metricsQuery.data ?? []) : (overviewQuery.data?.metrics ?? []);
  const rows = rawRows.map((row) => ({
    ...row,
    x: formatMetricLabel(metricTab, row.x),
  }));
  const isLoading = useSegmentFilter ? metricsQuery.isLoading : overviewQuery.isLoading;

  return { rows, isLoading };
}
