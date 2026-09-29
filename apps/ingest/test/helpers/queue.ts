import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import type { QueueMessage } from '@flareboard/shared';
import worker from '../../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/** An EVENT_QUEUE stand-in that keeps every message the worker sends. */
export function recordingQueue() {
  const messages: QueueMessage[] = [];
  const queue = {
    async send(message: QueueMessage) {
      messages.push(structuredClone(message));
    },
    async sendBatch(batch: Iterable<{ body: QueueMessage }>) {
      const items = [...batch];
      if (items.length > 100) throw new Error('Queues accept at most 100 messages per batch');
      for (const item of items) messages.push(structuredClone(item.body));
    },
  };
  return {
    queue,
    messages,
    events: () => messages.filter((m): m is Extract<QueueMessage, { type: 'event' }> => m.type === 'event'),
    sessions: () => messages.filter((m): m is Extract<QueueMessage, { type: 'session' }> => m.type === 'session'),
    sessionData: () =>
      messages.filter((m): m is Extract<QueueMessage, { type: 'session_data' }> => m.type === 'session_data'),
  };
}

/** Like fetchWorker, with bindings replaced (a recording queue, a lower rate limit, …). */
export async function fetchWorkerWithEnv(path: string, init: RequestInit | undefined, overrides: Record<string, unknown>) {
  const request = new IncomingRequest(`http://example.com${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, ...overrides } as typeof env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** Gives a seeded website a known project key. */
export async function seedProjectKey(db: D1Database, websiteId: string, key: string) {
  await db
    .prepare(
      `INSERT INTO website_project_key (website_id, project_key, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(website_id) DO UPDATE SET project_key = excluded.project_key`,
    )
    .bind(websiteId, key, Date.now())
    .run();
}
