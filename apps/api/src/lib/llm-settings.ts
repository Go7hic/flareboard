import { normalizeModelId, type ModelPrice } from '@flareboard/shared';
import type { Env } from '../env';

/** Per-website LLM analytics settings (D1: llm_website_setting, llm_model_price). */

export type LlmPriceOverride = {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
};

export type LlmSettings = {
  captureContent: boolean;
  priceOverrides: LlmPriceOverride[];
};

/** Ingest caches the content setting under this KV key (apps/ingest/src/lib/llm-settings.ts). */
export function llmSettingsKey(websiteId: string) {
  return `llm-settings:${websiteId}`;
}

export async function listPriceOverrides(env: Env, websiteId: string): Promise<LlmPriceOverride[]> {
  const rows = await env.DB.prepare(
    `SELECT model, input_per_million AS inputPerMillion, output_per_million AS outputPerMillion,
            cache_read_per_million AS cacheReadPerMillion, cache_write_per_million AS cacheWritePerMillion
     FROM llm_model_price WHERE website_id = ?1 ORDER BY model`,
  )
    .bind(websiteId)
    .all<LlmPriceOverride>();
  return rows.results ?? [];
}

/** Overrides keyed by normalized model id, for `lookupModelPrice`. */
export async function loadPriceOverrides(env: Env, websiteId: string): Promise<Map<string, ModelPrice>> {
  const map = new Map<string, ModelPrice>();
  for (const row of await listPriceOverrides(env, websiteId)) {
    map.set(row.model, {
      input: row.inputPerMillion,
      output: row.outputPerMillion,
      cacheRead: row.cacheReadPerMillion ?? undefined,
      cacheWrite: row.cacheWritePerMillion ?? undefined,
    });
  }
  return map;
}

export async function getLlmSettings(env: Env, websiteId: string): Promise<LlmSettings> {
  const [row, priceOverrides] = await Promise.all([
    env.DB.prepare(`SELECT capture_content AS captureContent FROM llm_website_setting WHERE website_id = ?1`)
      .bind(websiteId)
      .first<{ captureContent: number }>(),
    listPriceOverrides(env, websiteId),
  ]);
  return { captureContent: row ? row.captureContent !== 0 : true, priceOverrides };
}

/**
 * Saves the given fields. `priceOverrides` replaces the whole list (model ids normalized, the
 * last entry for a model wins). Clears the ingest cache so a content change applies within a
 * minute (ingest also memoizes for 30 s per isolate).
 */
export async function saveLlmSettings(
  env: Env,
  websiteId: string,
  input: { captureContent?: boolean; priceOverrides?: Array<Omit<LlmPriceOverride, 'cacheReadPerMillion' | 'cacheWritePerMillion'> & {
    cacheReadPerMillion?: number | null;
    cacheWritePerMillion?: number | null;
  }> },
): Promise<LlmSettings> {
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  if (input.captureContent !== undefined) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO llm_website_setting (website_id, capture_content, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(website_id) DO UPDATE SET capture_content = excluded.capture_content, updated_at = excluded.updated_at`,
      ).bind(websiteId, input.captureContent ? 1 : 0, now),
    );
  }
  if (input.priceOverrides) {
    const byModel = new Map<string, LlmPriceOverride>();
    for (const item of input.priceOverrides) {
      const model = normalizeModelId(item.model);
      if (!model) continue;
      byModel.set(model, {
        model,
        inputPerMillion: item.inputPerMillion,
        outputPerMillion: item.outputPerMillion,
        cacheReadPerMillion: item.cacheReadPerMillion ?? null,
        cacheWritePerMillion: item.cacheWritePerMillion ?? null,
      });
    }
    statements.push(env.DB.prepare(`DELETE FROM llm_model_price WHERE website_id = ?1`).bind(websiteId));
    for (const price of byModel.values()) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO llm_model_price (website_id, model, input_per_million, output_per_million,
             cache_read_per_million, cache_write_per_million, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        ).bind(
          websiteId,
          price.model,
          price.inputPerMillion,
          price.outputPerMillion,
          price.cacheReadPerMillion,
          price.cacheWritePerMillion,
          now,
        ),
      );
    }
  }
  if (statements.length) await env.DB.batch(statements);
  if (input.captureContent !== undefined) await env.CACHE.delete(llmSettingsKey(websiteId));
  return getLlmSettings(env, websiteId);
}
