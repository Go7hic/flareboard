import type { Context } from 'hono';
import { aiAskSchema, type AiAssistantStatus, type AiStreamEvent } from '@flareboard/shared';
import type { Env } from '../env';
import {
  answerQuestion,
  ASSISTANT_LIMITS,
  consumeAssistantRequest,
  deleteConversation,
  getAssistantDailyLimit,
  getAssistantUsage,
  getConversation,
  getConversationMessages,
  isAssistantEnabled,
  listConversations,
} from '../lib/assistant';
import { checkIpRateLimit } from '../lib/rate-limit';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function disabled() {
  return json({ message: 'The assistant is not enabled on this server.', code: 'assistant_disabled' }, 404);
}

/** `{ enabled, usage }`. The dashboard hides the assistant when it is not enabled. */
export async function handleStatus(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!isAssistantEnabled(c.env)) return json({ enabled: false, usage: null } satisfies AiAssistantStatus);
  const userId = c.get('user').userId;
  const limit = await getAssistantDailyLimit(c.env, website!, userId);
  const usage = limit === null ? null : { used: await getAssistantUsage(c.env, userId), limit };
  return json({ enabled: true, usage } satisfies AiAssistantStatus);
}

export async function handleListConversations(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!isAssistantEnabled(c.env)) return disabled();
  return json({ conversations: await listConversations(c.env, c.get('user').userId, website!.websiteId) });
}

export async function handleGetConversation(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!isAssistantEnabled(c.env)) return disabled();
  const conversation = await getConversation(
    c.env,
    c.get('user').userId,
    website!.websiteId,
    c.req.param('conversationId') ?? '',
  );
  if (!conversation) return notFound();
  return json({ conversation, messages: await getConversationMessages(c.env, conversation.id) });
}

/** Conversations stay deletable when the assistant is switched off. */
export async function handleDeleteConversation(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const deleted = await deleteConversation(
    c.env,
    c.get('user').userId,
    website!.websiteId,
    c.req.param('conversationId') ?? '',
  );
  if (!deleted) return notFound();
  return json({ ok: true });
}

/**
 * Asks a question. Answers as server-sent events (`data: <AiStreamEvent JSON>`): the
 * conversation, text deltas, tool calls and results, then `done` with the stored message.
 */
export async function handleAsk(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!isAssistantEnabled(c.env)) return disabled();

  const parsed = aiAskSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request');
  const user = c.get('user');

  const conversationId = parsed.data.conversationId ?? null;
  if (conversationId && !(await getConversation(c.env, user.userId, website!.websiteId, conversationId))) {
    return notFound('Conversation not found');
  }

  const burst = await checkIpRateLimit(c.env, 'assistant', user.userId, ASSISTANT_LIMITS.perMinute, 60);
  if (!burst.allowed) return json({ message: 'Too many questions. Wait a minute.', code: 'assistant_rate_limited' }, 429);
  const limit = await getAssistantDailyLimit(c.env, website!, user.userId);
  if (!(await consumeAssistantRequest(c.env, user.userId, limit))) {
    return json({ message: 'You have reached today’s assistant limit.', code: 'assistant_daily_limit', limit }, 429);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  // A closed tab must not stop the answer from being stored: write failures are ignored.
  const emit = (event: AiStreamEvent) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => undefined);
  };
  const task = answerQuestion({
    env: c.env,
    user,
    website: website!,
    conversationId,
    question: parsed.data.message,
    emit,
  })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'assistant_turn_failed', error: error instanceof Error ? error.name : 'unknown' }));
      emit({ type: 'error', message: 'The assistant could not answer. Try again.' });
    })
    .finally(() => {
      // Not awaited: close() settles only once the client has read everything.
      void writer.close().catch(() => undefined);
    });
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
