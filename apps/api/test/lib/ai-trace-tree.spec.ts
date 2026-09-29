import { describe, expect, it } from 'vitest';
import { buildTraceTree, flattenTraceTree, type TraceTreeEvent } from '../../src/lib/ai-trace-tree';

function ev(id: string, kind: string, spanId: string | null, parentId: string | null, startMs: number, endMs: number, extra: Partial<TraceTreeEvent> = {}): TraceTreeEvent {
  return { id, kind, spanId, parentId, startMs, endMs, costUsd: null, tokens: 0, isError: false, ...extra };
}

const ids = (nodes: Array<{ id: string }>) => nodes.map((node) => node.id);

describe('trace tree assembly', () => {
  it('nests spans and generations under the trace by parent id, ordered by start', () => {
    const root = buildTraceTree('t1', [
      ev('e-gen-late', 'generation', 'g2', 't1', 500, 900, { costUsd: 0.5, tokens: 30 }),
      ev('e-trace', 'trace', 't1', null, 0, 1000),
      ev('e-span', 'span', 's1', 't1', 100, 400),
      ev('e-gen', 'generation', 'g1', 's1', 150, 350, { costUsd: 0.25, tokens: 20, isError: true }),
    ]);
    expect(root.event?.id).toBe('e-trace');
    expect(ids(root.children)).toEqual(['s1', 'g2']);
    expect(ids(root.children[0]!.children)).toEqual(['g1']);
    expect(flattenTraceTree(root).map((node) => [node.id, node.depth])).toEqual([
      ['t1', 0],
      ['s1', 1],
      ['g1', 2],
      ['g2', 1],
    ]);
    expect(root.totals).toEqual({ costUsd: 0.75, tokens: 50, errors: 1, generations: 2 });
    expect(root.children[0]!.totals).toEqual({ costUsd: 0.25, tokens: 20, errors: 1, generations: 1 });
  });

  it('synthesizes a root spanning all events when no trace event was sent', () => {
    const root = buildTraceTree('t2', [ev('a', 'generation', null, null, 200, 300), ev('b', 'generation', null, null, 50, 120)]);
    expect(root.event).toBeNull();
    expect(root.id).toBe('t2');
    expect(ids(root.children)).toEqual(['b', 'a']);
    expect([root.startMs, root.endMs]).toEqual([50, 300]);
  });

  it('puts events with unknown parents under the root', () => {
    const root = buildTraceTree('t3', [ev('a', 'span', 's1', 'missing', 0, 10), ev('b', 'generation', 'g1', 's1', 1, 5)]);
    expect(ids(root.children)).toEqual(['s1']);
    expect(ids(root.children[0]!.children)).toEqual(['g1']);
  });

  it('breaks parent cycles and self-parents', () => {
    const root = buildTraceTree('t4', [
      ev('a', 'span', 'x', 'y', 0, 10),
      ev('b', 'span', 'y', 'x', 1, 10),
      ev('c', 'span', 'z', 'z', 2, 10),
    ]);
    const all = flattenTraceTree(root);
    expect(all).toHaveLength(4);
    expect(ids(root.children)).toContain('z');
    // Every node is reachable exactly once.
    expect(new Set(ids(all)).size).toBe(4);
  });

  it('keeps events that reuse a span id', () => {
    const root = buildTraceTree('t5', [ev('a', 'generation', 'dup', null, 0, 1), ev('b', 'generation', 'dup', null, 2, 3)]);
    expect(ids(root.children)).toEqual(['dup', 'dup#b']);
  });
});
