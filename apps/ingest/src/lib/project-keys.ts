import { isProjectKey, projectKeyCacheKey } from '@flareboard/shared';
import type { Env } from '../env';

/** Short enough that a key of a website deleted outside the API's delete route stops working soon. */
const FOUND_TTL_SEC = 15 * 60;
/** Unknown keys are remembered briefly so random keys cannot hammer D1. */
const MISSING_TTL_SEC = 5 * 60;
const MISSING = '-';

/**
 * Website id for a public project key (`fb_pk_…`), cached in KV. The API deletes the entry on
 * rotation and website deletion (see apps/api/src/lib/project-keys.ts).
 */
export async function resolveProjectKey(env: Env, key: string): Promise<string | null> {
  if (!isProjectKey(key)) return null;
  const cacheKey = projectKeyCacheKey(key);
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return cached === MISSING ? null : cached;

  const row = await env.DB.prepare(
    `SELECT k.website_id AS websiteId
     FROM website_project_key k
     JOIN website w ON w.website_id = k.website_id
     WHERE k.project_key = ?1 AND w.deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(key)
    .first<{ websiteId: string }>();
  const websiteId = row?.websiteId ?? null;
  await env.CACHE.put(cacheKey, websiteId ?? MISSING, {
    expirationTtl: websiteId ? FOUND_TTL_SEC : MISSING_TTL_SEC,
  });
  return websiteId;
}

export type WebsiteRef = {
  websiteId: string;
  /** Set when the caller identified the website by its project key (rate limited per key). */
  projectKey?: string;
};

/**
 * Ingest accepts a project key wherever it accepts a website id. Returns the website id to use,
 * `null` for a project key that does not resolve, and non-key values unchanged.
 */
export async function resolveWebsiteRef(env: Env, value: string): Promise<WebsiteRef | null> {
  if (!isProjectKey(value)) return { websiteId: value };
  const websiteId = await resolveProjectKey(env, value);
  return websiteId ? { websiteId, projectKey: value } : null;
}
