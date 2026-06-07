import { authenticatedFetch, type RealtimeData } from './api';

const DATA_PREFIX = 'data: ';

function parseSseBuffer(buffer: string): { events: RealtimeData[]; remainder: string } {
  const events: RealtimeData[] = [];
  const blocks = buffer.split('\n\n');
  const remainder = blocks.pop() ?? '';
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      if (!line.startsWith(DATA_PREFIX)) continue;
      try {
        events.push(JSON.parse(line.slice(DATA_PREFIX.length)) as RealtimeData);
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
  return { events, remainder };
}

/**
 * Subscribe to realtime SSE with Bearer auth (fetch + ReadableStream).
 * Returns abort cleanup; calls onError when the stream ends or fails.
 */
export function subscribeRealtimeStream(
  websiteId: string,
  onData: (data: RealtimeData) => void,
  onError?: () => void,
): () => void {
  const ac = new AbortController();

  (async () => {
    try {
      const path = `/api/websites/${encodeURIComponent(websiteId)}/realtime/stream`;
      const res = await authenticatedFetch(path, { signal: ac.signal });
      if (!res.ok || !res.body) {
        onError?.();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseBuffer(buffer);
        buffer = remainder;
        for (const evt of events) onData(evt);
      }
      if (!ac.signal.aborted) onError?.();
    } catch {
      if (!ac.signal.aborted) onError?.();
    }
  })();

  return () => ac.abort();
}
