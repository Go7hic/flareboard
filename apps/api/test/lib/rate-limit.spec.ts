import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { checkIpRateLimit, getTrustedClientIp } from '../../src/lib/rate-limit';

describe('getTrustedClientIp', () => {
  it('prefers cf-connecting-ip', () => {
    const req = new Request('http://example.com', {
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': '9.9.9.9',
      },
    });
    expect(getTrustedClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to the first x-forwarded-for hop', () => {
    const req = new Request('http://example.com', {
      headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' },
    });
    expect(getTrustedClientIp(req)).toBe('5.6.7.8');
  });

  it('defaults to localhost when no headers are present', () => {
    expect(getTrustedClientIp(new Request('http://example.com'))).toBe('127.0.0.1');
  });
});

describe('checkIpRateLimit', () => {
  it('allows requests under the limit and blocks after the limit', async () => {
    const ip = `test-${crypto.randomUUID()}`;

    const first = await checkIpRateLimit(env, 'unit', ip, 2, 60);
    const second = await checkIpRateLimit(env, 'unit', ip, 2, 60);
    const third = await checkIpRateLimit(env, 'unit', ip, 2, 60);

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('enforces the limit under concurrent requests', async () => {
    const ip = `concurrent-${crypto.randomUUID()}`;
    const limit = 5;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => checkIpRateLimit(env, 'concurrent', ip, limit, 60)),
    );
    expect(results.filter((result) => result.allowed).length).toBe(limit);
  });
});
