import { describe, expect, it } from 'vitest';
import { getCorsOrigins, resolveCorsOrigin } from '../../src/lib/cors';
import type { Env } from '../../src/env';

function envWithCors(extra?: string): Env {
  return {
    CORS_ORIGINS: extra,
  } as Env;
}

describe('getCorsOrigins', () => {
  it('includes local dev origins by default', () => {
    const origins = getCorsOrigins(envWithCors());
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://127.0.0.1:5173');
  });

  it('merges comma-separated CORS_ORIGINS', () => {
    const origins = getCorsOrigins(envWithCors('https://app.example.com, https://staging.example.com'));
    expect(origins).toContain('https://app.example.com');
    expect(origins).toContain('https://staging.example.com');
  });

  it('deduplicates origins', () => {
    const origins = getCorsOrigins(envWithCors('http://localhost:5173'));
    expect(origins.filter((o) => o === 'http://localhost:5173')).toHaveLength(1);
  });

  it('omits local dev origins in production', () => {
    const origins = getCorsOrigins({
      ENVIRONMENT: 'production',
      DASHBOARD_URL: 'https://flareboard.dev',
      CORS_ORIGINS: 'https://flareboard.dev',
    } as Env);
    expect(origins).not.toContain('http://localhost:5173');
    expect(origins).toContain('https://flareboard.dev');
  });
});

describe('resolveCorsOrigin', () => {
  it('returns null when request has no Origin header', () => {
    expect(resolveCorsOrigin(envWithCors('https://app.example.com'), undefined)).toBeNull();
  });

  it('returns the origin when it is allowed', () => {
    expect(resolveCorsOrigin(envWithCors('https://app.example.com'), 'https://app.example.com')).toBe(
      'https://app.example.com',
    );
  });

  it('returns null for disallowed origins', () => {
    expect(resolveCorsOrigin(envWithCors('https://app.example.com'), 'https://evil.example.com')).toBeNull();
  });
});
