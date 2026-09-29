import { describe, expect, it } from 'vitest';
import { sanitizeReplayChunk, stripUrl } from '../../src/lib/replay-events';

const click = { type: 3, data: { source: 2, type: 2, id: 1, x: 1, y: 1 }, timestamp: 1 };
const mouseDown = { type: 3, data: { source: 2, type: 1, id: 1, x: 1, y: 1 }, timestamp: 2 };
const input = { type: 3, data: { source: 5, id: 2, text: '***' }, timestamp: 3 };
const consoleError = {
  type: 5,
  timestamp: 4,
  data: { tag: '$console', payload: { level: 'error', message: 'boom', stack: 'secret stack', extra: { a: 1 } } },
};
const consoleWarn = { type: 5, timestamp: 5, data: { tag: '$console', payload: { level: 'warn', message: 'careful' } } };
const consoleOdd = { type: 5, timestamp: 6, data: { tag: '$console', payload: { level: 'trace', message: 'x'.repeat(3000) } } };
const network = {
  type: 5,
  timestamp: 7,
  data: {
    tag: '$network',
    payload: {
      method: 'post',
      url: 'https://api.example.test/pay?card=4242#x',
      status: 502,
      duration: 12.4,
      size: 100,
      failed: false,
      requestHeaders: { authorization: 'Bearer abc' },
      body: '{"card":"4242"}',
    },
  },
};
const otherCustom = { type: 5, timestamp: 8, data: { tag: 'checkout', payload: { step: 2 } } };

describe('sanitizeReplayChunk', () => {
  it('drops console and network entries unless the website opted in', () => {
    const { events, counts } = sanitizeReplayChunk([click, consoleError, network, otherCustom], {
      console: false,
      network: false,
    });
    expect(events).toEqual([click, otherCustom]);
    expect(counts).toMatchObject({ clickCount: 1, consoleErrorCount: 0, networkErrorCount: 0 });
  });

  it('keeps only allowlisted fields and counts activity', () => {
    const { events, counts } = sanitizeReplayChunk(
      [click, mouseDown, input, consoleError, consoleWarn, consoleOdd, network],
      { console: true, network: true },
    );
    expect(counts).toEqual({
      clickCount: 1,
      inputCount: 1,
      consoleLogCount: 1,
      consoleWarnCount: 1,
      consoleErrorCount: 1,
      networkErrorCount: 1,
    });
    expect(events[3]).toEqual({ type: 5, timestamp: 4, data: { tag: '$console', payload: { level: 'error', message: 'boom' } } });
    const odd = events[5] as { data: { payload: { level: string; message: string } } };
    expect(odd.data.payload.level).toBe('log');
    expect(odd.data.payload.message.length).toBe(1001);
    expect(events[6]).toEqual({
      type: 5,
      timestamp: 7,
      data: {
        tag: '$network',
        payload: { method: 'POST', url: 'https://api.example.test/pay', status: 502, duration: 12, size: 100, failed: false },
      },
    });
  });

  it('strips query strings and fragments from URLs', () => {
    expect(stripUrl('/a/b?c=d')).toBe('/a/b');
    expect(stripUrl('https://x.test/p#frag')).toBe('https://x.test/p');
    expect(stripUrl('https://x.test/p')).toBe('https://x.test/p');
  });
});
