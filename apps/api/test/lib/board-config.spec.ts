import { describe, expect, it } from 'vitest';
import {
  boardConfigToDrafts,
  createBoardParameters,
  parseBoardConfig,
} from '../../../../apps/dashboard/src/lib/board-config';

describe('board config helpers', () => {
  it('serializes a board-level time range and widget layout', () => {
    const parameters = createBoardParameters(
      [
        { type: 'stats', websiteId: 'site_1', label: 'Traffic', width: 'full' },
        { type: 'insight', insightId: 'insight_1', label: 'Activation', width: 'half' },
      ],
      '30d',
    );

    expect(parameters).toEqual({
      rangePreset: '30d',
      widgets: [
        { type: 'stats', websiteId: 'site_1', label: 'Traffic', width: 'full' },
        { type: 'insight', insightId: 'insight_1', label: 'Activation', width: 'half' },
      ],
    });
  });

  it('parses legacy board widgets with safe defaults', () => {
    const config = parseBoardConfig({
      widgets: [
        { type: 'stats', websiteId: 'site_1' },
        { type: 'insight', insightId: 'insight_1', width: 'huge' },
        { type: 'title', text: 'Ignored legacy heading' },
        { type: 'unknown', websiteId: 'bad' },
      ],
    });

    expect(config.rangePreset).toBe('7d');
    expect(config.widgets).toEqual([
      { type: 'stats', websiteId: 'site_1', width: 'half' },
      { type: 'insight', insightId: 'insight_1', width: 'half' },
    ]);
    expect(boardConfigToDrafts(config)).toEqual([
      { type: 'stats', websiteId: 'site_1', label: '', width: 'half' },
      { type: 'insight', insightId: 'insight_1', label: '', width: 'half' },
    ]);
  });
});
