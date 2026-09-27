import { describe, expect, it } from 'vitest';
import { parseEventTimestamp } from '../../src/routes/collect';

const NOW = Date.UTC(2026, 8, 27, 12);

describe('parseEventTimestamp', () => {
  it('accepts seconds and milliseconds within the window', () => {
    expect(parseEventTimestamp(NOW / 1000 - 60, NOW)?.getTime()).toBe(NOW - 60_000);
    expect(parseEventTimestamp(NOW - 60_000, NOW)?.getTime()).toBe(NOW - 60_000);
  });

  it('falls back to server time for implausible values', () => {
    expect(parseEventTimestamp(1, NOW)).toBeNull();
    expect(parseEventTimestamp(NOW / 1000 + 3600, NOW)).toBeNull();
    expect(parseEventTimestamp(NOW / 1000 - 365 * 86400, NOW)).toBeNull();
  });
});
