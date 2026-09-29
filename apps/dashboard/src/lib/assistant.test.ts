import { describe, expect, it } from 'vitest';
import { applyStreamEvent, type LiveAnswer } from './assistant';

describe('applyStreamEvent', () => {
  it('builds the live answer from streamed text and tool events', () => {
    let live: LiveAnswer = { blocks: [] };
    live = applyStreamEvent(live, { type: 'text', delta: 'Let me ' });
    live = applyStreamEvent(live, { type: 'text', delta: 'check.' });
    live = applyStreamEvent(live, { type: 'tool_start', id: 't1', name: 'run_sql', input: { sql: 'SELECT 1' } });
    expect(live.blocks[1]).toMatchObject({ type: 'tool', id: 't1', pending: true });
    live = applyStreamEvent(live, {
      type: 'tool_result',
      id: 't1',
      name: 'run_sql',
      ok: true,
      display: { kind: 'table', title: 'SQL', columns: ['n'], rows: [{ n: 1 }], truncated: false },
    });
    live = applyStreamEvent(live, { type: 'text', delta: 'One row.' });
    expect(live.blocks).toEqual([
      { type: 'text', text: 'Let me check.' },
      {
        type: 'tool',
        id: 't1',
        name: 'run_sql',
        input: { sql: 'SELECT 1' },
        ok: true,
        display: { kind: 'table', title: 'SQL', columns: ['n'], rows: [{ n: 1 }], truncated: false },
      },
      { type: 'text', text: 'One row.' },
    ]);
  });

  it('ignores events that do not change the answer', () => {
    const live: LiveAnswer = { blocks: [{ type: 'text', text: 'x' }] };
    expect(applyStreamEvent(live, { type: 'error', message: 'nope' })).toBe(live);
  });
});
