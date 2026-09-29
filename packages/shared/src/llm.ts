/**
 * LLM analytics: the normalized AI event model, content limits and the model price table.
 *
 * Every AI call reaches storage as one `EVENT_TYPE.ai` event whose properties use the keys in
 * `AI_PROPS`, whether it came from the tracker / server API (`type: 'ai'`) or from a PostHog
 * `$ai_generation` / `$ai_span` / `$ai_trace` / `$ai_embedding` event.
 */

export const AI_EVENT_KINDS = ['generation', 'span', 'trace', 'embedding'] as const;
export type AiEventKind = (typeof AI_EVENT_KINDS)[number];

/** Property keys of an AI event. Legacy keys (model … environment) keep their original names. */
export const AI_PROPS = {
  kind: 'aiKind',
  provider: 'provider',
  model: 'model',
  inputTokens: 'inputTokens',
  outputTokens: 'outputTokens',
  totalTokens: 'totalTokens',
  cacheReadTokens: 'cacheReadTokens',
  cacheWriteTokens: 'cacheWriteTokens',
  reasoningTokens: 'reasoningTokens',
  /** Cost reported by the sender; when absent, cost is computed from the price table at query time. */
  costUsd: 'costUsd',
  latencyMs: 'latencyMs',
  status: 'status',
  httpStatus: 'httpStatus',
  error: 'aiError',
  traceId: 'traceId',
  spanId: 'spanId',
  parentId: 'parentSpanId',
  spanName: 'spanName',
  baseUrl: 'baseUrl',
  modelParams: 'aiModelParams',
  input: 'aiInput',
  output: 'aiOutput',
  /** `true` when the website does not store prompt/response content and this event had some. */
  contentOmitted: 'aiContentOmitted',
  quality: 'quality',
  release: 'release',
  environment: 'environment',
} as const;

/** Content keys: allowed up to AI_CONTENT_MAX_BYTES instead of the usual 2000 characters. */
export const AI_CONTENT_KEYS: ReadonlySet<string> = new Set([AI_PROPS.input, AI_PROPS.output]);

/** Stored size cap of each prompt / response payload (UTF-8 bytes, before the marker). */
export const AI_CONTENT_MAX_BYTES = 32 * 1024;
/** Upper bound on a stored content string, marker included (characters ≤ bytes). */
export const AI_CONTENT_MAX_STRING_LENGTH = AI_CONTENT_MAX_BYTES + 200;
export const AI_CONTENT_TRUNCATED_PREFIX = '\n…[truncated by Flareboard: ';

export function isAiEventKind(value: unknown): value is AiEventKind {
  return typeof value === 'string' && (AI_EVENT_KINDS as readonly string[]).includes(value);
}

/** True when a stored content string was cut by `serializeAiContent`. */
export function isTruncatedAiContent(value: string) {
  return value.includes(AI_CONTENT_TRUNCATED_PREFIX);
}

/**
 * Prompt / response content as a string: strings as-is, anything else as JSON. Payloads over
 * `maxBytes` (UTF-8) are cut at a character boundary and end with a marker giving the original
 * size. Returns undefined for empty or unserializable values.
 */
export function serializeAiContent(value: unknown, maxBytes = AI_CONTENT_MAX_BYTES): string | undefined {
  if (value == null) return undefined;
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      return undefined;
    }
  }
  if (!text) return undefined;
  const bytes = new TextEncoder().encode(text);
  let budget = maxBytes;
  for (;;) {
    let out = text;
    if (bytes.length > budget) {
      // A cut inside a multi-byte character decodes to U+FFFD; drop it.
      const kept = new TextDecoder().decode(bytes.subarray(0, budget)).replace(/�+$/, '');
      out = `${kept}${AI_CONTENT_TRUNCATED_PREFIX}${bytes.length} bytes, first ${budget} kept]`;
    }
    // Queue messages carry the value JSON-escaped: quote- or control-heavy content grows there,
    // so the escaped form is held to 1.25x the byte budget too.
    const escaped = JSON.stringify(out).length;
    if (escaped <= maxBytes * 1.25 || budget <= 1024) return out;
    budget = Math.max(1024, Math.floor((budget * maxBytes) / escaped));
  }
}

/**
 * The content properties of an AI event under the website's privacy setting: `aiInput` /
 * `aiOutput` when content is stored, otherwise only a flag saying some was left out.
 */
export function aiContentProperties(
  input: unknown,
  output: unknown,
  captureContent: boolean,
): Record<string, string | boolean> {
  const serializedInput = serializeAiContent(input);
  const serializedOutput = serializeAiContent(output);
  if (!serializedInput && !serializedOutput) return {};
  if (!captureContent) return { [AI_PROPS.contentOmitted]: true };
  const out: Record<string, string> = {};
  if (serializedInput) out[AI_PROPS.input] = serializedInput;
  if (serializedOutput) out[AI_PROPS.output] = serializedOutput;
  return out;
}

// ─── Prices ─────────────────────────────────────────────────────────────────────────────

/** USD per 1M tokens. `cacheRead` / `cacheWrite` are absent where the author was not sure. */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export type ModelPriceEntry = ModelPrice & {
  /** Canonical model id, lower case, as the provider's API names it. */
  model: string;
  /** Who publishes the price (the model's vendor, or the host for open-weight models). */
  provider: string;
  aliases?: readonly string[];
};

/**
 * Built-in list prices (standard tier, USD per 1M tokens), used when an event carries no cost of
 * its own and the website has no override for the model.
 *
 * Last reviewed: 2026-09-29.
 * - Anthropic: from Anthropic's model reference (current rates as of 2026-06; cache reads 0.1x
 *   and 5-minute cache writes 1.25x input unless listed otherwise).
 * - OpenAI, Google, Mistral, Groq, Together: published list prices as known to the author at the
 *   review date; models whose price the author was unsure of are left out (they show as
 *   "unpriced" and can be priced per website).
 * Tiered prices (long prompts on Gemini 1.5 / 2.5 Pro) use the base tier. Only exact model ids
 * (after stripping date suffixes and vendor prefixes) are matched: an unknown model is unpriced,
 * never guessed from a similar name.
 */
export const LLM_PRICES_REVIEWED_AT = '2026-09-29';

export const LLM_PRICE_TABLE: readonly ModelPriceEntry[] = [
  // Anthropic
  { provider: 'anthropic', model: 'claude-fable-5-1', input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { provider: 'anthropic', model: 'claude-fable-5', input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  { provider: 'anthropic', model: 'claude-mythos-5', input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  { provider: 'anthropic', model: 'claude-mythos-5-1', input: 10, output: 50 },
  { provider: 'anthropic', model: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { provider: 'anthropic', model: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { provider: 'anthropic', model: 'claude-opus-4-8', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { provider: 'anthropic', model: 'claude-opus-4-7', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { provider: 'anthropic', model: 'claude-opus-4-6', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { provider: 'anthropic', model: 'claude-opus-4-5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { provider: 'anthropic', model: 'claude-opus-4-1', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { provider: 'anthropic', model: 'claude-opus-4-0', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, aliases: ['claude-opus-4'] },
  { provider: 'anthropic', model: 'claude-3-opus', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { provider: 'anthropic', model: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: 'anthropic', model: 'claude-sonnet-4-5', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: 'anthropic', model: 'claude-sonnet-4-0', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, aliases: ['claude-sonnet-4'] },
  { provider: 'anthropic', model: 'claude-3-7-sonnet', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: 'anthropic', model: 'claude-3-5-sonnet', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { provider: 'anthropic', model: 'claude-3-sonnet', input: 3, output: 15 },
  { provider: 'anthropic', model: 'claude-haiku-4-5', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { provider: 'anthropic', model: 'claude-3-5-haiku', input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  { provider: 'anthropic', model: 'claude-3-haiku', input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },

  // OpenAI (cached input is billed at `cacheRead`; OpenAI has no cache-write charge)
  { provider: 'openai', model: 'gpt-5', input: 1.25, output: 10, cacheRead: 0.125 },
  { provider: 'openai', model: 'gpt-5-mini', input: 0.25, output: 2, cacheRead: 0.025 },
  { provider: 'openai', model: 'gpt-5-nano', input: 0.05, output: 0.4, cacheRead: 0.005 },
  { provider: 'openai', model: 'gpt-4.1', input: 2, output: 8, cacheRead: 0.5 },
  { provider: 'openai', model: 'gpt-4.1-mini', input: 0.4, output: 1.6, cacheRead: 0.1 },
  { provider: 'openai', model: 'gpt-4.1-nano', input: 0.1, output: 0.4, cacheRead: 0.025 },
  { provider: 'openai', model: 'gpt-4o', input: 2.5, output: 10, cacheRead: 1.25 },
  { provider: 'openai', model: 'gpt-4o-2024-05-13', input: 5, output: 15 },
  { provider: 'openai', model: 'gpt-4o-mini', input: 0.15, output: 0.6, cacheRead: 0.075 },
  { provider: 'openai', model: 'o1', input: 15, output: 60, cacheRead: 7.5 },
  { provider: 'openai', model: 'o1-mini', input: 1.1, output: 4.4, cacheRead: 0.55 },
  { provider: 'openai', model: 'o3', input: 2, output: 8, cacheRead: 0.5 },
  { provider: 'openai', model: 'o3-mini', input: 1.1, output: 4.4, cacheRead: 0.55 },
  { provider: 'openai', model: 'o4-mini', input: 1.1, output: 4.4, cacheRead: 0.275 },
  { provider: 'openai', model: 'gpt-4-turbo', input: 10, output: 30 },
  { provider: 'openai', model: 'gpt-4', input: 30, output: 60 },
  { provider: 'openai', model: 'gpt-3.5-turbo', input: 0.5, output: 1.5, aliases: ['gpt-3.5-turbo-0125'] },
  { provider: 'openai', model: 'text-embedding-3-small', input: 0.02, output: 0 },
  { provider: 'openai', model: 'text-embedding-3-large', input: 0.13, output: 0 },
  { provider: 'openai', model: 'text-embedding-ada-002', input: 0.1, output: 0 },

  // Google (Gemini API, text input, base prompt-size tier)
  { provider: 'google', model: 'gemini-2.5-pro', input: 1.25, output: 10 },
  { provider: 'google', model: 'gemini-2.5-flash', input: 0.3, output: 2.5 },
  { provider: 'google', model: 'gemini-2.5-flash-lite', input: 0.1, output: 0.4 },
  { provider: 'google', model: 'gemini-2.0-flash', input: 0.1, output: 0.4, cacheRead: 0.025 },
  { provider: 'google', model: 'gemini-2.0-flash-lite', input: 0.075, output: 0.3 },
  { provider: 'google', model: 'gemini-1.5-pro', input: 1.25, output: 5 },
  { provider: 'google', model: 'gemini-1.5-flash', input: 0.075, output: 0.3 },

  // Mistral
  { provider: 'mistral', model: 'mistral-large-latest', input: 2, output: 6, aliases: ['mistral-large-2411'] },
  { provider: 'mistral', model: 'mistral-medium-latest', input: 0.4, output: 2, aliases: ['mistral-medium-2505'] },
  { provider: 'mistral', model: 'mistral-small-latest', input: 0.1, output: 0.3 },
  { provider: 'mistral', model: 'codestral-latest', input: 0.3, output: 0.9 },
  { provider: 'mistral', model: 'open-mistral-nemo', input: 0.15, output: 0.15 },
  { provider: 'mistral', model: 'ministral-8b-latest', input: 0.1, output: 0.1 },
  { provider: 'mistral', model: 'ministral-3b-latest', input: 0.04, output: 0.04 },
  { provider: 'mistral', model: 'pixtral-large-latest', input: 2, output: 6 },
  { provider: 'mistral', model: 'mistral-embed', input: 0.1, output: 0 },

  // Meta Llama on common hosts (host-specific model ids)
  { provider: 'groq', model: 'llama-3.3-70b-versatile', input: 0.59, output: 0.79 },
  { provider: 'groq', model: 'llama-3.1-8b-instant', input: 0.05, output: 0.08 },
  { provider: 'together', model: 'meta-llama/llama-3.3-70b-instruct-turbo', input: 0.88, output: 0.88 },
  { provider: 'together', model: 'meta-llama/meta-llama-3.1-8b-instruct-turbo', input: 0.18, output: 0.18 },
  { provider: 'together', model: 'meta-llama/meta-llama-3.1-70b-instruct-turbo', input: 0.88, output: 0.88 },
  { provider: 'together', model: 'meta-llama/meta-llama-3.1-405b-instruct-turbo', input: 3.5, output: 3.5 },
];

const PRICE_INDEX: ReadonlyMap<string, ModelPriceEntry> = (() => {
  const index = new Map<string, ModelPriceEntry>();
  for (const entry of LLM_PRICE_TABLE) {
    index.set(entry.model, entry);
    for (const alias of entry.aliases ?? []) index.set(alias, entry);
  }
  return index;
})();

/** Vendor prefixes routers put in front of a model id (OpenRouter, LiteLLM, Gemini's `models/`). */
const VENDOR_PREFIX = /^(?:openai|anthropic|google|mistralai|mistral|models|gemini|vertex_ai|bedrock)\//;

/**
 * The model id in the form the price table uses: lower case, without router / Bedrock / Vertex
 * decorations (`anthropic/claude-3.5-sonnet`, `us.anthropic.claude-3-5-sonnet-20241022-v2:0`,
 * `claude-3-5-sonnet@20240620`, `models/gemini-1.5-pro`).
 */
export function normalizeModelId(model: string): string {
  let id = model.trim().toLowerCase();
  id = id.replace(VENDOR_PREFIX, '');
  id = id.replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '');
  id = id.replace(/@\d{8}$/, '');
  if (id.startsWith('claude-')) id = id.replace(/-v\d+(?::\d+)?$/, '').replace(/\./g, '-');
  return id;
}

/** Ids to look up, most specific first: as given, without a date suffix, without `-latest`. */
function candidateIds(model: string): string[] {
  const id = normalizeModelId(model);
  const out = [id];
  const undated = id.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '');
  if (undated !== id) out.push(undated);
  for (const candidate of [...out]) {
    if (candidate.endsWith('-latest')) out.push(candidate.slice(0, -'-latest'.length));
  }
  return out;
}

export type PriceSource = 'override' | 'builtin';

/**
 * Price of a model: the website's override first, then the built-in table, else null (unpriced).
 * `overrides` is keyed by `normalizeModelId(model)`.
 */
export function lookupModelPrice(
  model: string | null | undefined,
  overrides?: ReadonlyMap<string, ModelPrice>,
): { price: ModelPrice; source: PriceSource; model: string; provider?: string } | null {
  if (!model?.trim()) return null;
  const candidates = candidateIds(model);
  if (overrides?.size) {
    for (const id of candidates) {
      const price = overrides.get(id);
      if (price) return { price, source: 'override', model: id };
    }
  }
  for (const id of candidates) {
    const entry = PRICE_INDEX.get(id);
    if (entry) return { price: entry, source: 'builtin', model: entry.model, provider: entry.provider };
  }
  return null;
}

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Hosts that report Claude usage in OpenAI's shape (cached tokens inside the prompt count). */
const OPENAI_SHAPED_HOSTS = new Set(['openai', 'openrouter', 'litellm', 'azure']);

/**
 * Whether the reported input token count already includes cached tokens. OpenAI and Gemini count
 * cached tokens inside `prompt_tokens`; Anthropic's `input_tokens` (also on Bedrock and Vertex)
 * excludes cache reads and writes, which are reported separately.
 */
export function inputIncludesCache(provider: string | null | undefined, model: string | null | undefined) {
  const p = provider?.trim().toLowerCase() ?? '';
  if (p === 'anthropic') return false;
  if (!normalizeModelId(model ?? '').startsWith('claude-')) return true;
  return OPENAI_SHAPED_HOSTS.has(p);
}

/**
 * Cost in USD of one or more calls' usage at `price`. Cached tokens without a cache price are
 * charged at the input price (an upper bound).
 */
export function usageCostUsd(usage: LlmUsage, price: ModelPrice, cacheIncluded: boolean): number {
  const cacheRead = Math.max(0, usage.cacheReadTokens);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens);
  const regular = cacheIncluded ? Math.max(0, usage.inputTokens - cacheRead - cacheWrite) : Math.max(0, usage.inputTokens);
  const total =
    regular * price.input +
    cacheRead * (price.cacheRead ?? price.input) +
    cacheWrite * (price.cacheWrite ?? price.input) +
    Math.max(0, usage.outputTokens) * price.output;
  return total / 1_000_000;
}
