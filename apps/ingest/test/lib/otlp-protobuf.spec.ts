import { describe, expect, it } from 'vitest';
import { normalizeLogs, normalizeSpans } from '../../src/lib/otlp/normalize';
import {
  decodeOtlpProtobuf,
  encodeExportResponse,
  encodeRpcStatus,
  ProtobufError,
} from '../../src/lib/otlp/protobuf';
import {
  fromHex,
  pb,
  PROTOBUF_LOGS_HEX,
  PROTOBUF_TIME_MS,
  PROTOBUF_TRACE_HEX,
} from '../helpers/otlp-fixtures';

describe('OTLP protobuf decoder', () => {
  it('decodes a protoc-encoded ExportLogsServiceRequest into the OTLP/JSON shape', () => {
    const decoded = decodeOtlpProtobuf(fromHex(PROTOBUF_LOGS_HEX), 'ExportLogsServiceRequest');
    const resourceLogs = (decoded.resourceLogs as Array<Record<string, any>>)[0]!;
    expect(resourceLogs.resource.attributes[0]).toEqual({ key: 'service.name', value: { stringValue: 'checkout' } });
    const scopeLogs = resourceLogs.scopeLogs[0];
    expect(scopeLogs.scope).toEqual({ name: 'checkout.logger', version: '1.0.0' });
    const [first, second] = scopeLogs.logRecords;
    expect(first).toMatchObject({
      timeUnixNano: '1767225600123456789',
      observedTimeUnixNano: '1767225600200000000',
      severityNumber: 17,
      severityText: 'ERROR',
      body: { stringValue: 'Payment declined for order 42' },
      traceId: '5b8efff798038103d269b633813fc60c',
      spanId: 'eee19b7ec3c1b174',
      flags: 1,
    });
    expect(first.attributes).toEqual([
      { key: 'session.id', value: { stringValue: 'sess-123' } },
      { key: 'retry', value: { boolValue: true } },
      { key: 'attempt', value: { intValue: '-3' } },
      { key: 'big', value: { intValue: '9007199254740993' } },
      { key: 'ratio', value: { doubleValue: 0.25 } },
      { key: 'tags', value: { arrayValue: { values: [{ stringValue: 'a' }, { intValue: '7' }] } } },
      { key: 'http', value: { kvlistValue: { values: [{ key: 'method', value: { stringValue: 'POST' } }] } } },
      { key: 'raw', value: { bytesValue: 'AQL/' } },
    ]);
    expect(second).toEqual({
      timeUnixNano: '1767225601000000000',
      severityText: 'warning',
      body: { kvlistValue: { values: [{ key: 'msg', value: { stringValue: 'slow' } }] } },
    });
  });

  it('maps decoded protobuf logs to rows like JSON', async () => {
    const decoded = decodeOtlpProtobuf(fromHex(PROTOBUF_LOGS_HEX), 'ExportLogsServiceRequest');
    const { rows, rejected } = await normalizeLogs(decoded, PROTOBUF_TIME_MS + 5000);
    expect(rejected).toBe(0);
    expect(rows[0]).toMatchObject({
      createdAt: PROTOBUF_TIME_MS + 123,
      timeUs: (PROTOBUF_TIME_MS + 123) * 1000 + 456,
      severity: 'error',
      severityNumber: 17,
      severityText: 'ERROR',
      body: 'Payment declined for order 42',
      service: 'checkout',
      serviceVersion: '2.4.1',
      environment: 'production',
      scope: 'checkout.logger@1.0.0',
      traceId: '5b8efff798038103d269b633813fc60c',
      spanId: 'eee19b7ec3c1b174',
      sessionId: 'sess-123',
    });
    expect(JSON.parse(rows[0]!.attributes!)).toEqual({
      'session.id': 'sess-123',
      retry: true,
      attempt: -3,
      big: '9007199254740993',
      ratio: 0.25,
      tags: ['a', 7],
      http: { method: 'POST' },
      raw: 'AQL/',
    });
    expect(JSON.parse(rows[0]!.resource!)).toEqual({ 'host.name': 'web-1' });
    expect(rows[1]).toMatchObject({ severity: 'warn', severityNumber: 0, body: '{"msg":"slow"}' });
  });

  it('decodes a protoc-encoded ExportTraceServiceRequest', async () => {
    const decoded = decodeOtlpProtobuf(fromHex(PROTOBUF_TRACE_HEX), 'ExportTraceServiceRequest');
    const spans = (decoded.resourceSpans as Array<Record<string, any>>)[0]!.scopeSpans[0].spans;
    expect(spans[0]).toMatchObject({
      traceId: '5b8efff798038103d269b633813fc60c',
      spanId: 'eee19b7ec3c1b173',
      name: 'POST /checkout',
      kind: 2,
      startTimeUnixNano: '1767225600000000000',
      endTimeUnixNano: '1767225600250500000',
      status: { code: 2, message: 'declined' },
    });
    expect(spans[1].links).toEqual([{ traceId: '00000000000000000000000000000001', spanId: '0000000000000002' }]);

    const { rows } = await normalizeSpans(decoded, PROTOBUF_TIME_MS + 5000);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      traceId: '5b8efff798038103d269b633813fc60c',
      spanId: 'eee19b7ec3c1b173',
      parentSpanId: null,
      kind: 'server',
      service: 'checkout',
      environment: 'staging',
      scope: 'http',
      createdAt: PROTOBUF_TIME_MS,
      durationUs: 250_500,
      statusCode: 'error',
      statusMessage: 'declined',
      sessionId: 'sess-123',
    });
    expect(JSON.parse(rows[0]!.events!)).toEqual([
      { name: 'exception', timeUs: (PROTOBUF_TIME_MS + 100) * 1000, attributes: { 'exception.message': 'boom' } },
    ]);
    expect(rows[1]).toMatchObject({ parentSpanId: 'eee19b7ec3c1b173', kind: 'client', statusCode: 'ok', durationUs: 100_000 });
  });

  it('skips unknown fields of every wire type', () => {
    const record = pb.concat(
      pb.varint(99, 5),
      pb.fixed64(98, 1n),
      pb.str(97, 'ignored'),
      [0xf5, 0x06, 1, 2, 3, 4], // field 110, fixed32
      pb.str(3, 'INFO'),
    );
    const bytes = new Uint8Array(pb.len(1, pb.len(2, pb.len(2, record))));
    const decoded = decodeOtlpProtobuf(bytes, 'ExportLogsServiceRequest');
    expect(decoded).toEqual({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ severityText: 'INFO' }] }] }] });
  });

  it('rejects corrupt input', () => {
    const valid = fromHex(PROTOBUF_LOGS_HEX);
    expect(() => decodeOtlpProtobuf(valid.subarray(0, valid.length - 3), 'ExportLogsServiceRequest')).toThrow(ProtobufError);
    // Field 1 (resource_logs) must be length-delimited.
    expect(() => decodeOtlpProtobuf(new Uint8Array([0x08, 0x01]), 'ExportLogsServiceRequest')).toThrow(ProtobufError);
    // Deprecated group wire type.
    expect(() => decodeOtlpProtobuf(new Uint8Array([0x0b]), 'ExportLogsServiceRequest')).toThrow(ProtobufError);
    // Varint that never terminates.
    expect(() => decodeOtlpProtobuf(new Uint8Array([0x0a, 0xff, 0xff, 0xff]), 'ExportLogsServiceRequest')).toThrow(ProtobufError);

    // AnyValue nested far too deep (array in array in …).
    let value: number[] = pb.str(1, 'x');
    for (let i = 0; i < 40; i++) value = pb.len(5, pb.len(1, value));
    const deep = new Uint8Array(pb.len(1, pb.len(2, pb.len(2, pb.len(5, value)))));
    expect(() => decodeOtlpProtobuf(deep, 'ExportLogsServiceRequest')).toThrow(/nested too deeply/);
  });

  it('decodes an empty body as an empty request', () => {
    expect(decodeOtlpProtobuf(new Uint8Array(), 'ExportTraceServiceRequest')).toEqual({});
  });

  it('encodes export responses and rpc status', () => {
    expect(Array.from(encodeExportResponse(0, ''))).toEqual([]);
    // partial_success { rejected = 3, error_message = "x" }
    expect(Array.from(encodeExportResponse(3, 'x'))).toEqual([0x0a, 0x05, 0x08, 0x03, 0x12, 0x01, 0x78]);
    // Status { code = 16, message = "no" }
    expect(Array.from(encodeRpcStatus(16, 'no'))).toEqual([0x08, 0x10, 0x12, 0x02, 0x6e, 0x6f]);
  });
});
