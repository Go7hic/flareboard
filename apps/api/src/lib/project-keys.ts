import { generateProjectKey, projectKeyCacheKey } from '@flareboard/shared';
import type { Env } from '../env';

export type ProjectKeyInfo = {
  key: string;
  createdAt: number;
  rotatedAt: number | null;
};

async function readProjectKey(env: Env, websiteId: string): Promise<ProjectKeyInfo | null> {
  return env.DB.prepare(
    `SELECT project_key AS key, created_at AS createdAt, rotated_at AS rotatedAt
     FROM website_project_key WHERE website_id = ?1`,
  )
    .bind(websiteId)
    .first<ProjectKeyInfo>();
}

/**
 * The website's public project key, created on first request. Concurrent first requests race on
 * the website_id primary key; the loser reads the winner's key.
 */
export async function getOrCreateProjectKey(env: Env, websiteId: string): Promise<ProjectKeyInfo> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await readProjectKey(env, websiteId);
    if (existing) return existing;
    await env.DB.prepare(
      `INSERT INTO website_project_key (website_id, project_key, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT DO NOTHING`,
    )
      .bind(websiteId, generateProjectKey(), Date.now())
      .run();
  }
  throw new Error('Could not create a project key');
}

/** Replaces the key. The old one stops resolving in ingest once its KV entry is gone (within a minute everywhere). */
export async function rotateProjectKey(env: Env, websiteId: string): Promise<ProjectKeyInfo> {
  const previous = await readProjectKey(env, websiteId);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO website_project_key (website_id, project_key, created_at, rotated_at) VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(website_id) DO UPDATE SET project_key = excluded.project_key, rotated_at = excluded.rotated_at`,
  )
    .bind(websiteId, generateProjectKey(), now)
    .run();
  if (previous) await env.CACHE.delete(projectKeyCacheKey(previous.key));
  const current = await readProjectKey(env, websiteId);
  if (!current) throw new Error('Project key rotation failed');
  return current;
}

/** Drops the cached key -> website mapping, e.g. when the website is deleted. */
export async function forgetProjectKey(env: Env, websiteId: string): Promise<void> {
  const current = await readProjectKey(env, websiteId);
  if (current) await env.CACHE.delete(projectKeyCacheKey(current.key));
}
