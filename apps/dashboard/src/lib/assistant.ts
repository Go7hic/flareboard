import type {
  AiAssistantBlock,
  AiAssistantMessage,
  AiAssistantStatus,
  AiConversationSummary,
  AiStreamEvent,
} from '@flareboard/shared/ai';
import { ApiError, api, authenticatedFetch } from './api';

export type { AiAssistantMessage, AiAssistantStatus, AiConversationSummary, AiStreamEvent };

function base(websiteId: string) {
  return `/api/websites/${encodeURIComponent(websiteId)}/assistant`;
}

export function fetchAssistantStatus(websiteId: string) {
  return api<AiAssistantStatus>(base(websiteId));
}

export function fetchConversations(websiteId: string) {
  return api<{ conversations: AiConversationSummary[] }>(`${base(websiteId)}/conversations`).then((body) => body.conversations);
}

export function fetchConversation(websiteId: string, conversationId: string) {
  return api<{ conversation: AiConversationSummary; messages: AiAssistantMessage[] }>(
    `${base(websiteId)}/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export function deleteConversation(websiteId: string, conversationId: string) {
  return api<{ ok: true }>(`${base(websiteId)}/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
}

/**
 * Asks a question and calls `onEvent` for each server-sent event until the answer is done.
 * Rejects with ApiError when the request is refused before streaming (limits, access).
 */
export async function askAssistant(
  websiteId: string,
  body: { message: string; conversationId: string | null },
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await authenticatedFetch(`${base(websiteId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new ApiError(err.message || res.statusText || 'Request failed', res.status, err);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (chunk.startsWith('data: ')) {
        try {
          onEvent(JSON.parse(chunk.slice(6)) as AiStreamEvent);
        } catch {
          /* ignore a malformed chunk */
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
}

/** A tool block still waiting for its result (live answers only). */
export type LiveToolBlock = Extract<AiAssistantBlock, { type: 'tool' }> & { pending?: boolean };

/** The answer being streamed, before the server sends the stored message. */
export type LiveAnswer = { blocks: Array<AiAssistantBlock | LiveToolBlock> };

/** Folds a text / tool event into the live answer (other events leave it unchanged). */
export function applyStreamEvent(live: LiveAnswer, event: AiStreamEvent): LiveAnswer {
  const blocks = [...live.blocks];
  if (event.type === 'text') {
    const last = blocks.at(-1);
    if (last?.type === 'text') blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
    else blocks.push({ type: 'text', text: event.delta });
  } else if (event.type === 'tool_start') {
    blocks.push({ type: 'tool', id: event.id, name: event.name, input: event.input, ok: true, pending: true });
  } else if (event.type === 'tool_result') {
    const index = blocks.findIndex((block) => block.type === 'tool' && block.id === event.id);
    const next: LiveToolBlock = {
      type: 'tool',
      id: event.id,
      name: event.name,
      input: index >= 0 ? (blocks[index] as LiveToolBlock).input : null,
      ok: event.ok,
      ...(event.error ? { error: event.error } : {}),
      ...(event.display ? { display: event.display } : {}),
    };
    if (index >= 0) blocks[index] = next;
    else blocks.push(next);
  } else {
    return live;
  }
  return { blocks };
}
