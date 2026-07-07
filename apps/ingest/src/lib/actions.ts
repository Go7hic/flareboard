import {
  actionMatchContextFromEvent,
  matchActionDefinitions,
  type ActionDefinitionLike,
  type ActionRule,
} from '@flareboard/shared';
import type { Env } from '../env';

type CachedActions = {
  loadedAt: number;
  definitions: ActionDefinitionLike[];
};

const CACHE_TTL_MS = 10_000;
const MAX_ACTION_DEFINITIONS = 500;
const actionCache = new Map<string, CachedActions>();

async function getActionDefinitionsVersion(env: Env, websiteId: string) {
  return (await env.CACHE.get(`action-definitions-version:${websiteId}`)) ?? '0';
}

export async function loadWebsiteActionDefinitions(env: Env, websiteId: string) {
  const version = await getActionDefinitionsVersion(env, websiteId);
  const cacheKey = `${websiteId}:${version}`;
  const cached = actionCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) return cached.definitions;

  const rows = await env.DB.prepare(
    `SELECT action_id as id, name, rules
     FROM action_definition
     WHERE website_id = ?1
     ORDER BY created_at ASC
     LIMIT ?2`,
  )
    .bind(websiteId, MAX_ACTION_DEFINITIONS)
    .all<{ id: string; name: string; rules: string | ActionRule[] }>();

  const definitions = (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    rules: typeof row.rules === 'string' ? (JSON.parse(row.rules) as ActionRule[]) : row.rules,
  }));

  actionCache.set(cacheKey, { loadedAt: now, definitions });
  return definitions;
}

export async function appendMatchedActionTags(
  env: Env,
  websiteId: string,
  input: {
    eventName?: string | null;
    urlPath?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const data = { ...(input.data ?? {}) };
  const definitions = await loadWebsiteActionDefinitions(env, websiteId);
  if (!definitions.length) return data;

  const matched = matchActionDefinitions(definitions, actionMatchContextFromEvent(input));
  if (!matched.length) return data;

  data.$flareboard_action_ids = matched.map((row) => row.id).join(',');
  data.$flareboard_action_names = matched.map((row) => row.name).join(',');
  return data;
}

export function clearWebsiteActionCache(websiteId?: string) {
  if (websiteId) actionCache.delete(websiteId);
  else actionCache.clear();
}
