import { describe, expect, it } from 'vitest';
import {
  activeItemIndex,
  buildTimeline,
  formatPlayerTime,
  inactivePeriods,
  linkAtTime,
  parseStartParam,
  replayBounds,
  timelineMarkers,
} from './replay-timeline';

const T0 = 1_700_000_000_000;

const EVENTS = [
  { type: 4, timestamp: T0, data: { href: 'https://shop.test/pricing?plan=pro' } },
  { type: 2, timestamp: T0 + 1, data: {} },
  { type: 3, timestamp: T0 + 1000, data: { source: 2, type: 2 } },
  { type: 5, timestamp: T0 + 2000, data: { tag: '$console', payload: { level: 'error', message: 'boom' } } },
  {
    type: 5,
    timestamp: T0 + 3000,
    data: { tag: '$network', payload: { method: 'POST', url: 'https://api.test/cart', status: 500, duration: 120, size: 2048, failed: false } },
  },
  { type: 5, timestamp: T0 + 3500, data: { tag: '$console', payload: { level: 'log', message: 'hello' } } },
  { type: 3, timestamp: T0 + 20_000, data: { source: 1 } },
  { type: 3, timestamp: T0 + 21_000, data: { source: 0 } },
];

describe('replay timeline', () => {
  it('computes the recording bounds', () => {
    expect(replayBounds(EVENTS)).toEqual({ startTime: T0, endTime: T0 + 21_000, totalMs: 21_000 });
    expect(replayBounds([])).toEqual({ startTime: 0, endTime: 0, totalMs: 0 });
  });

  it('builds console, network, page and analytics entries in time order', () => {
    const items = buildTimeline(EVENTS, [
      { id: 'e1', eventType: 2, eventName: 'add_to_cart', urlPath: '/pricing', createdAt: T0 + 2500 },
      { id: 'e2', eventType: 1, urlPath: '/pricing', createdAt: T0 },
      { id: 'e3', eventType: 6, createdAt: T0 + 100 },
      { id: 'e4', eventType: 2, eventName: 'too_late', createdAt: T0 + 90_000 },
    ]);
    expect(items.map((item) => [item.kind, item.offsetMs, item.severity, item.label])).toEqual([
      ['page', 0, 'info', '/pricing?plan=pro'],
      ['console', 2000, 'error', 'boom'],
      ['event', 2500, 'info', 'add_to_cart'],
      ['network', 3000, 'error', 'POST https://api.test/cart'],
      ['console', 3500, 'info', 'hello'],
    ]);
    expect(items[3]!.detail).toBe('500 · 120 ms · 2.0 kB');
    expect(timelineMarkers(items).map((item) => item.kind)).toEqual(['page', 'console', 'event', 'network']);
  });

  it('finds inactive stretches longer than five seconds', () => {
    // Console / network entries and DOM mutations are not user activity.
    expect(inactivePeriods(EVENTS)).toEqual([[1000, 20_000]]);
  });

  it('highlights the last entry at or before the playhead', () => {
    const items = buildTimeline(EVENTS);
    expect(activeItemIndex(items, 0)).toBe(0);
    expect(activeItemIndex(items, 2500)).toBe(1);
    expect(activeItemIndex(items, 99_000)).toBe(items.length - 1);
    expect(activeItemIndex([], 10)).toBe(-1);
  });

  it('formats times and links at a timestamp', () => {
    expect(formatPlayerTime(0)).toBe('0:00');
    expect(formatPlayerTime(65_400)).toBe('1:05');
    expect(formatPlayerTime(3_725_000)).toBe('1:02:05');
    expect(linkAtTime('https://app.test/shared/replay/abc', 83_900)).toBe('https://app.test/shared/replay/abc?t=83');
    expect(linkAtTime('https://app.test/r?visit=v&t=9', 0)).toBe('https://app.test/r?visit=v');
    expect(parseStartParam('83')).toBe(83_000);
    expect(parseStartParam('nope')).toBe(0);
    expect(parseStartParam(null)).toBe(0);
  });
});
