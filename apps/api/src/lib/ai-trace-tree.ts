/**
 * Trace tree assembly for LLM analytics: trace → spans → generations, from flat AI events that
 * point at their parent by span id. Pure, so it is unit-tested without storage.
 */

export type TraceTreeEvent = {
  id: string;
  kind: string;
  spanId: string | null;
  parentId: string | null;
  startMs: number;
  endMs: number;
  costUsd: number | null;
  tokens: number;
  isError: boolean;
};

export type TraceTreeNode<T extends TraceTreeEvent> = {
  /** Span id (or event id when the event has none); the trace id for the root. */
  id: string;
  /** Null for a synthetic root (no `$ai_trace` event was sent). */
  event: T | null;
  depth: number;
  startMs: number;
  endMs: number;
  /** This node and everything under it. */
  totals: { costUsd: number; tokens: number; errors: number; generations: number };
  children: Array<TraceTreeNode<T>>;
};

function node<T extends TraceTreeEvent>(id: string, event: T | null): TraceTreeNode<T> {
  return {
    id,
    event,
    depth: 0,
    startMs: event?.startMs ?? Number.POSITIVE_INFINITY,
    endMs: event?.endMs ?? Number.NEGATIVE_INFINITY,
    totals: { costUsd: 0, tokens: 0, errors: 0, generations: 0 },
    children: [],
  };
}

/**
 * Builds the tree of one trace. The first `trace` event is the root (else a synthetic root named
 * by the trace id). Every other event hangs under the node whose span id equals its parent id;
 * an unknown parent, a missing parent or a parent cycle puts it directly under the root.
 * Children are ordered by start time; the root spans all of its descendants.
 */
export function buildTraceTree<T extends TraceTreeEvent>(traceId: string, events: readonly T[]): TraceTreeNode<T> {
  const rootEvent = events.find((event) => event.kind === 'trace') ?? null;
  const root = node(traceId, rootEvent);
  const byId = new Map<string, TraceTreeNode<T>>([[traceId, root]]);
  const nodes: Array<TraceTreeNode<T>> = [];
  for (const event of events) {
    if (event === rootEvent) continue;
    let id = event.spanId ?? event.id;
    // Span ids are meant to be unique; a repeated one keeps the first and falls back to event ids.
    if (byId.has(id)) id = `${id}#${event.id}`;
    const child = node(id, event);
    byId.set(id, child);
    nodes.push(child);
  }

  const parentOf = new Map<TraceTreeNode<T>, TraceTreeNode<T>>();
  for (const child of nodes) {
    const parentId = child.event!.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    parentOf.set(child, parent && parent !== child ? parent : root);
  }
  // Re-attach nodes whose ancestry loops without reaching the root.
  for (const child of nodes) {
    const seen = new Set<TraceTreeNode<T>>([child]);
    let current = parentOf.get(child)!;
    while (current !== root) {
      if (seen.has(current)) {
        parentOf.set(child, root);
        break;
      }
      seen.add(current);
      current = parentOf.get(current)!;
    }
  }
  for (const child of nodes) parentOf.get(child)!.children.push(child);

  const finish = (current: TraceTreeNode<T>, depth: number) => {
    current.depth = depth;
    current.children.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
    const event = current.event;
    if (event) {
      const call = event.kind === 'generation' || event.kind === 'embedding';
      current.totals.costUsd += call ? (event.costUsd ?? 0) : 0;
      current.totals.tokens += call ? event.tokens : 0;
      current.totals.errors += event.isError ? 1 : 0;
      current.totals.generations += call ? 1 : 0;
    }
    for (const child of current.children) {
      finish(child, depth + 1);
      current.totals.costUsd += child.totals.costUsd;
      current.totals.tokens += child.totals.tokens;
      current.totals.errors += child.totals.errors;
      current.totals.generations += child.totals.generations;
      current.startMs = Math.min(current.startMs, child.startMs);
      current.endMs = Math.max(current.endMs, child.endMs);
    }
  };
  finish(root, 0);
  if (!Number.isFinite(root.startMs)) root.startMs = root.endMs = 0;
  return root;
}

/** Depth-first rows of a tree, for a waterfall. */
export function flattenTraceTree<T extends TraceTreeEvent>(root: TraceTreeNode<T>): Array<TraceTreeNode<T>> {
  const out: Array<TraceTreeNode<T>> = [];
  const walk = (current: TraceTreeNode<T>) => {
    out.push(current);
    current.children.forEach(walk);
  };
  walk(root);
  return out;
}
