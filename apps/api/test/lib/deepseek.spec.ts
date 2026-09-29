import { describe, expect, it } from 'vitest';
import { DeepSeekApiError, streamDeepSeekMessage } from '../../src/lib/deepseek';
import { toolResultForModel, questionForModel, ASSISTANT_LIMITS } from '../../src/lib/assistant';
import { summarizeInsightResult } from '../../src/lib/ai-tools';

function sseResponse(raw: string, chunk = 5) {
  const bytes = new TextEncoder().encode(raw);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
        controller.close();
      },
    }),
  );
}

describe('streamDeepSeekMessage', () => {
  it('parses CRLF-framed events split across reads and forwards text deltas', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'ping' },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Héllo ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ];
    const raw = events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('');
    const deltas: string[] = [];
    let request: RequestInit | undefined;
    let url = '';
    const turn = await streamDeepSeekMessage({
      apiKey: 'k',
      body: { model: 'm', messages: [] },
      fetch: async (input, init) => {
        url = input;
        request = init;
        return sseResponse(raw, 3);
      },
      onText: (delta) => deltas.push(delta),
    });
    expect(deltas.join('')).toBe('Héllo world');
    expect(turn).toMatchObject({ stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 7 } });
    expect(turn.content).toEqual([{ type: 'text', text: 'Héllo world' }]);
    expect(JSON.parse(String(request!.body))).toMatchObject({ stream: true });
    expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(new Headers(request!.headers).get('x-api-key')).toBe('k');
  });

  it('turns HTTP and in-stream errors into DeepSeekApiError', async () => {
    await expect(
      streamDeepSeekMessage({
        apiKey: 'k',
        body: {},
        fetch: async () => new Response(JSON.stringify({ error: { type: 'rate_limit_error' } }), { status: 429 }),
      }),
    ).rejects.toMatchObject({ status: 429, errorType: 'rate_limit_error' });

    const raw = `data: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } })}\n\n`;
    await expect(streamDeepSeekMessage({ apiKey: 'k', body: {}, fetch: async () => sseResponse(raw) })).rejects.toBeInstanceOf(DeepSeekApiError);
  });
});

describe('streamDeepSeekMessage base URL', () => {
  it('honors a custom base URL', async () => {
    let url = '';
    await streamDeepSeekMessage({
      apiKey: 'k',
      baseUrl: 'https://proxy.example.com/anthropic/',
      body: {},
      fetch: async (input) => {
        url = input;
        return sseResponse(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      },
    });
    expect(url).toBe('https://proxy.example.com/anthropic/v1/messages');
  });
});

describe('assistant caps', () => {
  it('caps tool results sent to the model', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i, email: `user${i}@example.com` }));
    const text = toolResultForModel({ rows });
    expect(text.length).toBeLessThan(ASSISTANT_LIMITS.toolResultChars + 100);
    expect(text).toMatch(/truncated/);
  });

  it('folds a bounded history into the question as a transcript', () => {
    const long = 'x'.repeat(ASSISTANT_LIMITS.historyChars / 2);
    const question = questionForModel(
      [
        { id: '1', role: 'user', text: long, createdAt: 1 },
        { id: '2', role: 'assistant', blocks: [{ type: 'text', text: long }], status: 'complete', createdAt: 2 },
        { id: '3', role: 'user', text: 'short', createdAt: 3 },
        { id: '4', role: 'assistant', blocks: [{ type: 'text', text: 'answer' }], status: 'complete', createdAt: 4 },
      ],
      'next?',
    );
    expect(question).toBe('Earlier in this conversation:\n\nUser: short\n\nAssistant: answer\n\nNew question:\nnext?');
    expect(questionForModel([], 'first')).toBe('first');
  });

  it('summarizes long trend series instead of listing every point', () => {
    const labels = Array.from({ length: 200 }, (_, i) => `b${i}`);
    const summary = summarizeInsightResult({
      kind: 'trend',
      interval: 'hour',
      labels,
      formula: null,
      compare: null,
      series: [],
      startAt: 0,
      endAt: 1,
      results: [{ key: 'A', seriesIndex: 0, label: 'x', math: 'total', data: labels.map((_, i) => i), total: 19900 }],
    }) as { series: Array<Record<string, unknown>>; buckets: number };
    expect(summary.buckets).toBe(200);
    expect(summary.series[0]).toMatchObject({ total: 19900, min: 0, max: 199, last: 199 });
    expect(summary.series[0]).not.toHaveProperty('data');
  });
});
