import { createElement } from 'react';
import { Bar, BarStack, Line } from 'recharts';
import { describe, expect, it } from 'vitest';
import { niceSignedTicks, niceTicks, plottedRange } from './chartTicks';

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

describe('plottedRange', () => {
  const rows = [
    { x: 'a', up: 40, more: 30, down: -25, line: 50 },
    { x: 'b', up: 10, more: 5, down: -60, line: 20 },
  ];

  it('sums stacked series per row, positives and negatives apart', () => {
    const children = [
      createElement(Bar, { key: 'up', dataKey: 'up', stackId: 's' }),
      createElement(Bar, { key: 'more', dataKey: 'more', stackId: 's' }),
      createElement(Bar, { key: 'down', dataKey: 'down', stackId: 's' }),
    ];
    expect(plottedRange(rows, children)).toEqual({ min: -60, max: 70 });
  });

  it('treats the bars inside a BarStack as one stack', () => {
    const children = createElement(
      BarStack,
      null,
      createElement(Bar, { key: 'up', dataKey: 'up' }),
      createElement(Bar, { key: 'more', dataKey: 'more' }),
    );
    expect(plottedRange(rows, children)).toEqual({ min: 0, max: 70 });
  });

  it('reads unstacked series one by one and skips hidden ones', () => {
    const children = [
      createElement(Line, { key: 'line', dataKey: 'line' }),
      createElement(Bar, { key: 'up', dataKey: 'up', hide: true }),
    ];
    expect(plottedRange(rows, children)).toEqual({ min: 0, max: 50 });
  });

  it('gives up on function keys', () => {
    expect(plottedRange(rows, createElement(Line, { dataKey: (row: { line: number }) => row.line }))).toBeNull();
  });
});
