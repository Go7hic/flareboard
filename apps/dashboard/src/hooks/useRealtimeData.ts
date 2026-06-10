import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type RealtimeData } from '../lib/api';
import { subscribeRealtimeStream } from '../lib/realtime-stream';

/** Fallback poll when SSE is unavailable. */
const REALTIME_POLL_MS = 2_000;

export function useRealtimeData(websiteId: string) {
  const [sseData, setSseData] = useState<RealtimeData | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [sseLoading, setSseLoading] = useState(true);

  useEffect(() => {
    setSseData(null);
    setSseConnected(false);
    setSseLoading(true);

    const stop = subscribeRealtimeStream(
      websiteId,
      (payload) => {
        setSseData(payload);
        setSseConnected(true);
        setSseLoading(false);
      },
      () => {
        setSseConnected(false);
        setSseLoading(false);
      },
    );

    return stop;
  }, [websiteId]);

  const poll = useQuery({
    queryKey: ['realtime', websiteId],
    queryFn: () => api<RealtimeData>(`/api/realtime/${websiteId}`),
    refetchInterval: REALTIME_POLL_MS,
    enabled: !sseConnected,
  });

  const data = sseConnected ? sseData : poll.data;
  const isLoading = sseConnected ? sseLoading && !data : poll.isLoading;

  return { data, isLoading, sseConnected };
}
