import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeErrorFingerprint, messageFingerprint, type QueueMessage } from '@flareboard/shared';
import type { Env } from '../src/env';
import { buildErrorEventDataPayload, reportPossibleRegression, resetRegressionReports } from '../src/lib/error-tracking';
import { fetchWorkerJson } from './helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';

const STACK = (hash: string) =>
  [
    "TypeError: Cannot read properties of undefined (reading 'price')",
    `    at lineTotal (https://shop.example.com/assets/cart-${hash}.js:1:2045)`,
    `    at renderCart (https://shop.example.com/assets/cart-${hash}.js:1:2311)`,
  ].join('\n');

describe('error event payload', () => {
  it('adds a stack fingerprint that survives redeploys', () => {
    const a = buildErrorEventDataPayload({ errorName: 'TypeError', message: 'x', stack: STACK('C3sPvF1q') });
    const b = buildErrorEventDataPayload({ errorName: 'TypeError', message: 'x', stack: STACK('Df0a9QeZ') });
    expect(a.$exception_fingerprint).toBe(computeErrorFingerprint({ type: 'TypeError', stack: STACK('C3sPvF1q') }).fingerprint);
    expect(b.$exception_fingerprint).toBe(a.$exception_fingerprint);
    expect(a).toMatchObject({ message: 'x', name: 'TypeError', severity: 'error', handled: false });
  });

  it('falls back to the normalized message and honours a custom fingerprint', () => {
    expect(buildErrorEventDataPayload({ message: 'Order 42 failed' }).$exception_fingerprint).toBe(
      messageFingerprint('Error', 'Order 7 failed'),
    );
    const custom = buildErrorEventDataPayload({ message: 'a', data: { $exception_fingerprint: 'checkout', plan: 'pro' } });
    expect(custom.$exception_fingerprint).toBe(computeErrorFingerprint({ custom: 'checkout' }).fingerprint);
    expect(custom).toMatchObject({ plan: 'pro' });
  });
});

describe('error ingest', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  beforeEach(() => resetRegressionReports());
  afterEach(() => vi.restoreAllMocks());

  function captureQueue() {
    const sent: QueueMessage[] = [];
    vi.spyOn(env.EVENT_QUEUE, 'send').mockImplementation(async (message: unknown) => {
      sent.push(message as QueueMessage);
    });
    vi.spyOn(env.EVENT_QUEUE, 'sendBatch').mockImplementation(async (messages: Iterable<MessageSendRequest<unknown>>) => {
      for (const message of messages) sent.push(message.body as QueueMessage);
    });
    return sent;
  }

  async function sendError(ip: string, timestamp?: number) {
    return fetchWorkerJson('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/126.0' },
      body: JSON.stringify({
        type: 'error',
        payload: {
          website: TEST_WEBSITE_ID,
          hostname: 'shop.example.com',
          url: '/cart',
          message: "Cannot read properties of undefined (reading 'price')",
          errorName: 'TypeError',
          stack: STACK('C3sPvF1q'),
          release: '2.0.0',
          ...(timestamp ? { timestamp } : {}),
        },
      }),
    });
  }

  it('stores $exception_fingerprint with the queued error event', async () => {
    const sent = captureQueue();
    const { response } = await sendError('198.51.100.10');
    expect(response.status).toBe(200);
    const event = sent.find((message) => message.type === 'event') as Extract<QueueMessage, { type: 'event' }>;
    const row = event.eventData?.find((item) => item.dataKey === '$exception_fingerprint');
    expect(row?.stringValue).toBe(computeErrorFingerprint({ type: 'TypeError', stack: STACK('C3sPvF1q') }).fingerprint);
  });

  it('keeps an error whose message or stack is too long, cut to the limit', async () => {
    const sent = captureQueue();
    const message = `Request failed: ${'x'.repeat(3000)}`;
    const { response } = await fetchWorkerJson('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.30', 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/126.0' },
      body: JSON.stringify({
        type: 'error',
        payload: { website: TEST_WEBSITE_ID, hostname: 'shop.example.com', url: '/cart', message, errorName: 'E'.repeat(300), stack: 'at a\n'.repeat(4000) },
      }),
    });
    expect(response.status).toBe(200);
    const queued = JSON.stringify(sent.find((item) => item.type === 'event'));
    expect(queued).toContain(message.slice(0, 1000));
    expect(queued).not.toContain(message.slice(0, 1001));
  });

  it('reports an occurrence of a resolved issue to the API once per minute', async () => {
    captureQueue();
    const fingerprint = computeErrorFingerprint({ type: 'TypeError', stack: STACK('C3sPvF1q') }).fingerprint;
    await env.CACHE.put(
      `error-resolved:${TEST_WEBSITE_ID}:${fingerprint}`,
      JSON.stringify({ issue: 'feedfacefeedface', resolvedAt: Date.now() - 60_000 }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ regressed: true }));
    const reports = () => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/api/internal/errors/regressions'));

    await sendError('198.51.100.11');
    await sendError('198.51.100.12');
    expect(reports()).toHaveLength(1);
    const [, init] = reports()[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${env.APP_SECRET}` });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      websiteId: TEST_WEBSITE_ID,
      fingerprint: 'feedfacefeedface',
      release: '2.0.0',
      severity: 'error',
    });
  });

  it('ignores occurrences from before the resolve and fingerprints that are not resolved', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ regressed: true }));
    const testEnv = env as unknown as Env;
    await env.CACHE.put(`error-resolved:${TEST_WEBSITE_ID}:0123456789abcdef`, JSON.stringify({ issue: '0123456789abcdef', resolvedAt: 5_000 }));
    const base = { websiteId: TEST_WEBSITE_ID, fingerprint: '0123456789abcdef', eventId: 'e1' };
    expect(await reportPossibleRegression(testEnv, { ...base, occurredAt: 4_000 })).toBe(false);
    expect(await reportPossibleRegression(testEnv, { ...base, fingerprint: 'fedcba9876543210', occurredAt: 6_000 })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    // A failed report is retried by the next event instead of waiting out the minute.
    fetchSpy.mockImplementationOnce(async () => new Response('down', { status: 503 }));
    expect(await reportPossibleRegression(testEnv, { ...base, occurredAt: 6_000 })).toBe(false);
    expect(await reportPossibleRegression(testEnv, { ...base, occurredAt: 6_001 })).toBe(true);
  });
});
