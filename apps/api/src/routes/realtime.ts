import type { Context } from 'hono';
import type { Env } from '../env';
import { getRealtime } from '../lib/queries';
import { requireWebsiteOr404 } from '../lib/website';
import { json } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const DATA_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function handleGet(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const data = await getRealtime(c.env, website!.websiteId);
  return json(data);
}

/** SSE stream: JSON `data:` events every ~1s, `: ping` heartbeat every 30s. */
export async function handleStream(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;

  const websiteId = website!.websiteId;
  const env = c.env;
  const encoder = new TextEncoder();

  let dataIv: ReturnType<typeof setInterval> | undefined;
  let hbIv: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (dataIv) clearInterval(dataIv);
        if (hbIv) clearInterval(hbIv);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const enqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };

      let pushInFlight = false;

      const push = async () => {
        if (closed || pushInFlight) return;
        pushInFlight = true;
        try {
          const data = await getRealtime(env, websiteId);
          enqueue(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          close();
        } finally {
          pushInFlight = false;
        }
      };

      void push();
      dataIv = setInterval(() => void push(), DATA_INTERVAL_MS);
      hbIv = setInterval(() => enqueue(': ping\n\n'), HEARTBEAT_INTERVAL_MS);
      c.req.raw.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (closed) return;
      closed = true;
      if (dataIv) clearInterval(dataIv);
      if (hbIv) clearInterval(hbIv);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
