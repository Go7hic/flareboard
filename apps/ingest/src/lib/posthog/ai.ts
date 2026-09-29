import { AI_PROPS, aiContentProperties, type AiEventKind } from '@flareboard/shared';

/**
 * PostHog LLM analytics events (`$ai_generation`, `$ai_span`, `$ai_trace`, `$ai_embedding`, as
 * sent by the posthog-node / posthog-python LLM wrappers, LangChain callbacks and the capture
 * API) mapped onto Flareboard's AI event model (`AI_PROPS`). Pure: no I/O.
 */

type Json = Record<string, unknown>;

const AI_EVENT_KIND: Record<string, AiEventKind> = {
  $ai_generation: 'generation',
  $ai_span: 'span',
  $ai_trace: 'trace',
  $ai_embedding: 'embedding',
};

export function postHogAiKind(eventName: string): AiEventKind | null {
  return AI_EVENT_KIND[eventName] ?? null;
}

/**
 * `$ai_*` properties folded into the normalized model (or dropped as content) instead of being
 * stored as they came. Other `$ai_*` primitives (`$ai_stream`, `$ai_temperature`, …) are kept.
 */
export const POSTHOG_AI_PROPERTIES: ReadonlySet<string> = new Set([
  '$ai_trace_id',
  '$ai_span_id',
  '$ai_parent_id',
  '$ai_span_name',
  '$ai_trace_name',
  '$ai_model',
  '$ai_provider',
  '$ai_input_tokens',
  '$ai_output_tokens',
  '$ai_cache_read_input_tokens',
  '$ai_cache_creation_input_tokens',
  '$ai_reasoning_tokens',
  '$ai_latency',
  '$ai_http_status',
  '$ai_is_error',
  '$ai_error',
  '$ai_base_url',
  '$ai_request_url',
  '$ai_input_cost_usd',
  '$ai_output_cost_usd',
  '$ai_total_cost_usd',
  '$ai_model_parameters',
  // Content: stored only through aiContentProperties, never as raw properties.
  '$ai_input',
  '$ai_output',
  '$ai_output_choices',
  '$ai_input_state',
  '$ai_output_state',
  '$ai_tools',
]);

function text(value: unknown, max: number): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function count(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return Math.min(Math.round(n), 1e9);
}

function usd(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e6 ? n : undefined;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** `$ai_error` may be a string or an error object from the SDK. */
function errorText(value: unknown): string | undefined {
  if (value == null || value === false) return undefined;
  if (typeof value === 'string') return text(value, 2000);
  try {
    return text(JSON.stringify(value), 2000);
  } catch {
    return undefined;
  }
}

/**
 * Normalized properties of one PostHog AI event. `captureContent` is the website's privacy
 * setting: when false, prompts, responses and span state are replaced by `aiContentOmitted`.
 */
export function postHogAiProperties(kind: AiEventKind, props: Json, captureContent: boolean): Json {
  const out: Json = { [AI_PROPS.kind]: kind };
  const set = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };

  set(AI_PROPS.traceId, text(props.$ai_trace_id, 200));
  set(AI_PROPS.spanId, text(props.$ai_span_id, 200));
  set(AI_PROPS.parentId, text(props.$ai_parent_id, 200));
  set(AI_PROPS.spanName, text(props.$ai_span_name, 200) ?? text(props.$ai_trace_name, 200));
  // A trace is its own span: children name it as their parent by trace id.
  if (kind === 'trace' && out[AI_PROPS.spanId] === undefined) set(AI_PROPS.spanId, out[AI_PROPS.traceId]);

  set(AI_PROPS.model, text(props.$ai_model, 120));
  set(AI_PROPS.provider, text(props.$ai_provider, 80)?.toLowerCase());
  const input = count(props.$ai_input_tokens);
  const output = count(props.$ai_output_tokens);
  set(AI_PROPS.inputTokens, input);
  set(AI_PROPS.outputTokens, output);
  if (input != null || output != null) set(AI_PROPS.totalTokens, (input ?? 0) + (output ?? 0));
  set(AI_PROPS.cacheReadTokens, count(props.$ai_cache_read_input_tokens));
  set(AI_PROPS.cacheWriteTokens, count(props.$ai_cache_creation_input_tokens));
  set(AI_PROPS.reasoningTokens, count(props.$ai_reasoning_tokens));

  const total = usd(props.$ai_total_cost_usd);
  const inputCost = usd(props.$ai_input_cost_usd);
  const outputCost = usd(props.$ai_output_cost_usd);
  set(AI_PROPS.costUsd, total ?? (inputCost != null || outputCost != null ? (inputCost ?? 0) + (outputCost ?? 0) : undefined));

  // PostHog reports latency in seconds.
  const latency = typeof props.$ai_latency === 'string' ? Number(props.$ai_latency) : props.$ai_latency;
  if (typeof latency === 'number' && Number.isFinite(latency) && latency >= 0 && latency <= 86_400) {
    set(AI_PROPS.latencyMs, Math.round(latency * 1000));
  }

  const httpStatus = count(props.$ai_http_status);
  if (httpStatus != null && httpStatus >= 100 && httpStatus <= 599) set(AI_PROPS.httpStatus, httpStatus);
  const error = errorText(props.$ai_error);
  const isError = bool(props.$ai_is_error) ?? (httpStatus != null ? httpStatus >= 400 : error != null);
  set(AI_PROPS.status, isError ? 'error' : 'success');
  set(AI_PROPS.error, error);

  set(AI_PROPS.baseUrl, text(props.$ai_base_url, 500) ?? text(props.$ai_request_url, 500));
  if (props.$ai_model_parameters && typeof props.$ai_model_parameters === 'object') {
    try {
      set(AI_PROPS.modelParams, JSON.stringify(props.$ai_model_parameters).slice(0, 2000));
    } catch {
      // unserializable parameters are skipped
    }
  }

  const contentIn = kind === 'span' || kind === 'trace' ? (props.$ai_input_state ?? props.$ai_input) : props.$ai_input;
  const contentOut =
    kind === 'span' || kind === 'trace'
      ? (props.$ai_output_state ?? props.$ai_output_choices ?? props.$ai_output)
      : (props.$ai_output_choices ?? props.$ai_output);
  Object.assign(out, aiContentProperties(contentIn, contentOut, captureContent));
  return out;
}

/** True when a batch has AI events that carry content (so the privacy setting must be read). */
export function hasPostHogAiContent(events: ReadonlyArray<{ event: string; properties: Json }>) {
  return events.some(
    (event) =>
      postHogAiKind(event.event) &&
      ['$ai_input', '$ai_output', '$ai_output_choices', '$ai_input_state', '$ai_output_state'].some(
        (key) => event.properties[key] != null,
      ),
  );
}
