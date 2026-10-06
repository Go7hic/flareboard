import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import type { Env } from '../../src/env';
import { applyTestMigrations } from '../helpers/migrations';
import { createTestUser, testIp } from '../helpers/auth';

type Sent = { to: string | string[]; subject: string; text: string };

/** Flareboard Cloud in production (email verification on), with an inbox instead of real email. */
function hosted(options: { failSends?: boolean } = {}) {
  const sent: Sent[] = [];
  const overrides = {
    HOSTED_MODE: 'true',
    ENVIRONMENT: 'production',
    EMAIL: {
      async send(message: Sent) {
        if (options.failSends) throw new Error('send failed');
        sent.push(message);
      },
    },
  };
  async function post(path: string, body: unknown, ip = testIp()) {
    const request = new Request(`http://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, Origin: 'http://localhost:5173' },
      body: JSON.stringify(body),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, { ...(env as unknown as Env), ...overrides } as Env, ctx);
    await waitOnExecutionContext(ctx);
    return { status: response.status, body: ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown> };
  }
  /** The token of the newest verification or reset link sent to `to`. */
  function lastLink(to: string, kind: 'verify' | 'reset') {
    const message = sent.filter((item) => item.to === to).at(-1);
    const match = message?.text.match(new RegExp(`[?&]${kind}=([\\w-]+)`));
    return match?.[1] ?? null;
  }
  return { sent, post, lastLink };
}

describe('email verification on Flareboard Cloud', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
  });

  it('keeps the account usable when the first email fails, and a resent link signs it in', async () => {
    const email = 'lost-link@example.com';
    const failing = hosted({ failSends: true });
    const registered = await failing.post('/api/auth/register', { email, password: 'correct horse' });
    expect(registered.status).toBe(201);

    const app = hosted();
    const blocked = await app.post('/api/auth/login', { username: email, password: 'correct horse' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('email_unverified');

    const resent = await app.post('/api/auth/resend-verification', { email });
    expect(resent.status).toBe(200);
    const token = app.lastLink(email, 'verify');
    expect(token).toBeTruthy();
    const verified = await app.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    const signedIn = await app.post('/api/auth/login', { username: email, password: 'correct horse' });
    expect(signedIn.status).toBe(200);
  });

  it('answers the same for unknown and verified accounts, and sends them nothing', async () => {
    await createTestUser('done@example.com', 'correct horse', { email: 'done@example.com', verified: true });
    const app = hosted();
    const unknown = await app.post('/api/auth/resend-verification', { email: 'nobody@example.com' });
    const verified = await app.post('/api/auth/resend-verification', { email: 'done@example.com' });
    expect(unknown.status).toBe(200);
    expect(verified).toEqual(unknown);
    expect(app.sent).toHaveLength(0);
  });

  it('sends at most three links an hour to one account, from any number of addresses', async () => {
    const email = 'flood-target@example.com';
    await createTestUser(email, 'correct horse', { email });
    const app = hosted();
    for (let i = 0; i < 5; i++) {
      const response = await app.post('/api/auth/resend-verification', { email });
      expect(response.status).toBe(200);
    }
    expect(app.sent.filter((message) => message.to === email)).toHaveLength(3);
  });

  it('limits each client address', async () => {
    const app = hosted();
    const ip = testIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await app.post('/api/auth/resend-verification', { email: `ip-${i}@example.com` }, ip)).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it('counts a password reset as verifying the email it was sent to', async () => {
    const email = 'reset-verifies@example.com';
    await createTestUser(email, 'old password', { email });
    const app = hosted();
    expect((await app.post('/api/auth/forgot-password', { username: email })).status).toBe(200);
    const token = app.lastLink(email, 'reset');
    expect(token).toBeTruthy();
    expect((await app.post('/api/auth/reset-password', { token, password: 'new password' })).status).toBe(200);
    const signedIn = await app.post('/api/auth/login', { username: email, password: 'new password' });
    expect(signedIn.status).toBe(200);
  });
});
