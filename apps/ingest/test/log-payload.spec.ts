import { describe, expect, it } from 'vitest';
import { buildLogEventDataPayload } from '../src/routes/collect';

describe('log payload mapping', () => {
  it('keeps trace and span fields on log event data', () => {
    const payload = buildLogEventDataPayload({
      data: { custom: 'value' },
      message: 'Payment span failed',
      level: 'error',
      traceId: 'trace-ingest-1',
      spanId: 'span-payment',
      parentSpanId: 'span-root',
      service: 'payments',
      operation: 'POST /payments',
      durationMs: 240,
      status: 'error',
      release: '4.0.0',
      environment: 'production',
    });

    expect(payload).toEqual({
      custom: 'value',
      message: 'Payment span failed',
      level: 'error',
      traceId: 'trace-ingest-1',
      spanId: 'span-payment',
      parentSpanId: 'span-root',
      service: 'payments',
      operation: 'POST /payments',
      durationMs: 240,
      status: 'error',
      release: '4.0.0',
      environment: 'production',
    });
  });
});
