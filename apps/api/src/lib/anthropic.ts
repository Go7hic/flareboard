/**
 * Minimal streaming client for the Claude Messages API (`POST /v1/messages`, `stream: true`).
 *
 * Plain `fetch` + SSE parsing instead of `@anthropic-ai/sdk`: the API worker only needs one
 * streaming call with client tools, and an injectable `fetch` keeps tests off the network.
 * Content blocks are accumulated exactly as streamed so the assistant can echo them back
 * (thinking blocks keep their signatures) in the next request of a tool-use loop.
 */

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Server-side refusal fallbacks, `fallbacks: "default"` form. */
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ClaudeTextBlock = { type: 'text'; text: string };
export type ClaudeThinkingBlock = { type: 'thinking'; thinking: string; signature: string };
export type ClaudeRedactedThinkingBlock = { type: 'redacted_thinking'; data: string };
export type ClaudeToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ClaudeFallbackBlock = { type: 'fallback'; from?: unknown; to?: unknown };

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeThinkingBlock
  | ClaudeRedactedThinkingBlock
  | ClaudeToolUseBlock
  | ClaudeFallbackBlock;

export type ClaudeToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ClaudeMessageParam =
  | { role: 'user'; content: string | Array<ClaudeTextBlock | ClaudeToolResultBlock> }
  | { role: 'assistant'; content: string | ClaudeContentBlock[] };

export type ClaudeUsage = { inputTokens: number; outputTokens: number };

export type ClaudeTurn = {
  content: ClaudeContentBlock[];
  stopReason: string | null;
  usage: ClaudeUsage;
  /** tool_use ids whose streamed input was not valid JSON, with the raw text. */
  invalidToolInputs: Map<string, string>;
};

export class ClaudeApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: string | null,
  ) {
    super(`Claude API error ${status}${errorType ? ` (${errorType})` : ''}`);
  }
}

type StreamingBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; json: string }
  | { type: 'fallback'; from?: unknown; to?: unknown }
  | { type: 'other' };

function startBlock(raw: Record<string, unknown>): StreamingBlock {
  switch (raw.type) {
    case 'text':
      return { type: 'text', text: typeof raw.text === 'string' ? raw.text : '' };
    case 'thinking':
      return {
        type: 'thinking',
        thinking: typeof raw.thinking === 'string' ? raw.thinking : '',
        signature: typeof raw.signature === 'string' ? raw.signature : '',
      };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: typeof raw.data === 'string' ? raw.data : '' };
    case 'tool_use':
      return { type: 'tool_use', id: String(raw.id ?? ''), name: String(raw.name ?? ''), json: '' };
    case 'fallback':
      return { type: 'fallback', from: raw.from, to: raw.to };
    default:
      return { type: 'other' };
  }
}

function finishBlock(block: StreamingBlock, invalid: Map<string, string>): ClaudeContentBlock | null {
  switch (block.type) {
    case 'text':
    case 'thinking':
    case 'redacted_thinking':
    case 'fallback':
      return block;
    case 'tool_use': {
      let input: unknown = {};
      if (block.json.trim()) {
        try {
          input = JSON.parse(block.json);
        } catch {
          invalid.set(block.id, block.json);
        }
      }
      return { type: 'tool_use', id: block.id, name: block.name, input };
    }
    default:
      return null;
  }
}

/**
 * Streams one Messages API request. `onText` receives text deltas as they arrive.
 * Resolves with the accumulated content blocks once the stream ends.
 */
export async function streamClaudeMessage(options: {
  apiKey: string;
  body: Record<string, unknown>;
  fetch: FetchLike;
  betas?: string[];
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<ClaudeTurn> {
  const response = await options.fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      ...(options.betas?.length ? { 'anthropic-beta': options.betas.join(',') } : {}),
    },
    body: JSON.stringify({ ...options.body, stream: true }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: { type?: string } } | null;
    throw new ClaudeApiError(response.status, payload?.error?.type ?? null);
  }

  const blocks = new Map<number, StreamingBlock>();
  const content: Array<{ index: number; block: ClaudeContentBlock }> = [];
  const invalidToolInputs = new Map<string, string>();
  const usage: ClaudeUsage = { inputTokens: 0, outputTokens: 0 };
  let stopReason: string | null = null;

  const handleEvent = (data: string) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (event.type) {
      case 'message_start': {
        const message = event.message as { usage?: Record<string, number> } | undefined;
        const u = message?.usage ?? {};
        usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        usage.outputTokens += u.output_tokens ?? 0;
        break;
      }
      case 'content_block_start':
        blocks.set(Number(event.index), startBlock((event.content_block ?? {}) as Record<string, unknown>));
        break;
      case 'content_block_delta': {
        const block = blocks.get(Number(event.index));
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        if (!block) break;
        if (delta.type === 'text_delta' && block.type === 'text' && typeof delta.text === 'string') {
          block.text += delta.text;
          options.onText?.(delta.text);
        } else if (delta.type === 'input_json_delta' && block.type === 'tool_use' && typeof delta.partial_json === 'string') {
          block.json += delta.partial_json;
        } else if (delta.type === 'thinking_delta' && block.type === 'thinking' && typeof delta.thinking === 'string') {
          block.thinking += delta.thinking;
        } else if (delta.type === 'signature_delta' && block.type === 'thinking' && typeof delta.signature === 'string') {
          block.signature += delta.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const index = Number(event.index);
        const block = blocks.get(index);
        if (!block) break;
        const finished = finishBlock(block, invalidToolInputs);
        if (finished) content.push({ index, block: finished });
        blocks.delete(index);
        break;
      }
      case 'message_delta': {
        const delta = (event.delta ?? {}) as { stop_reason?: string | null };
        if (delta.stop_reason !== undefined) stopReason = delta.stop_reason;
        const u = (event.usage ?? {}) as Record<string, number>;
        // message_delta usage is cumulative for the response.
        if (typeof u.output_tokens === 'number') usage.outputTokens = Math.max(usage.outputTokens, u.output_tokens);
        break;
      }
      case 'error': {
        const error = (event.error ?? {}) as { type?: string };
        throw new ClaudeApiError(200, error.type ?? 'stream_error');
      }
    }
  };

  const dispatch = (raw: string) => {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) handleEvent(data);
  };

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    // Events are separated by a blank line; `data:` lines carry the JSON.
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      dispatch(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
    }
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);

  content.sort((a, b) => a.index - b.index);
  return { content: content.map((entry) => entry.block), stopReason, usage, invalidToolInputs };
}

/**
 * Assistant content to send back in the next request. After a mid-output server-side
 * fallback, thinking and tool_use blocks before the last `fallback` marker belong to the
 * declined attempt and are left out; the marker itself is dropped.
 */
export function echoableContent(content: ClaudeContentBlock[]): ClaudeContentBlock[] {
  let lastFallback = -1;
  content.forEach((block, index) => {
    if (block.type === 'fallback') lastFallback = index;
  });
  return content.filter((block, index) => {
    if (block.type === 'fallback') return false;
    if (index < lastFallback && block.type !== 'text') return false;
    return true;
  });
}
