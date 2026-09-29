import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES, type AiAssistantMessage, type AiStreamEvent } from '@flareboard/shared';
import worker from '../../src/index';
import type { Env } from '../../src/env';
import { listTools } from '../../src/lib/ai-tools';
import { ASSISTANT_DAILY_LIMITS, assistantRuntime, pruneIdleConversations } from '../../src/lib/assistant';
import { runDataDeletion } from '../../src/lib/data-deletion';
import { FIXTURE_SITE, seedInsightFixture } from '../helpers/insight-fixture';

const ADMIN = '00000000-0000-0000-0000-000000000001'; // owns FIXTURE_SITE
const STRANGER = 'as-stranger';
const VIEWER = 'as-viewer';
const VIEWER_SITE = 'as-viewer-site';
const BASE = Date.UTC(2026, 8, 1);
const DAY = 86_400_000;
const originalFetch = assistantRuntime.fetch;

type Captured = { url: string; headers: Record<string, string>; body: any };

/** A Claude Messages API stream, delivered in small chunks so events straddle reads. */
function claudeStream(events: Array<Record<string, unknown>>, chunkSize = 17) {
  const text = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function textTurn(text: string, stopReason = 'end_turn') {
  return [
    { type: 'message_start', message: { id: 'msg_t', usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 5) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(5) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
}

function toolTurn(id: string, name: string, input: unknown, rawJson?: string) {
  const json = rawJson ?? JSON.stringify(input);
  return [
    { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 200, cache_read_input_tokens: 50, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me check. ' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id, name, input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: json.slice(0, 10) } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: json.slice(10) } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } },
    { type: 'message_stop' },
  ];
}

/** Replaces the Claude API with scripted responses and records the requests. */
function fakeClaude(responses: Array<() => Response>) {
  const captured: Captured[] = [];
  assistantRuntime.fetch = async (url, init) => {
    captured.push({
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: JSON.parse(String(init.body)),
    });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected Claude request');
    return next();
  };
  return captured;
}

async function session(userId: string, role: string = ROLES.user) {
  const token = await createSecureToken({ userId, role }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function fetchApi(path: string, init: RequestInit = {}, extraEnv: Record<string, string | undefined> = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${path}`, init),
    { ...(env as unknown as Env), ANTHROPIC_API_KEY: 'sk-ant-test', ...extraEnv } as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function ask(websiteId: string, body: Record<string, unknown>, headers: Record<string, string>, extraEnv = {}) {
  const response = await fetchApi(`/api/websites/${websiteId}/assistant/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, extraEnv);
  if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
    return { response, events: [] as AiStreamEvent[] };
  }
  const text = await response.text();
  const events = text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as AiStreamEvent);
  return { response, events };
}

function doneMessage(events: AiStreamEvent[]) {
  const done = events.find((event): event is Extract<AiStreamEvent, { type: 'done' }> => event.type === 'done');
  expect(done).toBeTruthy();
  return done!.message as Extract<AiAssistantMessage, { role: 'assistant' }>;
}

const TREND_INPUT = {
  type: 'trend',
  query: { series: [{ kind: 'event', event: 'signup' }], interval: 'day' },
  dateFrom: '2026-02-02',
  dateTo: '2026-02-04',
};

describe('Ask Flareboard assistant', () => {
  beforeAll(async () => {
    await seedInsightFixture();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES
         (?1, 'as-stranger@example.com', 'hash', ?3, ?5, ?5),
         (?2, 'as-viewer@example.com', 'hash', ?4, ?5, ?5)`,
    )
      .bind(STRANGER, VIEWER, ROLES.user, ROLES.viewOnly, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Viewer site', 'viewer.example', ?2, ?3, ?3)`,
    )
      .bind(VIEWER_SITE, VIEWER, BASE)
      .run();
  });

  afterEach(() => {
    assistantRuntime.fetch = originalFetch;
  });

  it('is hidden when ANTHROPIC_API_KEY is not set', async () => {
    const status = await fetchApi(`/api/websites/${FIXTURE_SITE}/assistant`, { headers: await session(ADMIN, ROLES.admin) }, { ANTHROPIC_API_KEY: undefined });
    expect(await status.json()).toEqual({ enabled: false, usage: null });
    const { response } = await ask(FIXTURE_SITE, { message: 'Hi' }, await session(ADMIN, ROLES.admin), { ANTHROPIC_API_KEY: undefined });
    expect(response.status).toBe(404);
  });

  it('answers with a tool-use loop over the shared tools and stores the conversation', async () => {
    const captured = fakeClaude([
      () => claudeStream(toolTurn('toolu_1', 'run_insight', TREND_INPUT)),
      () => claudeStream(textTurn('Signups: 6 between Feb 2 and Feb 4.')),
    ]);
    const headers = await session(ADMIN, ROLES.admin);
    const { response, events } = await ask(FIXTURE_SITE, { message: 'How many signups last week?' }, headers);
    expect(response.status).toBe(200);

    const types = events.map((event) => event.type);
    expect(types[0]).toBe('conversation');
    expect(types).toEqual(expect.arrayContaining(['text', 'tool_start', 'tool_result', 'done']));
    const toolResult = events.find((event) => event.type === 'tool_result') as Extract<AiStreamEvent, { type: 'tool_result' }>;
    expect(toolResult).toMatchObject({ name: 'run_insight', ok: true, display: { kind: 'insight', insightType: 'trend' } });
    expect(events.filter((event) => event.type === 'text').map((event) => (event as { delta: string }).delta).join('')).toBe(
      'Let me check. Signups: 6 between Feb 2 and Feb 4.',
    );
    const message = doneMessage(events);
    expect(message.status).toBe('complete');
    expect(message.blocks.map((block) => block.type)).toEqual(['text', 'tool', 'text']);

    // First request: model, streaming, adaptive thinking, fallbacks, read-only tools without websiteId.
    const first = captured[0]!;
    expect(first.url).toBe('https://api.anthropic.com/v1/messages');
    expect(first.headers['x-api-key']).toBe('sk-ant-test');
    expect(first.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(first.body).toMatchObject({ model: 'claude-opus-5', stream: true, thinking: { type: 'adaptive' }, fallbacks: 'default' });
    const toolNames = first.body.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain('run_insight');
    expect(toolNames).not.toContain('list_websites');
    expect(toolNames).not.toContain('toggle_feature_flag');
    expect(toolNames).not.toContain('create_annotation');
    for (const tool of first.body.tools) {
      expect(tool.eager_input_streaming).toBe(true);
      expect(tool.input_schema.properties).not.toHaveProperty('websiteId');
    }
    expect(JSON.stringify(first.body.system)).toContain('Insights fixture');
    expect(first.body.messages).toEqual([{ role: 'user', content: 'How many signups last week?' }]);

    // Second request: the assistant turn is echoed (thinking signature kept) and the tool result follows.
    const second = captured[1]!;
    const [assistantTurn, toolResults] = second.body.messages.slice(-2);
    expect(assistantTurn.role).toBe('assistant');
    expect(assistantTurn.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-1' });
    expect(assistantTurn.content[2]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'run_insight', input: TREND_INPUT });
    expect(toolResults.role).toBe('user');
    expect(toolResults.content).toHaveLength(1);
    expect(toolResults.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    expect(JSON.parse(toolResults.content[0].content)).toMatchObject({ kind: 'trend', series: [{ total: 6, data: [4, 2, 0] }] });

    // Stored for this user and website.
    const conversationId = (events[0] as Extract<AiStreamEvent, { type: 'conversation' }>).conversation.id;
    const list = await fetchApi(`/api/websites/${FIXTURE_SITE}/assistant/conversations`, { headers });
    const { conversations } = (await list.json()) as { conversations: Array<{ id: string; title: string }> };
    expect(conversations[0]).toMatchObject({ id: conversationId, title: 'How many signups last week?' });
    const detail = await fetchApi(`/api/websites/${FIXTURE_SITE}/assistant/conversations/${conversationId}`, { headers });
    const { messages } = (await detail.json()) as { messages: AiAssistantMessage[] };
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const tool = (messages[1] as Extract<AiAssistantMessage, { role: 'assistant' }>).blocks[1];
    expect(tool).toMatchObject({ type: 'tool', name: 'run_insight', ok: true, display: { kind: 'insight' } });

    // Token usage is counted, content is not.
    const usage = await env.DB.prepare('SELECT requests, input_tokens AS inputTokens, output_tokens AS outputTokens FROM ai_usage_daily WHERE user_id = ?1')
      .bind(ADMIN)
      .first<{ requests: number; inputTokens: number; outputTokens: number }>();
    expect(usage).toMatchObject({ requests: 1, inputTokens: 350, outputTokens: 60 });

    // A follow-up replays the earlier turn, including the tools it used.
    const followUp = fakeClaude([() => claudeStream(textTurn('By country: mostly US.'))]);
    await ask(FIXTURE_SITE, { message: 'And by country?', conversationId }, headers);
    const replayed = followUp[0]!.body.messages;
    expect(replayed[0]).toEqual({ role: 'user', content: 'How many signups last week?' });
    expect(replayed[1].role).toBe('assistant');
    expect(replayed[1].content).toContain('Signups: 6');
    expect(replayed[1].content).toContain('[Tools used: run_insight');
    expect(replayed[2]).toEqual({ role: 'user', content: 'And by country?' });

    // Other users cannot see or delete it; the owner can delete it.
    const strangerHeaders = await session(STRANGER);
    const foreign = await fetchApi(`/api/websites/${FIXTURE_SITE}/assistant/conversations/${conversationId}`, { headers: strangerHeaders });
    expect(foreign.status).toBe(404);
    const removed = await fetchApi(`/api/websites/${FIXTURE_SITE}/assistant/conversations/${conversationId}`, { method: 'DELETE', headers });
    expect(removed.status).toBe(200);
    const gone = await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_message WHERE conversation_id = ?1').bind(conversationId).first<{ n: number }>();
    expect(gone?.n).toBe(0);
    const after = await fetchApi(`/api/websites/${FIXTURE_SITE}/assistant/conversations/${conversationId}`, { headers });
    expect(after.status).toBe(404);
  });

  it('returns tool errors to the model and keeps tools on the conversation’s website', async () => {
    const captured = fakeClaude([
      () => claudeStream(toolTurn('toolu_x', 'run_insight', { ...TREND_INPUT, websiteId: VIEWER_SITE })),
      () => claudeStream(toolTurn('toolu_y', 'run_sql', null, '{"sql": "SELECT 1" oops')),
      () => claudeStream(toolTurn('toolu_z', 'toggle_feature_flag', { key: 'x', enabled: true })),
      () => claudeStream(textTurn('I could not run that.')),
    ]);
    const { events } = await ask(FIXTURE_SITE, { message: 'Compare with the other site' }, await session(ADMIN, ROLES.admin));
    expect(doneMessage(events).status).toBe('complete');

    const results = captured.slice(1).map((request) => request.body.messages.at(-1).content[0]);
    expect(results[0]).toMatchObject({ tool_use_id: 'toolu_x', is_error: true, content: expect.stringMatching(/its own website/) });
    expect(results[1]).toMatchObject({ tool_use_id: 'toolu_y', is_error: true });
    expect(JSON.parse(results[1].content)).toEqual({ INVALID_JSON: '{"sql": "SELECT 1" oops' });
    // Write tools do not exist for the assistant.
    expect(results[2]).toMatchObject({ tool_use_id: 'toolu_z', is_error: true, content: expect.stringMatching(/Unknown tool/) });
    const flagChange = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'feature_flag'`).first<{ n: number }>();
    expect(flagChange?.n).toBe(0);
  });

  it('handles refusals and API errors without throwing', async () => {
    fakeClaude([() => claudeStream(textTurn('I will not', 'refusal'))]);
    const refused = await ask(FIXTURE_SITE, { message: 'Something odd' }, await session(ADMIN, ROLES.admin));
    const message = doneMessage(refused.events);
    expect(message.status).toBe('refused');
    expect(message.blocks).toEqual([]);

    fakeClaude([() => new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } }), { status: 529 })]);
    const failed = await ask(FIXTURE_SITE, { message: 'Try again' }, await session(ADMIN, ROLES.admin));
    expect(failed.events.find((event) => event.type === 'error')).toMatchObject({ message: expect.stringMatching(/busy/) });
    expect(doneMessage(failed.events).status).toBe('error');
  });

  it('requires access to the website and lets view-only accounts ask', async () => {
    const denied = await ask(FIXTURE_SITE, { message: 'Hi' }, await session(STRANGER));
    expect(denied.response.status).toBe(404);

    fakeClaude([() => claudeStream(textTurn('Hello there.'))]);
    const viewer = await ask(VIEWER_SITE, { message: 'Hi' }, await session(VIEWER, ROLES.viewOnly));
    expect(viewer.response.status).toBe(200);
    expect(doneMessage(viewer.events).status).toBe('complete');
  });

  it('caps daily use per account in hosted mode', async () => {
    const hosted = { HOSTED_MODE: 'true' };
    const headers = await session(VIEWER, ROLES.viewOnly);
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare('INSERT OR REPLACE INTO ai_usage_daily (user_id, day, requests) VALUES (?1, ?2, ?3)')
      .bind(VIEWER, today, ASSISTANT_DAILY_LIMITS.free)
      .run();
    const status = await fetchApi(`/api/websites/${VIEWER_SITE}/assistant`, { headers }, hosted);
    expect(await status.json()).toEqual({ enabled: true, usage: { used: ASSISTANT_DAILY_LIMITS.free, limit: ASSISTANT_DAILY_LIMITS.free } });
    const { response } = await ask(VIEWER_SITE, { message: 'One more' }, headers, hosted);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'assistant_daily_limit' });

    // Self-hosted: no daily cap.
    fakeClaude([() => claudeStream(textTurn('Still here.'))]);
    const selfHosted = await ask(VIEWER_SITE, { message: 'One more' }, headers);
    expect(selfHosted.response.status).toBe(200);
  });

  it('prunes idle conversations and erases them with the account', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ai_conversation (conversation_id, website_id, user_id, title, created_at, updated_at) VALUES ('as-old', ?1, ?2, 'Old', ?3, ?3)`,
      ).bind(VIEWER_SITE, VIEWER, now - 91 * DAY),
      env.DB.prepare(
        `INSERT INTO ai_message (message_id, conversation_id, website_id, user_id, role, content, created_at) VALUES ('as-old-m', 'as-old', ?1, ?2, 'user', '{"text":"x"}', ?3)`,
      ).bind(VIEWER_SITE, VIEWER, now - 91 * DAY),
    ]);
    expect(await pruneIdleConversations(env as unknown as Env, now)).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ai_message WHERE message_id = 'as-old-m'`).first('n')).toBe(0);

    // Account deleted more than 30 days ago: its site, conversations and usage are erased.
    await env.DB.batch([
      env.DB.prepare('UPDATE user SET deleted_at = ?2 WHERE user_id = ?1').bind(VIEWER, now - 40 * DAY),
      env.DB.prepare('UPDATE website SET deleted_at = ?2 WHERE website_id = ?1').bind(VIEWER_SITE, now - 40 * DAY),
    ]);
    for (let i = 0; i < 5; i++) await runDataDeletion(env as unknown as Env, now);
    for (const table of ['ai_conversation', 'ai_message', 'ai_usage_daily']) {
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`).bind(VIEWER).first('n')).toBe(0);
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE user_id = ?1').bind(VIEWER).first('n')).toBe(0);
  });
});

describe('shared tool registry', () => {
  it('gives the assistant the MCP read tools, bound to its website', () => {
    const mcp = listTools({ scopes: ['read', 'write'], channel: 'mcp' });
    const assistant = listTools({ scopes: ['read'], channel: 'assistant', websiteId: 'site-1' });
    const byName = new Map(mcp.map((tool) => [tool.name, tool]));
    expect(assistant.length).toBeGreaterThan(5);
    for (const tool of assistant) {
      const shared = byName.get(tool.name);
      expect(shared, tool.name).toBeTruthy();
      expect(tool.scope).toBe('read');
      expect(tool.description).toBe(shared!.description);
      const { websiteId: _websiteId, ...properties } = (shared!.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(tool.inputSchema.properties).toEqual(properties);
    }
  });
});
