import { describe, expect, it } from 'vitest';
import { sendPayloadSchema } from './schemas';

describe('sendPayloadSchema', () => {
  it('truncates long page context instead of rejecting the event', () => {
    const longUrl = `/landing?gclid=${'x'.repeat(900)}`;
    const parsed = sendPayloadSchema.safeParse({
      website: '2b8a1f0e-4c3d-4e5f-9a1b-2c3d4e5f6a7b',
      url: longUrl,
      referrer: `https://mail.example/redirect?u=${'y'.repeat(900)}`,
      title: 't'.repeat(700),
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.url).toBe(longUrl.slice(0, 500));
    expect(parsed.data.referrer).toHaveLength(500);
    expect(parsed.data.title).toHaveLength(500);
  });
});
