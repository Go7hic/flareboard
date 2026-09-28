import { describe, expect, it } from 'vitest';
import { FLAG_HASH_JS, flagBucketingId, flagHash, rolloutBucket, variantBucket } from './flag-hash';

// The tracker script embeds FLAG_HASH_JS; this proves it computes exactly what the server does.
const trackerHashFlag = new Function(`${FLAG_HASH_JS}; return hashFlag;`)() as (value: string) => number;

describe('flag bucketing parity', () => {
  it('the tracker JS and the TypeScript hash agree on many inputs', () => {
    for (let i = 0; i < 2000; i++) {
      const input = `flag-${i % 37}:${i}-${'x'.repeat(i % 11)}-用户${i}`;
      expect(trackerHashFlag(input)).toBe(flagHash(input));
    }
  });

  it('buckets stay within 0-99 and use the documented key formats', () => {
    expect(rolloutBucket('beta', 'user-1')).toBe(flagHash('beta:user-1'));
    expect(variantBucket('beta', 'user-1')).toBe(flagHash('beta:variant:user-1'));
    for (let i = 0; i < 500; i++) {
      const bucket = rolloutBucket('k', `id-${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it('prefers the distinct id, then user, anonymous, session and visit ids', () => {
    expect(flagBucketingId({ distinctId: 'd', userId: 'u', sessionId: 's' })).toBe('d');
    expect(flagBucketingId({ userId: 'u', sessionId: 's' })).toBe('u');
    expect(flagBucketingId({ anonymousId: 'a', sessionId: 's' })).toBe('a');
    expect(flagBucketingId({ sessionId: 's', visitId: 'v' })).toBe('s');
    expect(flagBucketingId({})).toBe('anonymous');
  });
});
