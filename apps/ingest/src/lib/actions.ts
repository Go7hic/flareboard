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
const MAX_CACHE_ENTRIES = 500;
const actionCache = new Map<string, CachedActions>();

function setActionCache(websiteId: string, cacheKey: string, value: CachedActions) {
  // Drop stale version entries for the same website so old versions don't accumulate.
  for (const key of actionCache.keys()) {
    if (key !== cacheKey && key.startsWith(`${websiteId}:`)) actionCache.delete(key);
  }
  actionCache.set(cacheKey, value);
  // Evict oldest entries (Map preserves insertion order) to bound memory.
  while (actionCache.size > MAX_CACHE_ENTRIES) {
    const oldest = actionCache.keys().next().value;
    if (oldest === undefined) break;
    actionCache.delete(oldest);
  }
}

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

  const definitions: ActionDefinitionLike[] = [];
  for (const row of rows.results ?? []) {
    let rules: ActionRule[];
    if (typeof row.rules === 'string') {
      try {
        rules = JSON.parse(row.rules) as ActionRule[];
      } catch {
        // Skip definitions with corrupt rules instead of failing event ingestion.
        continue;
      }
    } else {
      rules = row.rules;
    }
    if (!Array.isArray(rules)) continue;
    definitions.push({ id: row.id, name: row.name, rules });
  }

  setActionCache(websiteId, cacheKey, { loadedAt: now, definitions });
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
  if (!websiteId) {
    actionCache.clear();
    return;
  }
  for (const key of actionCache.keys()) {
    if (key.startsWith(`${websiteId}:`)) actionCache.delete(key);
  }
}
