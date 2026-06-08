import { describe, expect, it } from 'vitest';
import { extractWebVitals, sendSchema } from './schemas';

const website = '550e8400-e29b-41d4-a716-446655440000';

describe('extractWebVitals', () => {
  it('reads top-level vitals', () => {
    expect(
      extractWebVitals({
        lcp: 848,
        inp: 40,
        cls: 0.1382,
        fcp: 556,
        ttfb: 283,
      }),
    ).toEqual({
      lcp: 848,
      inp: 40,
      cls: 0.1382,
      fcp: 556,
      ttfb: 283,
    });
  });

  it('falls back to payload.data when top-level fields are missing', () => {
    expect(
      extractWebVitals({
        data: { lcp: 848, inp: 40, cls: 0.1382, fcp: 556, ttfb: 283 },
      }),
    ).toEqual({
      lcp: 848,
      inp: 40,
      cls: 0.1382,
      fcp: 556,
      ttfb: 283,
    });
  });

  it('merges top-level and data (top-level wins)', () => {
    expect(
      extractWebVitals({
        inp: 40,
        data: { lcp: 848, cls: 0.1382, fcp: 556, ttfb: 283 },
      }),
    ).toEqual({
      lcp: 848,
      inp: 40,
      cls: 0.1382,
      fcp: 556,
      ttfb: 283,
    });
  });

  it('coerces string vitals from sendSchema', () => {
    const parsed = sendSchema.parse({
      type: 'performance',
      payload: {
        website,
        url: '/',
        lcp: '848',
        inp: '40',
        cls: '0.1382',
        fcp: '556',
        ttfb: '283',
        width: '1920x1080',
      },
    });
    if (parsed.type !== 'performance') throw new Error('expected performance');
    expect(extractWebVitals(parsed.payload)).toEqual({
      lcp: 848,
      inp: 40,
      cls: 0.1382,
      fcp: 556,
      ttfb: 283,
    });
  });
});
