import { DurableObject } from 'cloudflare:workers';
import type { RateLimiterConsumeBody, RateLimitResult } from './types';

type WindowState = {
  windowId: number;
  count: number;
};

export class RateLimiter extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body: RateLimiterConsumeBody;
    try {
      body = (await request.json()) as RateLimiterConsumeBody;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const limit = Math.floor(body.limit);
    const windowSec = Math.floor(body.windowSec);
    if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowSec) || windowSec < 1) {
      return new Response('Invalid limit or windowSec', { status: 400 });
    }

    const result = await this.consume(limit, windowSec);
    return Response.json(result);
  }

  private async consume(limit: number, windowSec: number): Promise<RateLimitResult> {
    const windowId = Math.floor(Date.now() / 1000 / windowSec);
    const stored = (await this.ctx.storage.get<WindowState>('window')) ?? { windowId, count: 0 };

    if (stored.windowId !== windowId) {
      stored.windowId = windowId;
      stored.count = 0;
    }

    if (stored.count >= limit) {
      return { allowed: false, remaining: 0 };
    }

    stored.count += 1;
    await this.ctx.storage.put('window', stored);
    return { allowed: true, remaining: limit - stored.count };
  }
}
