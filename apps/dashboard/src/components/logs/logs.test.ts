import { describe, expect, it } from 'vitest';
import type { LogTraceSpan } from '../../lib/api';
import {
  appendLogFilterParams,
  EMPTY_LOG_FILTERS,
  filtersFromSaved,
  filtersToSaved,
  parseAttributeInput,
} from './log-filters';
import { waterfallRows } from './trace-tree';

function span(spanId: string, parentSpanId: string | null, startUs: number): LogTraceSpan {
  return {
    id: spanId,
    source: 'otlp',
    traceId: 't',
    spanId,
    parentSpanId,
    name: spanId,
    kind: 'internal',
    service: null,
    release: null,
    environment: null,
    createdAt: Math.floor(startUs / 1000),
    startUs,
    durationUs: 10,
    durationMs: 0,
    status: 'unset',
    statusMessage: null,
    sessionId: null,
    attributes: null,
    resource: null,
    events: [],
    links: [],
  };
}

describe('log filters', () => {
  it('serializes to the API query parameters', () => {
    const params = appendLogFilterParams(new URLSearchParams(), {
      ...EMPTY_LOG_FILTERS,
      levels: ['error', 'fatal'],
      search: '  timeout ',
      source: 'otlp',
      attributes: [{ key: 'http.method', value: 'POST' }, { key: 'user.id' }],
    });
    expect(params.toString()).toBe('level=error%2Cfatal&q=timeout&source=otlp&attr=http.method%3DPOST&attr=user.id');
  });

  it('parses attribute input', () => {
    expect(parseAttributeInput('status = 500')).toEqual({ key: 'status', value: '500' });
    expect(parseAttributeInput('url=/a?b=c')).toEqual({ key: 'url', value: '/a?b=c' });
    expect(parseAttributeInput('user.id')).toEqual({ key: 'user.id' });
    expect(parseAttributeInput('=x')).toBeNull();
    expect(parseAttributeInput('  ')).toBeNull();
  });

  it('round-trips saved filters', () => {
    const filters = { ...EMPTY_LOG_FILTERS, levels: ['warn' as const], service: 'api', attributes: [{ key: 'k', value: 'v' }] };
    expect(filtersFromSaved(filtersToSaved(filters))).toEqual(filters);
  });
});

describe('span waterfall order', () => {
  it('puts children under their parent, orphans and cycles at the root', () => {
    const rows = waterfallRows([
      span('child-b', 'root', 30),
      span('root', null, 0),
      span('child-a', 'root', 10),
      span('grandchild', 'child-a', 15),
      span('orphan', 'missing', 5),
      span('loop-1', 'loop-2', 50),
      span('loop-2', 'loop-1', 60),
    ]);
    expect(rows.map((row) => [row.span.spanId, row.depth])).toEqual([
      ['root', 0],
      ['child-a', 1],
      ['grandchild', 2],
      ['child-b', 1],
      ['orphan', 0],
      ['loop-1', 0],
      ['loop-2', 0],
    ]);
  });
});
