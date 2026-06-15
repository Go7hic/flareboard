import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export async function fetchWorker(path: string, init?: RequestInit) {
  const request = new IncomingRequest(`http://example.com${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export async function fetchWorkerJson<T>(path: string, init?: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await fetchWorker(path, init);
  const body = (await response.json()) as T;
  return { response, body };
}
