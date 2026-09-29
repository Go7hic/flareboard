import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStorage } from './helpers/fake-browser';
import { createRecorderEnv, RecEl, WEBSITE_ID } from './helpers/fake-recorder-env';

type MaskFn = (text: string, el?: RecEl) => string;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('recorder.js consent', () => {
  it('records a visit and posts chunks with the tracker session and visit ids', async () => {
    const env = createRecorderEnv();
    env.run();
    await settle(5000);
    expect(env.rrweb.options).not.toBeNull();
    expect(env.chunks).toHaveLength(1);
    expect(env.chunks[0]).toMatchObject({ website: WEBSITE_ID, sessionId: 'session-1', visitId: 'visit-1', chunkIndex: 0 });
    expect(env.chunks[0]!.events.map((event) => event.type)).toEqual([4, 2]);
  });

  it('does not record visitors who opted out through the tracker', async () => {
    const env = createRecorderEnv({ localStorage: new FakeStorage({ 'flareboard.opt_out': '1' }) });
    env.run();
    await settle(10_000);
    expect(env.rrweb.options).toBeNull();
    expect(env.configRequests).toHaveLength(0);
    expect(env.chunks).toHaveLength(0);
  });

  it('stops and discards unsent events when the visitor opts out during the visit', async () => {
    const env = createRecorderEnv();
    env.run();
    await settle(5000);
    expect(env.chunks).toHaveLength(1);
    env.rrweb.options!.emit({ type: 3, data: { source: 2, type: 2 }, timestamp: Date.now() });
    env.localStorage.setItem('flareboard.opt_out', '1');
    await settle(5000);
    env.pagehide();
    expect(env.rrweb.stopped).toBe(1);
    expect(env.chunks).toHaveLength(1);
  });

  it('honors Do Not Track when the website respects it', async () => {
    const env = createRecorderEnv({ doNotTrack: '1', config: { websiteId: WEBSITE_ID, respectDnt: true, replay: {} } });
    env.run();
    await settle(5000);
    expect(env.rrweb.options).toBeNull();
  });

  it('honors data-respect-dnt on the tracker tag and ignores DNT otherwise', async () => {
    const withTag = createRecorderEnv({ doNotTrack: '1', otherScripts: [{ 'data-respect-dnt': '' }] });
    withTag.run();
    await settle(5000);
    expect(withTag.rrweb.options).toBeNull();

    const without = createRecorderEnv({ doNotTrack: '1' });
    without.run();
    await settle(5000);
    expect(without.rrweb.options).not.toBeNull();
  });

  it('records nothing for visits outside the sample', async () => {
    const env = createRecorderEnv({ replay: { sampleRate: 0 } });
    env.run();
    await settle(5000);
    expect(env.rrweb.options).toBeNull();
    expect(env.sessionStorage.getItem('flareboard.rec.sample.visit-1')).toBe('0');
  });

  it('holds the first chunk until the minimum duration and drops shorter visits', async () => {
    const short = createRecorderEnv({ replay: { minDurationMs: 10_000 } });
    short.run();
    await settle(5000);
    short.pagehide();
    expect(short.chunks).toHaveLength(0);

    const long = createRecorderEnv({ replay: { minDurationMs: 10_000 } });
    long.run();
    await settle(5000);
    expect(long.chunks).toHaveLength(0);
    await settle(5000);
    expect(long.chunks).toHaveLength(1);
    expect(long.chunks[0]!.events.map((event) => event.type)).toEqual([4, 2]);
  });
});

describe('recorder.js masking and blocking', () => {
  it('masks every input by default, whatever the element', async () => {
    const env = createRecorderEnv();
    env.run();
    await settle();
    const options = env.rrweb.options as unknown as { maskAllInputs: boolean; maskInputFn: MaskFn };
    expect(options.maskAllInputs).toBe(true);
    expect(options.maskInputFn('hello', new RecEl('input', { type: 'text', name: 'city' }))).toBe('*****');
    expect(options.maskInputFn('hello')).toBe('*****');
  });

  it('keeps sensitive fields masked when the website turned input masking off', async () => {
    const env = createRecorderEnv({ replay: { maskInputs: false, maskSelector: '.private' } });
    env.run();
    await settle();
    const { maskInputFn } = env.rrweb.options as unknown as { maskInputFn: MaskFn };
    expect(maskInputFn('Berlin', new RecEl('input', { type: 'text', name: 'city' }))).toBe('Berlin');
    expect(maskInputFn('hunter2', new RecEl('input', { type: 'password' }))).toBe('*******');
    expect(maskInputFn('4242', new RecEl('input', { autocomplete: 'cc-number' }))).toBe('****');
    expect(maskInputFn('123456', new RecEl('input', { name: 'otp_code' }))).toBe('******');
    const form = new RecEl('form', { 'data-fb-mask': '' });
    expect(maskInputFn('secret', form.append(new RecEl('input', { name: 'note' })))).toBe('******');
    const custom = new RecEl('div', { class: 'private' });
    expect(maskInputFn('x', custom.append(new RecEl('input')))).toBe('*');
    // No element (older rrweb): mask.
    expect(maskInputFn('abc')).toBe('***');
  });

  it('blocks the built-in no-capture elements plus the website selectors, dropping invalid ones', async () => {
    const valid = createRecorderEnv({ replay: { blockSelector: '#payment', maskSelector: '.pii' } });
    valid.run();
    await settle();
    const options = valid.rrweb.options as unknown as { blockSelector: string; maskTextSelector: string };
    expect(options.blockSelector).toBe('[data-fb-no-capture],.ph-no-capture,[data-fb-block],.fb-block,.ph-block,#payment');
    expect(options.maskTextSelector).toBe('[data-fb-mask],.fb-mask,.ph-mask,.pii');

    const invalid = createRecorderEnv({ replay: { blockSelector: 'div[[', maskSelector: '!!' } });
    invalid.run();
    await settle();
    const fallback = invalid.rrweb.options as unknown as { blockSelector: string; maskTextSelector: string };
    expect(fallback.blockSelector).toBe('[data-fb-no-capture],.ph-no-capture,[data-fb-block],.fb-block,.ph-block');
    expect(fallback.maskTextSelector).toBe('[data-fb-mask],.fb-mask,.ph-mask');
  });

  it('masks all text when the website asks for it', async () => {
    const env = createRecorderEnv({ replay: { maskAllText: true } });
    env.run();
    await settle();
    expect((env.rrweb.options as unknown as { maskTextSelector: string }).maskTextSelector).toBe('*');
  });

  it('uses the safe defaults when tracker-config cannot be loaded', async () => {
    const env = createRecorderEnv({ config: null });
    env.run();
    await settle(5000);
    const options = env.rrweb.options as unknown as { maskInputFn: MaskFn };
    expect(options.maskInputFn('abc', new RecEl('input'))).toBe('***');
    env.window.console.error('boom');
    await settle(5000);
    expect(env.custom('$console')).toHaveLength(0);
  });
});

describe('recorder.js console capture', () => {
  it('leaves console alone unless the website opted in', async () => {
    const env = createRecorderEnv();
    const before = env.window.console.log;
    env.run();
    await settle();
    expect(env.window.console.log).toBe(before);
  });

  it('records level and a scrubbed, truncated message, and still calls the real console', async () => {
    const env = createRecorderEnv({ replay: { console: true } });
    env.run();
    await settle();
    env.window.console.error('Login failed for jane@example.com', { password: 'hunter2' });
    env.window.console.warn('card 4242 4242 4242 4242 via https://api.example.test/pay?token=abc#x');
    env.window.console.log('x'.repeat(5000));
    env.window.emit('error', { message: 'ReferenceError: foo is not defined' });
    await settle(5000);

    const entries = env.custom('$console').map((event) => event.data!.payload!);
    expect(entries[0]).toEqual({ level: 'error', message: 'Login failed for [email] {"password":"[redacted]"}' });
    expect(entries[1]).toEqual({ level: 'warn', message: 'card [number] via https://api.example.test/pay' });
    expect((entries[2]!.message as string).length).toBeLessThanOrEqual(1001);
    expect(entries[3]).toEqual({ level: 'error', message: 'Uncaught ReferenceError: foo is not defined' });
    expect(env.consoleCalls.map(([level]) => level)).toEqual(['error', 'warn', 'log']);
  });
});

describe('recorder.js network capture', () => {
  it('records method, URL without query, status, duration and size, never the ingest itself', async () => {
    const env = createRecorderEnv({
      replay: { network: true },
      pageFetch: (url) => (url.includes('/missing') ? { status: 404 } : url.includes('/down') ? new Error('offline') : { status: 200 }),
    });
    env.run();
    await settle();
    await env.window.fetch('https://api.example.test/users/42?email=jane@example.com#top', { method: 'post' });
    await env.window.fetch('/missing');
    await env.window.fetch('https://api.example.test/down').catch(() => undefined);
    await env.window.fetch('https://api.example.test/reset/abcdefghijklmnopqrstuvwxyz0123');
    await env.window.fetch('https://t.example.test/api/send');
    const xhr = new env.window.XMLHttpRequest();
    xhr.open('GET', 'https://api.example.test/cart?id=9');
    xhr.send();
    xhr.finish(500);
    await settle(5000);

    const entries = env.custom('$network').map((event) => event.data!.payload!);
    expect(entries).toEqual([
      { method: 'POST', url: 'https://api.example.test/users/42', status: 200, duration: 0, size: 321, failed: false },
      { method: 'GET', url: 'https://shop.example.test/missing', status: 404, duration: 0, size: 321, failed: false },
      { method: 'GET', url: 'https://api.example.test/down', status: 0, duration: 0, size: 321, failed: true },
      { method: 'GET', url: 'https://api.example.test/reset/:redacted', status: 200, duration: 0, size: 321, failed: false },
      { method: 'GET', url: 'https://api.example.test/cart', status: 500, duration: 0, size: 321, failed: false },
    ]);
    expect(env.pageRequests).toContain('https://t.example.test/api/send');
  });
});
