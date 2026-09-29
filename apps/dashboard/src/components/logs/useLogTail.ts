import { useEffect, useRef, useState } from 'react';
import { api, type LogEvent, type LogTailResponse } from '../../lib/api';

/** Lines kept on screen; older ones scroll away. */
export const TAIL_MAX_LINES = 1000;
const POLL_MS = 2000;

/**
 * Live tail: opens on the newest lines, then polls with the server's insertion-order cursor
 * (`seq`), so late exports appear and nothing is shown twice. Restarts when `filterQs` changes.
 */
export function useLogTail(websiteId: string | undefined, filterQs: string, active: boolean, paused: boolean) {
  const [lines, setLines] = useState<LogEvent[]>([]);
  const [error, setError] = useState<unknown>(null);
  const seqRef = useRef<string | null>(null);

  useEffect(() => {
    seqRef.current = null;
    setLines([]);
    setError(null);
  }, [websiteId, filterQs]);

  useEffect(() => {
    if (!websiteId || !active || paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const params = new URLSearchParams(filterQs);
      params.set('limit', '200');
      if (seqRef.current) params.set('seq', seqRef.current);
      try {
        const result = await api<LogTailResponse>(`/api/websites/${websiteId}/logs/tail?${params.toString()}`);
        if (cancelled) return;
        seqRef.current = result.seq;
        setError(null);
        if (result.logs.length) {
          setLines((previous) => {
            const seen = new Set(previous.map((line) => `${line.source}:${line.id}`));
            const fresh = result.logs.filter((line) => !seen.has(`${line.source}:${line.id}`));
            return [...previous, ...fresh].slice(-TAIL_MAX_LINES);
          });
        }
      } catch (caught) {
        if (!cancelled) setError(caught);
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [websiteId, filterQs, active, paused]);

  return { lines, error, clear: () => setLines([]) };
}
