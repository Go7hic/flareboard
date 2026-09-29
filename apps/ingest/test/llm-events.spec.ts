import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_CONTENT_MAX_BYTES, EVENT_TYPE, isTruncatedAiContent, type QueueMessage } from '@flareboard/shared';
import { forgetLlmSettings } from '../src/lib/llm-settings';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorkerWithEnv, recordingQueue, seedProjectKey } from './helpers/queue';

const KEY = `fb_pk_${'LlmEventsKey'.padEnd(24, '0')}`;
const PRIVATE_SITE = '00000000-0000-0000-0000-0000000000c4';
const PRIVATE_KEY = `fb_pk_${'LlmEventsPrivate'.padEnd(24, '0')}`;
const TRACE = 'b1f6a1a4-3d5e-4c8e-9a51-0e2f5d7c1a01';

type EventMessage = Extract<QueueMessage, { type: 'event' }>;

async function capture(batch: unknown[], key = KEY) {
  const recorder = recordingQueue();
  const response = await fetchWorkerWithEnv(
    '/batch/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': 'posthog-python/3.7.0', 'cf-connecting-ip': '198.51.100.20' },
      body: JSON.stringify({ api_key: key, batch }),
    },
    { EVENT_QUEUE: recorder.queue },
  );
  expect(response.status).toBe(200);
  return recorder.events();
}

function props(message: EventMessage) {
  return Object.fromEntries(
    (message.eventData ?? []).map((row) => [row.dataKey, row.numberValue ?? row.stringValue ?? null]),
  ) as Record<string, string | number | null>;
}

/** Shapes as posthog-python's OpenAI / Anthropic wrappers and LangChain callback send them. */
const openAiGeneration = {
  event: '$ai_generation',
  distinct_id: 'user-42',
  uuid: '0192b6a0-0000-7000-8000-000000000001',
  timestamp: new Date().toISOString(),
  properties: {
    $ai_provider: 'openai',
    $ai_model: 'gpt-4o-mini-2024-07-18',
    $ai_model_parameters: { temperature: 0.2, max_completion_tokens: 256 },
    $ai_input: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is Flareboard?' },
    ],
    $ai_output_choices: [{ role: 'assistant', content: 'An analytics platform on Cloudflare.' }],
    $ai_http_status: 200,
    $ai_input_tokens: 27,
    $ai_output_tokens: 9,
    $ai_cache_read_input_tokens: 0,
    $ai_reasoning_tokens: 0,
    $ai_latency: 0.8123,
    $ai_trace_id: TRACE,
    $ai_parent_id: 'span-retrieve',
    $ai_span_id: 'gen-1',
    $ai_base_url: 'https://api.openai.com/v1',
    $ai_stream: false,
    $ai_tools: [{ type: 'function', function: { name: 'lookup' } }],
    conversation_id: 'conv-7',
    $lib: 'posthog-python',
  },
};

const anthropicError = {
  event: '$ai_generation',
  distinct_id: 'user-42',
  properties: {
    $ai_provider: 'anthropic',
    $ai_model: 'claude-sonnet-4-5-20250929',
    $ai_input: [{ role: 'user', content: 'Summarize' }],
    $ai_input_tokens: 12,
    $ai_output_tokens: 0,
    $ai_cache_creation_input_tokens: 2048,
    $ai_cache_read_input_tokens: 4096,
    $ai_latency: '1.5',
    $ai_http_status: 429,
    $ai_is_error: true,
    $ai_error: { type: 'rate_limit_error', message: 'Rate limited' },
    $ai_trace_id: TRACE,
    $ai_parent_id: TRACE,
  },
};

const langchainTrace = {
  event: '$ai_trace',
  distinct_id: 'user-42',
  properties: {
    $ai_trace_id: TRACE,
    $ai_span_name: 'RunnableSequence',
    $ai_input_state: { question: 'What is Flareboard?' },
    $ai_output_state: { answer: 'An analytics platform' },
    $ai_latency: 2.1,
  },
};

const langchainSpan = {
  event: '$ai_span',
  distinct_id: 'user-42',
  properties: {
    $ai_trace_id: TRACE,
    $ai_span_id: 'span-retrieve',
    $ai_parent_id: TRACE,
    $ai_span_name: 'retriever',
    $ai_input_state: 'What is Flareboard?',
    $ai_output_state: [{ page_content: 'doc' }],
    $ai_latency: 0.3,
  },
};

describe('LLM analytics ingestion', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Private LLM', 'private-llm.example.com', '00000000-0000-0000-0000-000000000001', ?2, ?2)`,
    )
      .bind(PRIVATE_SITE, Date.now())
      .run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO llm_website_setting (website_id, capture_content, updated_at) VALUES (?1, 0, ?2)`,
    )
      .bind(PRIVATE_SITE, Date.now())
      .run();
    await seedProjectKey(env.DB, TEST_WEBSITE_ID, KEY);
    await seedProjectKey(env.DB, PRIVATE_SITE, PRIVATE_KEY);
  });

  beforeEach(async () => {
    forgetLlmSettings();
    await env.CACHE.delete(`llm-settings:${TEST_WEBSITE_ID}`);
    await env.CACHE.delete(`llm-settings:${PRIVATE_SITE}`);
  });

  it('maps a posthog OpenAI $ai_generation onto the AI event model', async () => {
    const [event] = await capture([openAiGeneration]);
    expect(event!.data).toMatchObject({ eventType: EVENT_TYPE.ai, eventName: '$ai_generation', websiteId: TEST_WEBSITE_ID });
    const p = props(event!);
    expect(p).toMatchObject({
      aiKind: 'generation',
      provider: 'openai',
      model: 'gpt-4o-mini-2024-07-18',
      inputTokens: 27,
      outputTokens: 9,
      totalTokens: 36,
      cacheReadTokens: 0,
      latencyMs: 812,
      httpStatus: 200,
      status: 'success',
      traceId: TRACE,
      spanId: 'gen-1',
      parentSpanId: 'span-retrieve',
      baseUrl: 'https://api.openai.com/v1',
      aiModelParams: '{"temperature":0.2,"max_completion_tokens":256}',
      conversation_id: 'conv-7',
      $ai_stream: 'false',
    });
    expect(JSON.parse(String(p.aiInput))).toEqual(openAiGeneration.properties.$ai_input);
    expect(JSON.parse(String(p.aiOutput))).toEqual(openAiGeneration.properties.$ai_output_choices);
    // No cost was reported: it is computed at query time from the price table.
    expect(p.costUsd).toBeUndefined();
    for (const raw of ['$ai_input', '$ai_output_choices', '$ai_model', '$ai_latency', '$ai_tools', '$ai_trace_id']) {
      expect(p[raw]).toBeUndefined();
    }
  });

  it('maps errors, Anthropic cache tokens, traces and spans', async () => {
    const events = await capture([anthropicError, langchainTrace, langchainSpan]);
    const byName = Object.fromEntries(events.map((event) => [event.data.eventName, props(event)]));
    expect(byName.$ai_generation).toMatchObject({
      provider: 'anthropic',
      cacheWriteTokens: 2048,
      cacheReadTokens: 4096,
      latencyMs: 1500,
      httpStatus: 429,
      status: 'error',
      aiError: '{"type":"rate_limit_error","message":"Rate limited"}',
      parentSpanId: TRACE,
    });
    expect(byName.$ai_trace).toMatchObject({
      aiKind: 'trace',
      traceId: TRACE,
      spanId: TRACE,
      spanName: 'RunnableSequence',
      latencyMs: 2100,
      status: 'success',
      aiInput: '{"question":"What is Flareboard?"}',
      aiOutput: '{"answer":"An analytics platform"}',
    });
    expect(byName.$ai_trace!.model).toBeUndefined();
    expect(byName.$ai_span).toMatchObject({
      aiKind: 'span',
      spanId: 'span-retrieve',
      parentSpanId: TRACE,
      spanName: 'retriever',
      aiInput: 'What is Flareboard?',
    });
  });

  it('keeps reported costs', async () => {
    const [event] = await capture([
      { ...openAiGeneration, uuid: undefined, properties: { ...openAiGeneration.properties, $ai_input_cost_usd: 0.001, $ai_output_cost_usd: 0.002 } },
    ]);
    expect(props(event!).costUsd).toBeCloseTo(0.003, 10);
  });

  it('caps prompt and response content at 32 KB with a marker', async () => {
    const long = 'x'.repeat(AI_CONTENT_MAX_BYTES + 5000);
    const [event] = await capture([
      { ...openAiGeneration, uuid: undefined, properties: { ...openAiGeneration.properties, $ai_input: long } },
    ]);
    const input = String(props(event!).aiInput);
    expect(isTruncatedAiContent(input)).toBe(true);
    expect(input.startsWith('x'.repeat(AI_CONTENT_MAX_BYTES))).toBe(true);
    expect(input.length).toBeLessThan(AI_CONTENT_MAX_BYTES + 200);
  });

  it('stores no content for websites that turned content capture off', async () => {
    const events = await capture([openAiGeneration, langchainSpan], PRIVATE_KEY);
    for (const event of events) {
      const p = props(event);
      expect(p.aiInput).toBeUndefined();
      expect(p.aiOutput).toBeUndefined();
      expect(p.$ai_input).toBeUndefined();
      expect(p.aiContentOmitted).toBe('true');
    }
    // Metadata is still there.
    expect(props(events[0]!)).toMatchObject({ model: 'gpt-4o-mini-2024-07-18', inputTokens: 27 });
  });

  it('normalizes AI events from the tracker and server API the same way', async () => {
    const send = async (website: string, payload: Record<string, unknown>) => {
      const recorder = recordingQueue();
      const response = await fetchWorkerWithEnv(
        '/api/send',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'user-agent': 'node', 'cf-connecting-ip': '198.51.100.21' },
          body: JSON.stringify({ type: 'ai', payload: { website, hostname: 'app.example.com', url: '/chat', ...payload } }),
        },
        { EVENT_QUEUE: recorder.queue },
      );
      expect(response.status).toBe(200);
      return recorder.events();
    };
    const call = {
      name: 'chat_completion',
      provider: 'OpenAI',
      model: 'gpt-4.1-mini',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      latencyMs: 640,
      traceId: 'trace-tracker-1',
      spanId: 'gen-a',
      parentSpanId: 'root',
      input: [{ role: 'user', content: 'hi' }],
      output: 'hello',
      data: { feature: 'chat', aiInput: 'smuggled' },
    };
    const [event] = await send(TEST_WEBSITE_ID, call);
    expect(event!.data).toMatchObject({ eventType: EVENT_TYPE.ai, eventName: 'chat_completion' });
    expect(props(event!)).toMatchObject({
      aiKind: 'generation',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      totalTokens: 120,
      cacheReadTokens: 40,
      traceId: 'trace-tracker-1',
      spanId: 'gen-a',
      parentSpanId: 'root',
      aiInput: '[{"role":"user","content":"hi"}]',
      aiOutput: 'hello',
      feature: 'chat',
      status: 'success',
    });

    const [privateEvent] = await send(PRIVATE_SITE, call);
    const p = props(privateEvent!);
    expect(p.aiInput).toBeUndefined();
    expect(p.aiOutput).toBeUndefined();
    expect(p.aiContentOmitted).toBe('true');
    expect(p.model).toBe('gpt-4.1-mini');
  });
});
