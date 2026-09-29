import type { LogTraceSpan } from '../../lib/api';

export type WaterfallRow = { span: LogTraceSpan; depth: number };

/** Parent-before-child order with depths; spans whose parent is missing start at the root. */
export function waterfallRows(spans: LogTraceSpan[]): WaterfallRow[] {
  const ids = new Set(spans.map((span) => span.spanId));
  const children = new Map<string | null, LogTraceSpan[]>();
  for (const span of spans) {
    const parent = span.parentSpanId && ids.has(span.parentSpanId) && span.parentSpanId !== span.spanId ? span.parentSpanId : null;
    children.set(parent, [...(children.get(parent) ?? []), span]);
  }
  const rows: WaterfallRow[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const span of (children.get(parent) ?? []).sort((a, b) => a.startUs - b.startUs)) {
      if (seen.has(span.spanId)) continue;
      seen.add(span.spanId);
      rows.push({ span, depth });
      visit(span.spanId, depth + 1);
    }
  };
  visit(null, 0);
  // Cycles in bad data: list whatever was not reached.
  for (const span of spans) if (!seen.has(span.spanId)) rows.push({ span, depth: 0 });
  return rows;
}
