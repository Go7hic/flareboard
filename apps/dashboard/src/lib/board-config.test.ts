import { describe, expect, it } from 'vitest';
import {
  createBoardParameters,
  moveWidget,
  parseBoardConfig,
  parseBoardUrlState,
  sizeForFraction,
  withBoardWidgets,
} from './board-config';

describe('board config', () => {
  it('reads legacy widths and saved filters', () => {
    const config = parseBoardConfig({
      rangePreset: '30d',
      filters: [{ type: 'dimension', key: 'country', operator: 'is', value: ['US'] }],
      widgets: [
        { type: 'stats', websiteId: 'w', width: 'third' },
        { type: 'insight', insightId: 'i', width: 'half', result: { kind: 'trend' } },
      ],
    });
    expect(config.rangePreset).toBe('30d');
    expect(config.filters).toHaveLength(1);
    expect(config.widgets.map((w) => w.width)).toEqual(['small', 'medium']);
  });

  it('saves layout without run data', () => {
    const params = withBoardWidgets({ rangePreset: '7d', filters: [] }, [
      { type: 'insight', insightId: 'i', width: 'large', result: { kind: 'trend' } },
    ]);
    expect(params).toEqual({ rangePreset: '7d', filters: [], widgets: [{ type: 'insight', insightId: 'i', width: 'large' }] });
    expect(createBoardParameters([{ type: 'stats', websiteId: '', label: '', width: 'small' }])).toMatchObject({ widgets: [] });
  });

  it('moves widgets and snaps pointer resizes to sizes', () => {
    expect(moveWidget(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveWidget(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(sizeForFraction(0.3)).toBe('small');
    expect(sizeForFraction(0.55)).toBe('medium');
    expect(sizeForFraction(0.7)).toBe('large');
    expect(sizeForFraction(0.95)).toBe('full');
  });

  it('parses URL state and ignores malformed filters', () => {
    const filters = encodeURIComponent(JSON.stringify([{ type: 'person', key: 'plan', operator: 'is', value: ['pro'] }]));
    expect(parseBoardUrlState(new URLSearchParams(`range=90d&filters=${filters}`))).toEqual({
      rangePreset: '90d',
      filters: [{ type: 'person', key: 'plan', operator: 'is', value: ['pro'] }],
    });
    expect(parseBoardUrlState(new URLSearchParams('range=5y&filters=%7B'))).toEqual({});
  });
});
