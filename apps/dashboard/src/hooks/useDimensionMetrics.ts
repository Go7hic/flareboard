import { useQuery } from '@tanstack/react-query';
import { api, type MetricRow } from '../lib/api';

export type PathSortBy = 'views' | 'visitors' | 'time';

export function useDimensionMetrics({
  websiteId,
  type,
  qs,
  pathSortBy = 'views',
  limit = 5,
  enabled = true,
  metricsPathPrefix,
}: {
  websiteId: string | undefined;
  type: string;
  qs: string;
  pathSortBy?: PathSortBy;
  limit?: number;
  enabled?: boolean;
  metricsPathPrefix?: string;
}) {
  const prefix = metricsPathPrefix ?? (websiteId ? `/api/websites/${websiteId}` : '');
  return useQuery({
    queryKey: ['dimension-metrics', prefix, websiteId, type, pathSortBy, qs, limit],
    enabled: Boolean(prefix) && enabled,
    queryFn: () => {
      const sortQs = type === 'path' ? `&sortBy=${pathSortBy}` : '';
      return api<MetricRow[]>(`${prefix}/metrics?type=${type}&${qs}&limit=${limit}${sortQs}`);
    },
  });
}
