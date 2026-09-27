import type { Env } from '../env';

/** Host is ignored by service bindings; only the path reaches the API worker. */
const BINDING_ORIGIN = 'https://flareboard-api.internal';

/**
 * Call the API worker. Production uses the `API` service binding (in-network, never
 * challenged by WAF / bot rules on the public API host); local dev falls back to
 * `API_URL`. Returns null when neither is configured.
 */
export function fetchApi(env: Env, path: string, init: RequestInit): Promise<Response> | null {
  if (env.API) return env.API.fetch(`${BINDING_ORIGIN}${path}`, init);
  const apiUrl = env.API_URL?.trim();
  if (!apiUrl) return null;
  return fetch(`${apiUrl.replace(/\/$/, '')}${path}`, init);
}
