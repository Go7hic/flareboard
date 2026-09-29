import { AI_CONTENT_KEYS, AI_PROPS, aiContentProperties, type AiEventKind } from '@flareboard/shared';

/** The AI fields of a tracker / server API `type: 'ai'` payload (see sendPayloadSchema). */
export type TrackerAiPayload = {
  name?: string;
  data?: Record<string, unknown>;
  kind?: AiEventKind;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: 'success' | 'error';
  quality?: string;
  release?: string;
  environment?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  /** Span name. */
  operation?: string;
  /** Error message of a failed call. */
  message?: string;
  input?: unknown;
  output?: unknown;
};

/**
 * Event properties of a Flareboard AI event, in the same model as PostHog `$ai_*` events
 * (`AI_PROPS`). The AI fields come first (event_data keeps at most 100 keys) and win over custom
 * `data`; reserved content keys in `data` are dropped so the content setting cannot be bypassed.
 */
export function trackerAiProperties(payload: TrackerAiPayload, captureContent: boolean): Record<string, unknown> {
  const custom = { ...(payload.data ?? {}) };
  for (const key of AI_CONTENT_KEYS) delete custom[key];
  delete custom[AI_PROPS.contentOmitted];

  const kind = payload.kind ?? 'generation';
  const callKind = kind === 'generation' || kind === 'embedding';
  const { inputTokens, outputTokens } = payload;
  const out: Record<string, unknown> = {
    [AI_PROPS.kind]: kind,
    [AI_PROPS.provider]: payload.provider?.toLowerCase(),
    // A call without a model keeps the old default; spans and traces have none.
    [AI_PROPS.model]: payload.model ?? (callKind ? (payload.name ?? 'unknown') : undefined),
    [AI_PROPS.inputTokens]: inputTokens,
    [AI_PROPS.outputTokens]: outputTokens,
    [AI_PROPS.totalTokens]: payload.totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined),
    [AI_PROPS.cacheReadTokens]: payload.cacheReadTokens,
    [AI_PROPS.cacheWriteTokens]: payload.cacheWriteTokens,
    [AI_PROPS.costUsd]: payload.costUsd,
    [AI_PROPS.latencyMs]: payload.latencyMs,
    [AI_PROPS.status]: payload.status ?? 'success',
    [AI_PROPS.error]: payload.status === 'error' ? payload.message : undefined,
    [AI_PROPS.traceId]: payload.traceId,
    [AI_PROPS.spanId]: payload.spanId ?? (kind === 'trace' ? payload.traceId : undefined),
    [AI_PROPS.parentId]: payload.parentSpanId,
    [AI_PROPS.spanName]: payload.operation,
    [AI_PROPS.quality]: payload.quality,
    [AI_PROPS.release]: payload.release,
    [AI_PROPS.environment]: payload.environment,
    ...aiContentProperties(payload.input, payload.output, captureContent),
  };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  for (const [key, value] of Object.entries(custom)) if (!(key in out)) out[key] = value;
  return out;
}
