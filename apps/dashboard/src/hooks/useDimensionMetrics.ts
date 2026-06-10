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
}: {
  websiteId: string | undefined;
  type: string;
  qs: string;
  pathSortBy?: PathSortBy;
  limit?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['dimension-metrics', websiteId, type, pathSortBy, qs, limit],
    enabled: Boolean(websiteId) && enabled,
    queryFn: () => {
      const sortQs = type === 'path' ? `&sortBy=${pathSortBy}` : '';
      return api<MetricRow[]>(
        `/api/websites/${websiteId}/metrics?type=${type}&${qs}&limit=${limit}${sortQs}`,
      );
    },
  });
}
