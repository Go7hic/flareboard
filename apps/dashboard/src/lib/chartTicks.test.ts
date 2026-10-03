import { describe, expect, it } from 'vitest';
import { niceSignedTicks, niceTicks } from './chartTicks';

describe('niceTicks', () => {
  it('steps by 1, 2 or 5 × 10^n', () => {
    expect(niceTicks(140)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe('niceSignedTicks', () => {
  it('keeps zero on a tick and covers negative stacks', () => {
    expect(niceSignedTicks(-30, 90)).toEqual([-50, 0, 50, 100]);
    expect(niceSignedTicks(0, 140)).toEqual(niceTicks(140));
  });
});
