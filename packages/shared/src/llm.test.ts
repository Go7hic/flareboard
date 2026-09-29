import { describe, expect, it } from 'vitest';
import {
  AI_CONTENT_MAX_BYTES,
  aiContentProperties,
  inputIncludesCache,
  isTruncatedAiContent,
  LLM_PRICE_TABLE,
  lookupModelPrice,
  normalizeModelId,
  serializeAiContent,
  usageCostUsd,
} from './llm';

describe('model ids', () => {
  it('strips router, Bedrock and Vertex decorations', () => {
    expect(normalizeModelId('anthropic/claude-3.5-sonnet')).toBe('claude-3-5-sonnet');
    expect(normalizeModelId('us.anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('claude-3-5-sonnet-20241022');
    expect(normalizeModelId('claude-3-5-sonnet@20240620')).toBe('claude-3-5-sonnet');
    expect(normalizeModelId('models/gemini-1.5-pro')).toBe('gemini-1.5-pro');
    expect(normalizeModelId(' GPT-4o ')).toBe('gpt-4o');
    // Version-like suffixes of other vendors are part of the id.
    expect(normalizeModelId('deepseek-v3')).toBe('deepseek-v3');
  });

  it('finds dated snapshots and aliases, and never guesses', () => {
    expect(lookupModelPrice('gpt-4o-mini-2024-07-18')?.price).toMatchObject({ input: 0.15, output: 0.6 });
    expect(lookupModelPrice('claude-sonnet-4-20250514')?.model).toBe('claude-sonnet-4-0');
    expect(lookupModelPrice('claude-3-5-sonnet-latest')?.model).toBe('claude-3-5-sonnet');
    expect(lookupModelPrice('mistral-large-latest')?.price.input).toBe(2);
    // The first gpt-4o snapshot kept its launch price.
    expect(lookupModelPrice('gpt-4o-2024-05-13')?.price).toMatchObject({ input: 5, output: 15 });
    expect(lookupModelPrice('gpt-4o-audio-preview')).toBeNull();
    expect(lookupModelPrice('my-finetune')).toBeNull();
    expect(lookupModelPrice('')).toBeNull();
    expect(lookupModelPrice(null)).toBeNull();
  });

  it('prefers the website override', () => {
    const overrides = new Map([['gpt-4o', { input: 1, output: 2 }], ['my-finetune', { input: 3, output: 4 }]]);
    expect(lookupModelPrice('gpt-4o-2024-08-06', overrides)).toMatchObject({ source: 'override', price: { input: 1 } });
    expect(lookupModelPrice('My-Finetune', overrides)).toMatchObject({ source: 'override', price: { input: 3 } });
    expect(lookupModelPrice('gpt-4.1', overrides)?.source).toBe('builtin');
  });

  it('has one entry per model id and sane numbers', () => {
    const ids = LLM_PRICE_TABLE.flatMap((entry) => [entry.model, ...(entry.aliases ?? [])]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of LLM_PRICE_TABLE) {
      expect(entry.model).toBe(entry.model.toLowerCase());
      expect(entry.input).toBeGreaterThan(0);
      expect(entry.output).toBeGreaterThanOrEqual(0);
      if (entry.cacheRead != null) expect(entry.cacheRead).toBeLessThanOrEqual(entry.input);
    }
  });
});

describe('cost', () => {
  const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) => ({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });

  it('prices plain input and output per million tokens', () => {
    const price = lookupModelPrice('gpt-4o')!.price;
    // 1000 * 2.5 / 1e6 + 500 * 10 / 1e6
    expect(usageCostUsd(usage(1000, 500), price, true)).toBeCloseTo(0.0075, 10);
  });

  it('OpenAI: cached tokens are part of the input count', () => {
    const price = lookupModelPrice('gpt-4o')!.price;
    // 800 regular at 2.5 + 200 cached at 1.25 + 100 output at 10
    expect(usageCostUsd(usage(1000, 100, 200), price, true)).toBeCloseTo((800 * 2.5 + 200 * 1.25 + 100 * 10) / 1e6, 12);
  });

  it('Anthropic: cache reads and writes come on top of the input count', () => {
    const price = lookupModelPrice('claude-sonnet-4-5')!.price;
    const cost = usageCostUsd(usage(1000, 100, 5000, 2000), price, false);
    expect(cost).toBeCloseTo((1000 * 3 + 5000 * 0.3 + 2000 * 3.75 + 100 * 15) / 1e6, 12);
  });

  it('charges cached tokens at the input price when the cache price is unknown', () => {
    expect(usageCostUsd(usage(1000, 0, 400), { input: 1, output: 2 }, true)).toBeCloseTo(1000 / 1e6, 12);
  });

  it('knows which providers count cache inside the input', () => {
    expect(inputIncludesCache('anthropic', 'claude-3-5-sonnet')).toBe(false);
    expect(inputIncludesCache('openai', 'gpt-4o')).toBe(true);
    // Claude through an OpenAI-compatible router reports OpenAI-style usage.
    expect(inputIncludesCache('openrouter', 'anthropic/claude-3.5-sonnet')).toBe(true);
    expect(inputIncludesCache(null, 'claude-3-5-sonnet-20241022')).toBe(false);
    expect(inputIncludesCache(undefined, 'gemini-2.0-flash')).toBe(true);
  });
});

describe('content', () => {
  it('keeps strings, serializes JSON and drops empty values', () => {
    expect(serializeAiContent('hello')).toBe('hello');
    expect(serializeAiContent([{ role: 'user', content: 'hi' }])).toBe('[{"role":"user","content":"hi"}]');
    expect(serializeAiContent('')).toBeUndefined();
    expect(serializeAiContent(null)).toBeUndefined();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(serializeAiContent(cyclic)).toBeUndefined();
  });

  it('truncates large payloads at a character boundary with a marker', () => {
    const big = 'é'.repeat(AI_CONTENT_MAX_BYTES); // 2 bytes each
    const out = serializeAiContent(big)!;
    expect(isTruncatedAiContent(out)).toBe(true);
    expect(out).toContain(`${AI_CONTENT_MAX_BYTES * 2} bytes`);
    const kept = out.slice(0, out.indexOf('\n…['));
    expect(new TextEncoder().encode(kept).length).toBe(AI_CONTENT_MAX_BYTES);
    expect(kept).not.toContain('�');
    expect(isTruncatedAiContent(serializeAiContent('short')!)).toBe(false);
  });

  it('keeps the JSON-escaped size in bounds for quote-heavy payloads', () => {
    const quotes = '"'.repeat(AI_CONTENT_MAX_BYTES * 2);
    const out = serializeAiContent(quotes)!;
    expect(isTruncatedAiContent(out)).toBe(true);
    expect(out).toContain(`${AI_CONTENT_MAX_BYTES * 2} bytes`);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(AI_CONTENT_MAX_BYTES * 1.25);
  });

  it('stores content only when the website allows it', () => {
    expect(aiContentProperties('q', { a: 1 }, true)).toEqual({ aiInput: 'q', aiOutput: '{"a":1}' });
    expect(aiContentProperties('q', { a: 1 }, false)).toEqual({ aiContentOmitted: true });
    expect(aiContentProperties(undefined, undefined, false)).toEqual({});
  });
});
