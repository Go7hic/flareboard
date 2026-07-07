import type { Env } from '../env';

export async function bumpActionDefinitionsVersion(env: Env, websiteId: string) {
  await env.CACHE.put(`action-definitions-version:${websiteId}`, String(Date.now()), {
    expirationTtl: 86_400,
  });
}
