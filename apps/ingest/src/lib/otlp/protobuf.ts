/**
 * Minimal protobuf decoder for the two OTLP/HTTP request messages Flareboard accepts
 * (`ExportLogsServiceRequest`, `ExportTraceServiceRequest`, opentelemetry-proto v1).
 *
 * It decodes into the OTLP/JSON shape (lowerCamelCase keys, trace/span ids as lowercase hex,
 * 64-bit integers and timestamps as decimal strings, `bytesValue` as base64), so one normalizer
 * handles both encodings. Unknown fields are skipped, as the protobuf spec requires. Only the
 * fields listed in the schemas below are read; nothing else in the OTLP protos is needed.
 */

export class ProtobufError extends Error {}

type FieldType =
  | 'string'
  | 'bytes' // base64, like the JSON mapping of `bytes`
  | 'id' // bytes rendered as lowercase hex (trace and span ids, per the OTLP/JSON spec)
  | 'bool'
  | 'int64' // decimal string (varint, two's complement)
  | 'uint32'
  | 'enum'
  | 'double'
  | 'fixed64' // decimal string (unsigned)
  | 'fixed32'
  | 'message';

type Field = { name: string; type: FieldType; repeated?: boolean; message?: string };
type Schema = Record<number, Field>;

const f = (name: string, type: FieldType, extra: Partial<Field> = {}): Field => ({ name, type, ...extra });
const msg = (name: string, message: string, repeated = false): Field => ({ name, type: 'message', message, repeated });

const SCHEMAS: Record<string, Schema> = {
  AnyValue: {
    1: f('stringValue', 'string'),
    2: f('boolValue', 'bool'),
    3: f('intValue', 'int64'),
    4: f('doubleValue', 'double'),
    5: msg('arrayValue', 'ArrayValue'),
    6: msg('kvlistValue', 'KeyValueList'),
    7: f('bytesValue', 'bytes'),
  },
  ArrayValue: { 1: msg('values', 'AnyValue', true) },
  KeyValueList: { 1: msg('values', 'KeyValue', true) },
  KeyValue: { 1: f('key', 'string'), 2: msg('value', 'AnyValue') },
  Resource: { 1: msg('attributes', 'KeyValue', true), 2: f('droppedAttributesCount', 'uint32') },
  InstrumentationScope: {
    1: f('name', 'string'),
    2: f('version', 'string'),
    3: msg('attributes', 'KeyValue', true),
    4: f('droppedAttributesCount', 'uint32'),
  },

  ExportLogsServiceRequest: { 1: msg('resourceLogs', 'ResourceLogs', true) },
  ResourceLogs: { 1: msg('resource', 'Resource'), 2: msg('scopeLogs', 'ScopeLogs', true), 3: f('schemaUrl', 'string') },
  ScopeLogs: { 1: msg('scope', 'InstrumentationScope'), 2: msg('logRecords', 'LogRecord', true), 3: f('schemaUrl', 'string') },
  LogRecord: {
    1: f('timeUnixNano', 'fixed64'),
    11: f('observedTimeUnixNano', 'fixed64'),
    2: f('severityNumber', 'enum'),
    3: f('severityText', 'string'),
    5: msg('body', 'AnyValue'),
    6: msg('attributes', 'KeyValue', true),
    7: f('droppedAttributesCount', 'uint32'),
    8: f('flags', 'fixed32'),
    9: f('traceId', 'id'),
    10: f('spanId', 'id'),
    12: f('eventName', 'string'),
  },

  ExportTraceServiceRequest: { 1: msg('resourceSpans', 'ResourceSpans', true) },
  ResourceSpans: { 1: msg('resource', 'Resource'), 2: msg('scopeSpans', 'ScopeSpans', true), 3: f('schemaUrl', 'string') },
  ScopeSpans: { 1: msg('scope', 'InstrumentationScope'), 2: msg('spans', 'Span', true), 3: f('schemaUrl', 'string') },
  Span: {
    1: f('traceId', 'id'),
    2: f('spanId', 'id'),
    3: f('traceState', 'string'),
    4: f('parentSpanId', 'id'),
    16: f('flags', 'fixed32'),
    5: f('name', 'string'),
    6: f('kind', 'enum'),
    7: f('startTimeUnixNano', 'fixed64'),
    8: f('endTimeUnixNano', 'fixed64'),
    9: msg('attributes', 'KeyValue', true),
    10: f('droppedAttributesCount', 'uint32'),
    11: msg('events', 'SpanEvent', true),
    12: f('droppedEventsCount', 'uint32'),
    13: msg('links', 'SpanLink', true),
    14: f('droppedLinksCount', 'uint32'),
    15: msg('status', 'Status'),
  },
  SpanEvent: {
    1: f('timeUnixNano', 'fixed64'),
    2: f('name', 'string'),
    3: msg('attributes', 'KeyValue', true),
    4: f('droppedAttributesCount', 'uint32'),
  },
  SpanLink: {
    1: f('traceId', 'id'),
    2: f('spanId', 'id'),
    3: f('traceState', 'string'),
    4: msg('attributes', 'KeyValue', true),
    5: f('droppedAttributesCount', 'uint32'),
    6: f('flags', 'fixed32'),
  },
  Status: { 2: f('message', 'string'), 3: f('code', 'enum') },
};

/** AnyValue can nest (arrays of maps of arrays…); real payloads stay shallow. */
const MAX_DEPTH = 32;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

const utf8 = new TextDecoder('utf-8');
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

class Reader {
  pos: number;
  private readonly view: DataView;

  constructor(
    private readonly buf: Uint8Array,
    start: number,
    readonly end: number,
  ) {
    this.pos = start;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Varints up to 2^53 (tags, lengths, enums, counts). */
  uint(): number {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new ProtobufError('Truncated varint');
      const byte = this.buf[this.pos++]!;
      result += (byte & 0x7f) * multiplier;
      if (byte < 0x80) {
        if (result > Number.MAX_SAFE_INTEGER) throw new ProtobufError('Varint out of range');
        return result;
      }
      multiplier *= 128;
    }
    throw new ProtobufError('Malformed varint');
  }

  /** Full 64-bit varint, as an unsigned BigInt. */
  uint64(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new ProtobufError('Truncated varint');
      const byte = this.buf[this.pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return BigInt.asUintN(64, result);
      shift += 7n;
    }
    throw new ProtobufError('Malformed varint');
  }

  need(bytes: number) {
    if (bytes < 0 || this.pos + bytes > this.end) throw new ProtobufError('Truncated field');
  }

  fixed64(): bigint {
    this.need(8);
    const value = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return value;
  }

  fixed32(): number {
    this.need(4);
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  double(): number {
    this.need(8);
    const value = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return value;
  }

  bytes(): Uint8Array {
    const length = this.uint();
    this.need(length);
    const out = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  skip(wireType: number) {
    switch (wireType) {
      case WIRE_VARINT:
        this.uint64();
        return;
      case WIRE_FIXED64:
        this.need(8);
        this.pos += 8;
        return;
      case WIRE_LEN:
        this.bytes();
        return;
      case WIRE_FIXED32:
        this.need(4);
        this.pos += 4;
        return;
      default:
        // Groups (3/4) are not used by OTLP; anything else is corrupt input.
        throw new ProtobufError(`Unsupported wire type ${wireType}`);
    }
  }
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX[byte];
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function expectWire(field: Field, wireType: number, expected: number) {
  if (wireType !== expected) throw new ProtobufError(`Field ${field.name} has wire type ${wireType}, expected ${expected}`);
}

function readScalar(reader: Reader, field: Field, wireType: number): unknown {
  switch (field.type) {
    case 'string':
      expectWire(field, wireType, WIRE_LEN);
      return utf8.decode(reader.bytes());
    case 'bytes':
      expectWire(field, wireType, WIRE_LEN);
      return toBase64(reader.bytes());
    case 'id':
      expectWire(field, wireType, WIRE_LEN);
      return toHex(reader.bytes());
    case 'bool':
      expectWire(field, wireType, WIRE_VARINT);
      return reader.uint64() !== 0n;
    case 'int64':
      expectWire(field, wireType, WIRE_VARINT);
      return BigInt.asIntN(64, reader.uint64()).toString();
    case 'uint32':
    case 'enum':
      expectWire(field, wireType, WIRE_VARINT);
      // Enums are int32 on the wire; negative values arrive as 10-byte varints.
      return Number(BigInt.asIntN(32, reader.uint64()));
    case 'double':
      expectWire(field, wireType, WIRE_FIXED64);
      return reader.double();
    case 'fixed64':
      expectWire(field, wireType, WIRE_FIXED64);
      return reader.fixed64().toString();
    case 'fixed32':
      expectWire(field, wireType, WIRE_FIXED32);
      return reader.fixed32();
    default:
      throw new ProtobufError(`Unexpected field type ${field.type}`);
  }
}

function decodeMessage(buf: Uint8Array, start: number, end: number, schemaName: string, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH) throw new ProtobufError('Message nested too deeply');
  const schema = SCHEMAS[schemaName];
  if (!schema) throw new ProtobufError(`Unknown message ${schemaName}`);
  const reader = new Reader(buf, start, end);
  const out: Record<string, unknown> = {};
  while (reader.pos < reader.end) {
    const tag = reader.uint();
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (fieldNumber === 0) throw new ProtobufError('Invalid field number 0');
    const field = schema[fieldNumber];
    if (!field) {
      reader.skip(wireType);
      continue;
    }
    let value: unknown;
    if (field.type === 'message') {
      expectWire(field, wireType, WIRE_LEN);
      const length = reader.uint();
      reader.need(length);
      value = decodeMessage(buf, reader.pos, reader.pos + length, field.message!, depth + 1);
      reader.pos += length;
    } else {
      value = readScalar(reader, field, wireType);
    }
    if (field.repeated) {
      const list = (out[field.name] as unknown[] | undefined) ?? [];
      list.push(value);
      out[field.name] = list;
    } else {
      // Last one wins for singular fields (protobuf merge semantics).
      out[field.name] = value;
    }
  }
  if (reader.pos !== reader.end) throw new ProtobufError('Field overruns its message');
  return out;
}

export type OtlpMessage = 'ExportLogsServiceRequest' | 'ExportTraceServiceRequest';

/** Decodes an OTLP request body into its OTLP/JSON-shaped object. Throws ProtobufError on corrupt input. */
export function decodeOtlpProtobuf(bytes: Uint8Array, message: OtlpMessage): Record<string, unknown> {
  return decodeMessage(bytes, 0, bytes.length, message, 0);
}

// Encoding: only the small response messages OTLP/HTTP servers send back.

function encodeVarint(value: number | bigint, out: number[]) {
  let v = BigInt.asUintN(64, BigInt(value));
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
}

function encodeString(fieldNumber: number, value: string, out: number[]) {
  const bytes = new TextEncoder().encode(value);
  encodeVarint(fieldNumber * 8 + WIRE_LEN, out);
  encodeVarint(bytes.length, out);
  for (const byte of bytes) out.push(byte);
}

/**
 * `Export{Logs,Trace}ServiceResponse`: empty on full success, else `partial_success` (field 1)
 * holding the rejected count (field 1) and an error message (field 2).
 */
export function encodeExportResponse(rejected: number, errorMessage: string): Uint8Array {
  if (!rejected && !errorMessage) return new Uint8Array();
  const inner: number[] = [];
  if (rejected) {
    encodeVarint(1 * 8 + WIRE_VARINT, inner);
    encodeVarint(rejected, inner);
  }
  if (errorMessage) encodeString(2, errorMessage, inner);
  const out: number[] = [];
  encodeVarint(1 * 8 + WIRE_LEN, out);
  encodeVarint(inner.length, out);
  out.push(...inner);
  return new Uint8Array(out);
}

/** `google.rpc.Status` for error responses: code (field 1) and message (field 2). */
export function encodeRpcStatus(code: number, message: string): Uint8Array {
  const out: number[] = [];
  if (code) {
    encodeVarint(1 * 8 + WIRE_VARINT, out);
    encodeVarint(code, out);
  }
  if (message) encodeString(2, message, out);
  return new Uint8Array(out);
}
