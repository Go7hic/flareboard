import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/env';
import { fetchApi } from '../../src/lib/api-client';

const init: RequestInit = { method: 'POST', body: '{}' };

function envWith(overrides: Partial<Env>) {
  return overrides as Env;
}

describe('fetchApi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefers the API service binding over API_URL and never touches the public network', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const bindingFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const env = envWith({ API: { fetch: bindingFetch } as unknown as Fetcher, API_URL: 'https://api.example.com' });

    const response = await fetchApi(env, '/api/internal/errors/regressions', init);

    expect(response?.status).toBe(204);
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    const [url, passedInit] = bindingFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/internal/errors/regressions');
    expect(passedInit).toBe(init);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('falls back to API_URL (trailing slash trimmed) without a binding', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    await fetchApi(envWith({ API_URL: ' http://localhost:8788/ ' }), '/api/internal/errors/regressions', init);

    expect(globalFetch).toHaveBeenCalledWith('http://localhost:8788/api/internal/errors/regressions', init);
  });

  it('returns null when neither a binding nor API_URL is configured', () => {
    expect(fetchApi(envWith({ API_URL: '  ' }), '/api/internal/errors/regressions', init)).toBeNull();
  });
});
