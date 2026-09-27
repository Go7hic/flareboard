import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type RealtimeData } from '../lib/api';
import { subscribeRealtimeStream } from '../lib/realtime-stream';

/** Fallback poll when SSE is unavailable. */
const REALTIME_POLL_MS = 2_000;
const SSE_RETRY_BASE_MS = 5_000;
const SSE_RETRY_MAX_MS = 60_000;

export function useRealtimeData(websiteId: string) {
  const [sseData, setSseData] = useState<RealtimeData | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [sseLoading, setSseLoading] = useState(true);

  useEffect(() => {
    setSseData(null);
    setSseConnected(false);
    setSseLoading(true);

    let stop: (() => void) | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;
    let disposed = false;

    // Streams end (Worker time limits, deploys, network blips). Polling covers the gap
    // while we reconnect with backoff; previously a dropped stream never came back.
    const connect = () => {
      stop = subscribeRealtimeStream(
        websiteId,
        (payload) => {
          attempt = 0;
          setSseData(payload);
          setSseConnected(true);
          setSseLoading(false);
        },
        () => {
          setSseConnected(false);
          setSseLoading(false);
          if (disposed) return;
          const delay = Math.min(SSE_RETRY_MAX_MS, SSE_RETRY_BASE_MS * 2 ** attempt);
          attempt += 1;
          retryTimer = window.setTimeout(connect, delay);
        },
      );
    };
    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      stop?.();
    };
  }, [websiteId]);

  const poll = useQuery({
    queryKey: ['realtime', websiteId],
    queryFn: () => api<RealtimeData>(`/api/realtime/${websiteId}`),
    refetchInterval: REALTIME_POLL_MS,
    enabled: !sseConnected,
  });

  const data = sseConnected ? sseData : poll.data;
  const isLoading = sseConnected ? sseLoading && !data : poll.isLoading;
  const error = sseConnected ? null : poll.error;
  const refetch = () => poll.refetch();

  return { data, isLoading, sseConnected, error, refetch };
}
