import { describe, expect, it } from 'vitest';
import { decodeBase64Utf8, readPostHogBody } from '../../src/lib/posthog/body';
import {
  clientInfo,
  eventProperties,
  exceptionPayload,
  extractPostHogRequest,
  normalizePostHogEvent,
  resolveEventTime,
} from '../../src/lib/posthog/events';
import { flagsResponse } from '../../src/lib/posthog/decide';

const NOW = Date.UTC(2026, 8, 28, 12);

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function b64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe('PostHog body decoding', () => {
  const payload = { event: 'signup', distinct_id: 'u1', properties: { plan: 'pro ✓' } };

  it('reads JSON, gzip (query, header or bare) and base64 forms', async () => {
    const json = JSON.stringify(payload);
    const bodies: Request[] = [
      new Request('http://x/e/', { method: 'POST', body: json }),
      new Request('http://x/e/?compression=gzip-js', { method: 'POST', body: await gzip(json) }),
      new Request('http://x/e/', { method: 'POST', headers: { 'Content-Encoding': 'gzip' }, body: await gzip(json) }),
      new Request('http://x/e/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: await gzip(json) }),
      new Request('http://x/e/?compression=base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(b64(json))}`,
      }),
      // Unencoded "+" arrives as a space after form decoding.
      new Request('http://x/e/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${b64(json)}`,
      }),
    ];
    for (const req of bodies) expect(await readPostHogBody(req)).toEqual(payload);
  });

  it('rejects lz64, broken gzip and oversized payloads', async () => {
    await expect(readPostHogBody(new Request('http://x/e/?compression=lz64', { method: 'POST', body: 'x' }))).rejects.toMatchObject({ status: 400 });
    await expect(
      readPostHogBody(new Request('http://x/e/?compression=gzip-js', { method: 'POST', body: new Uint8Array([0x1f, 0x8b, 1, 2, 3]) })),
    ).rejects.toMatchObject({ status: 400 });
    // A gzip bomb: 9 MB of zeros compresses to a few KB.
    const bomb = await gzip(`"${'0'.repeat(9 * 1024 * 1024)}"`);
    await expect(readPostHogBody(new Request('http://x/e/', { method: 'POST', body: bomb }))).rejects.toMatchObject({ status: 413 });
    // The same bomb with a forged size trailer is stopped while streaming.
    const liar = bomb.slice();
    liar.set([10, 0, 0, 0], liar.length - 4);
    await expect(readPostHogBody(new Request('http://x/e/', { method: 'POST', body: liar }))).rejects.toMatchObject({ status: 413 });
  });

  it('decodes URL-safe base64 without padding', () => {
    expect(decodeBase64Utf8(b64('{"a":"??>"}').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'))).toBe('{"a":"??>"}');
  });
});

describe('PostHog request shapes', () => {
  const url = new URL('http://x/batch/');

  it('reads the token and sent_at from batches, arrays and single events', () => {
    expect(extractPostHogRequest({ api_key: 'k', batch: [{ event: 'a' }], sent_at: '2026-09-28T12:00:00.000Z' }, url)).toEqual({
      token: 'k',
      sentAt: NOW,
      events: [{ event: 'a' }],
    });
    expect(extractPostHogRequest([{ event: 'a', properties: { token: 'k2' } }], new URL('http://x/e/?_=1790000000000'))).toMatchObject({
      token: 'k2',
      sentAt: 1790000000000,
    });
    expect(extractPostHogRequest({ event: 'a', api_key: 'k3' }, url)).toMatchObject({ token: 'k3', events: [{ event: 'a' }] });
  });

  it('requires an event name and a distinct id, and merges top-level and property $set', () => {
    expect(normalizePostHogEvent({ event: 'x' })).toBeNull();
    expect(normalizePostHogEvent({ distinct_id: 'u' })).toBeNull();
    expect(normalizePostHogEvent({ event: 'x', distinct_id: 'u'.repeat(201) })).toBeNull();
    expect(
      normalizePostHogEvent({ event: 'x', properties: { distinct_id: 'u', $set: { a: 1 } }, $set: { b: 2 }, $set_once: { c: 3 } }),
    ).toMatchObject({ distinctId: 'u', set: { a: 1, b: 2 }, setOnce: { c: 3 } });
  });
});

describe('PostHog timestamps', () => {
  const props = {};

  it('corrects client clock skew with sent_at', () => {
    // Client clock runs an hour fast; the event happened 10 s before it was sent.
    const clientSent = NOW + 3_600_000;
    const at = resolveEventTime({ timestamp: new Date(clientSent - 10_000).toISOString(), properties: props }, clientSent, NOW);
    expect(at.getTime()).toBe(NOW - 10_000);
  });

  it('uses the timestamp as is without sent_at, and offset without a timestamp', () => {
    expect(resolveEventTime({ timestamp: NOW - 60_000, properties: props }, null, NOW).getTime()).toBe(NOW - 60_000);
    expect(resolveEventTime({ offset: 5000, properties: props }, null, NOW).getTime()).toBe(NOW - 5000);
    expect(resolveEventTime({ properties: props }, null, NOW).getTime()).toBe(NOW);
  });

  it('falls back to server time outside the accepted window', () => {
    const yearAgo = new Date(NOW - 365 * 86_400_000).toISOString();
    expect(resolveEventTime({ timestamp: yearAgo, properties: props }, null, NOW).getTime()).toBe(NOW);
    expect(resolveEventTime({ timestamp: NOW + 3_600_000, properties: props }, null, NOW).getTime()).toBe(NOW);
  });
});

describe('PostHog property mapping', () => {
  it('prefers PostHog client properties and normalizes their names', () => {
    expect(
      clientInfo(
        {
          $browser: 'Mobile Safari',
          $os: 'Mac OS X',
          $device_type: 'Mobile',
          $screen_width: 390,
          $screen_height: 844,
          $browser_language: 'de-DE',
        },
        'posthog-node/4.0.0',
      ),
    ).toMatchObject({ browser: 'Safari', os: 'macOS', device: 'mobile', screen: '390x844', language: 'de-DE' });
  });

  it('falls back to the user agent, but never a server SDK user agent', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
    expect(clientInfo({}, ua)).toMatchObject({ browser: 'Chrome', os: 'Windows', device: 'desktop' });
    expect(clientInfo({ $raw_user_agent: ua }, 'posthog-python/3.0')).toMatchObject({ browser: 'Chrome' });
    expect(clientInfo({}, 'posthog-python/3.0')).toMatchObject({ browser: null, os: null, device: null });
  });

  it('keeps customer properties first and drops IPs, tokens and SDK internals', () => {
    const properties = eventProperties({
      event: 'x',
      distinctId: 'u',
      properties: {
        $ip: '203.0.113.1',
        token: 'fb_pk_x',
        $window_id: 'w',
        $lib: 'web',
        '$feature/new-ui': 'test',
        plan: 'pro',
        nested: { a: 1 },
        utm_source: 'news',
      },
    });
    expect(properties).toEqual({ plan: 'pro', $lib: 'web', '$feature/new-ui': 'test' });
  });

  it('maps $exception_list to the error payload', () => {
    const payload = exceptionPayload({
      $exception_level: 'fatal',
      $exception_list: [
        {
          type: 'TypeError',
          value: 'x is undefined',
          mechanism: { handled: false },
          stacktrace: {
            frames: [
              { filename: 'app.js', function: 'main', lineno: 1, colno: 1 },
              { filename: 'checkout.js', function: 'pay', lineno: 42, colno: 7 },
            ],
          },
        },
      ],
    });
    expect(payload).toMatchObject({
      message: 'x is undefined',
      name: 'TypeError',
      source: 'checkout.js',
      lineno: 42,
      colno: 7,
      severity: 'fatal',
      handled: false,
    });
    expect(payload.stack?.split('\n')).toEqual(['TypeError: x is undefined', '    at pay (checkout.js:42:7)', '    at main (app.js:1:1)']);
  });
});

describe('flags response', () => {
  it('reports booleans without variants and payloads only for enabled flags', () => {
    const response = flagsResponse([
      { key: 'on', flagId: 'f1', multivariate: false, evaluation: { key: 'on', enabled: true, matched: true, variant: 'test', reason: 'match' }, payload: { a: 1 } },
      { key: 'ab', flagId: 'f2', multivariate: true, evaluation: { key: 'ab', enabled: true, matched: true, variant: 'blue', reason: 'match' } },
      { key: 'off', flagId: 'f3', multivariate: true, evaluation: { key: 'off', enabled: false, matched: true, variant: 'control', reason: 'rollout_miss' }, payload: 'x' },
    ]);
    expect(response.featureFlags).toEqual({ on: true, ab: 'blue', off: false });
    expect(response.featureFlagPayloads).toEqual({ on: '{"a":1}' });
    expect(JSON.parse(JSON.stringify(response.flags))).toEqual({
      on: { key: 'on', enabled: true, reason: { code: 'condition_match', description: 'Matched conditions' }, metadata: { id: 'f1', payload: '{"a":1}' } },
      ab: { key: 'ab', enabled: true, variant: 'blue', reason: { code: 'condition_match', description: 'Matched conditions' }, metadata: { id: 'f2' } },
      off: { key: 'off', enabled: false, reason: { code: 'out_of_rollout_bound', description: 'Out of rollout bound' }, metadata: { id: 'f3' } },
    });
    expect(response.hasFeatureFlags).toBe(true);
    expect(response.errorsWhileComputingFlags).toBe(false);
  });
});
