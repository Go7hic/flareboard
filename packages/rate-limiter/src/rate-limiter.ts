import { DurableObject } from 'cloudflare:workers';
import type { LockoutBody, LockoutResult, RateLimiterConsumeBody, RateLimitResult } from './types';

type WindowState = {
  windowId: number;
  count: number;
};

type LockoutState = {
  failures: number;
  lastFailureAt: number;
  lockedUntil: number;
};

export class RateLimiter extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (new URL(request.url).pathname === '/lockout') {
      const body = (await request.json().catch(() => null)) as LockoutBody | null;
      if (!body || !['check', 'fail', 'reset'].includes(body.op)) {
        return new Response('Invalid lockout request', { status: 400 });
      }
      return Response.json(await this.lockout(body));
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

  /**
   * Failure counter with exponential backoff: after `threshold` failures each further failure
   * locks for baseSec * 2^(failures - threshold), capped at maxSec. The state forgets itself
   * `resetAfterSec` after the last failure (an alarm deletes it), or at once on `reset`.
   */
  private async lockout(body: LockoutBody): Promise<LockoutResult> {
    const now = Date.now();
    if (body.op === 'reset') {
      await this.ctx.storage.deleteAll();
      return { locked: false, retryAfterSec: 0, failures: 0 };
    }

    let state = (await this.ctx.storage.get<LockoutState>('lockout')) ?? null;
    if (state && now - state.lastFailureAt > body.resetAfterSec * 1000 && state.lockedUntil <= now) state = null;

    if (body.op === 'fail') {
      const failures = (state?.failures ?? 0) + 1;
      const over = failures - body.threshold;
      const lockSec = over >= 0 ? Math.min(body.baseSec * 2 ** over, body.maxSec) : 0;
      state = { failures, lastFailureAt: now, lockedUntil: lockSec ? now + lockSec * 1000 : 0 };
      await this.ctx.storage.put('lockout', state);
      await this.ctx.storage.setAlarm(Math.max(state.lockedUntil, now) + body.resetAfterSec * 1000);
    }

    const lockedUntil = state?.lockedUntil ?? 0;
    return {
      locked: lockedUntil > now,
      retryAfterSec: lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0,
      failures: state?.failures ?? 0,
    };
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
