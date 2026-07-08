import { describe, expect, it } from 'vitest';
import { csrfOriginAllowed } from '../../src/lib/csrf';
import type { Env } from '../../src/env';

function mockContext(input: {
  method: string;
  origin?: string;
  referer?: string;
  bearer?: string;
  env?: Partial<Env>;
}) {
  const headers: Record<string, string> = {};
  if (input.origin) headers.Origin = input.origin;
  if (input.referer) headers.Referer = input.referer;
  if (input.bearer) headers.Authorization = `Bearer ${input.bearer}`;
  return {
    req: {
      method: input.method,
      header(name: string) {
        return headers[name];
      },
    },
    env: {
      ENVIRONMENT: 'production',
      DASHBOARD_URL: 'https://flareboard.dev',
      CORS_ORIGINS: 'https://flareboard.dev',
      ...input.env,
    } as Env,
  };
}

describe('csrfOriginAllowed', () => {
  it('allows bearer-authenticated mutating requests without Origin', () => {
    const ctx = mockContext({ method: 'POST', bearer: 'token' });
    expect(csrfOriginAllowed(ctx)).toBe(true);
  });

  it('rejects cookie-authenticated POST without Origin', () => {
    const ctx = mockContext({ method: 'POST' });
    expect(csrfOriginAllowed(ctx)).toBe(false);
  });

  it('allows cookie-authenticated POST from an allowed origin', () => {
    const ctx = mockContext({ method: 'POST', origin: 'https://flareboard.dev' });
    expect(csrfOriginAllowed(ctx)).toBe(true);
  });

  it('allows GET without Origin', () => {
    const ctx = mockContext({ method: 'GET' });
    expect(csrfOriginAllowed(ctx)).toBe(true);
  });
});
