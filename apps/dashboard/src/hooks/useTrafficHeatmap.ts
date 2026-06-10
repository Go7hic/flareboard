import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export type TrafficHeatmapCell = { dow: number; hour: number; count: number };
export type TrafficHeatmapData = { cells: TrafficHeatmapCell[]; max: number };

export function useTrafficHeatmap({
  websiteId,
  qs,
  enabled = true,
}: {
  websiteId: string | undefined;
  qs: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['traffic-heatmap', websiteId, qs],
    enabled: Boolean(websiteId) && enabled,
    queryFn: () =>
      api<TrafficHeatmapData>(
        `/api/websites/${websiteId}/metrics?type=heatmap&${qs}`,
      ),
  });
}
