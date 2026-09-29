import type { Env } from '../env';

/** The API deletes this key when a website's LLM analytics settings change. */
export function llmSettingsKey(websiteId: string) {
  return `llm-settings:${websiteId}`;
}

type LlmSettings = { captureContent: boolean };

const KV_TTL_SECONDS = 300;
const MEMO_TTL_MS = 30_000;
const MEMO_MAX = 1000;
const memo = new Map<string, { expires: number; value: LlmSettings }>();

/** Test hook: forget the in-isolate copy so a changed setting is read again. */
export function forgetLlmSettings(websiteId?: string) {
  if (websiteId) memo.delete(websiteId);
  else memo.clear();
}

/**
 * Whether AI events of this website keep prompt / response content (`llm_website_setting`, no row
 * = yes). Read only for requests carrying AI content; cached in the isolate (30 s) and KV (5 min).
 */
export async function llmCaptureContent(env: Env, websiteId: string): Promise<boolean> {
  const now = Date.now();
  const hit = memo.get(websiteId);
  if (hit && hit.expires > now) return hit.value.captureContent;

  let value: LlmSettings | null = null;
  const cached = await env.CACHE.get(llmSettingsKey(websiteId));
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as Partial<LlmSettings>;
      if (typeof parsed.captureContent === 'boolean') value = { captureContent: parsed.captureContent };
    } catch {
      value = null;
    }
  }
  if (!value) {
    const row = await env.DB.prepare(`SELECT capture_content AS captureContent FROM llm_website_setting WHERE website_id = ?1`)
      .bind(websiteId)
      .first<{ captureContent: number }>();
    value = { captureContent: row ? row.captureContent !== 0 : true };
    await env.CACHE.put(llmSettingsKey(websiteId), JSON.stringify(value), { expirationTtl: KV_TTL_SECONDS });
  }

  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(websiteId, { expires: now + MEMO_TTL_MS, value });
  return value.captureContent;
}
