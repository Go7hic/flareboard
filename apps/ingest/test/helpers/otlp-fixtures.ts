/**
 * OTLP fixtures.
 *
 * - `SPEC_LOGS_JSON` / `SPEC_TRACE_JSON`: the examples shipped with opentelemetry-proto v1.3.2
 *   (`examples/logs.json`, `examples/trace.json`), verbatim.
 * - `PROTOBUF_LOGS_HEX` / `PROTOBUF_TRACE_HEX`: encoded by `protoc --encode` against the official
 *   v1.3.2 protos from the text messages below, so the decoder is checked against the reference
 *   encoder rather than against itself.
 */

export const SPEC_LOGS_JSON = {
  resourceLogs: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my.service' } }] },
      scopeLogs: [
        {
          scope: {
            name: 'my.library',
            version: '1.0.0',
            attributes: [{ key: 'my.scope.attribute', value: { stringValue: 'some scope attribute' } }],
          },
          logRecords: [
            {
              timeUnixNano: '1544712660300000000',
              observedTimeUnixNano: '1544712660300000000',
              severityNumber: 10,
              severityText: 'Information',
              traceId: '5B8EFFF798038103D269B633813FC60C',
              spanId: 'EEE19B7EC3C1B174',
              body: { stringValue: 'Example log record' },
              attributes: [
                { key: 'string.attribute', value: { stringValue: 'some string' } },
                { key: 'boolean.attribute', value: { boolValue: true } },
                { key: 'int.attribute', value: { intValue: '10' } },
                { key: 'double.attribute', value: { doubleValue: 637.704 } },
                {
                  key: 'array.attribute',
                  value: { arrayValue: { values: [{ stringValue: 'many' }, { stringValue: 'values' }] } },
                },
                {
                  key: 'map.attribute',
                  value: { kvlistValue: { values: [{ key: 'some.map.key', value: { stringValue: 'some value' } }] } },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const SPEC_TRACE_JSON = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my.service' } }] },
      scopeSpans: [
        {
          scope: {
            name: 'my.library',
            version: '1.0.0',
            attributes: [{ key: 'my.scope.attribute', value: { stringValue: 'some scope attribute' } }],
          },
          spans: [
            {
              traceId: '5B8EFFF798038103D269B633813FC60C',
              spanId: 'EEE19B7EC3C1B174',
              parentSpanId: 'EEE19B7EC3C1B173',
              name: "I'm a server span",
              startTimeUnixNano: '1544712660000000000',
              endTimeUnixNano: '1544712661000000000',
              kind: 2,
              attributes: [{ key: 'my.span.attr', value: { stringValue: 'some value' } }],
            },
          ],
        },
      ],
    },
  ],
};

/** Time of the spec examples, in ms (2018-12-13T14:51:00.3Z). */
export const SPEC_TIME_MS = 1544712660300;

/*
resource_logs {
  resource {
    attributes { key: "service.name" value { string_value: "checkout" } }
    attributes { key: "service.version" value { string_value: "2.4.1" } }
    attributes { key: "deployment.environment.name" value { string_value: "production" } }
    attributes { key: "host.name" value { string_value: "web-1" } }
  }
  scope_logs {
    scope { name: "checkout.logger" version: "1.0.0" }
    log_records {
      time_unix_nano: 1767225600123456789
      observed_time_unix_nano: 1767225600200000000
      severity_number: SEVERITY_NUMBER_ERROR
      severity_text: "ERROR"
      body { string_value: "Payment declined for order 42" }
      attributes { key: "session.id" value { string_value: "sess-123" } }
      attributes { key: "retry" value { bool_value: true } }
      attributes { key: "attempt" value { int_value: -3 } }
      attributes { key: "big" value { int_value: 9007199254740993 } }
      attributes { key: "ratio" value { double_value: 0.25 } }
      attributes { key: "tags" value { array_value { values { string_value: "a" } values { int_value: 7 } } } }
      attributes { key: "http" value { kvlist_value { values { key: "method" value { string_value: "POST" } } } } }
      attributes { key: "raw" value { bytes_value: "\x01\x02\xff" } }
      trace_id: "\x5b\x8e\xff\xf7\x98\x03\x81\x03\xd2\x69\xb6\x33\x81\x3f\xc6\x0c"
      span_id: "\xee\xe1\x9b\x7e\xc3\xc1\xb1\x74"
      flags: 1
    }
    log_records {
      time_unix_nano: 1767225601000000000
      severity_text: "warning"
      body { kvlist_value { values { key: "msg" value { string_value: "slow" } } } }
    }
  }
}
*/
export const PROTOBUF_LOGS_HEX =
  '0ac7030a7b0a1a0a0c736572766963652e6e616d65120a0a08636865636b6f75740a1a0a0f736572766963652e76657273696f6e12070a05322e342e310a2b0a1b6465706c6f796d656e742e656e7669726f6e6d656e742e6e616d65120c0a0a70726f64756374696f6e0a140a09686f73742e6e616d6512070a057765622d3112c7020a180a0f636865636b6f75742e6c6f676765721205312e302e301283020915cd55f55172861810111a054552524f522a1f0a1d5061796d656e74206465636c696e656420666f72206f7264657220343232180a0a73657373696f6e2e6964120a0a08736573732d313233320b0a0572657472791202100132160a07617474656d7074120b18fdffffffffffffffff0132100a03626967120918818080808080801032120a05726174696f120921000000000000d03f32130a0474616773120b2a090a030a01610a021807321c0a0468747470121432120a100a066d6574686f6412060a04504f5354320c0a0372617712053a030102ff45010000004a105b8efff798038103d269b633813fc60c5208eee19b7ec3c1b1745900c2e5f95172861812250900ca9429527286181a077761726e696e672a11320f0a0d0a036d736712060a04736c6f77';

/*
resource_spans {
  resource {
    attributes { key: "service.name" value { string_value: "checkout" } }
    attributes { key: "deployment.environment" value { string_value: "staging" } }
  }
  scope_spans {
    scope { name: "http" }
    spans {
      trace_id: "\x5b\x8e\xff\xf7\x98\x03\x81\x03\xd2\x69\xb6\x33\x81\x3f\xc6\x0c"
      span_id: "\xee\xe1\x9b\x7e\xc3\xc1\xb1\x73"
      name: "POST /checkout"
      kind: SPAN_KIND_SERVER
      start_time_unix_nano: 1767225600000000000
      end_time_unix_nano: 1767225600250500000
      attributes { key: "$session_id" value { string_value: "sess-123" } }
      events { time_unix_nano: 1767225600100000000 name: "exception" attributes { key: "exception.message" value { string_value: "boom" } } }
      status { code: STATUS_CODE_ERROR message: "declined" }
    }
    spans {
      trace_id: "\x5b\x8e\xff\xf7\x98\x03\x81\x03\xd2\x69\xb6\x33\x81\x3f\xc6\x0c"
      span_id: "\xee\xe1\x9b\x7e\xc3\xc1\xb1\x74"
      parent_span_id: "\xee\xe1\x9b\x7e\xc3\xc1\xb1\x73"
      name: "charge card"
      kind: SPAN_KIND_CLIENT
      start_time_unix_nano: 1767225600050000000
      end_time_unix_nano: 1767225600150000000
      links { trace_id: "\x00…\x01" span_id: "\x00…\x02" }
      status { code: STATUS_CODE_OK }
    }
  }
}
*/
export const PROTOBUF_TRACE_HEX =
  '0ad8020a410a1a0a0c736572766963652e6e616d65120a0a08636865636b6f75740a230a166465706c6f796d656e742e656e7669726f6e6d656e7412090a0773746167696e671292020a060a0468747470129c010a105b8efff798038103d269b633813fc60c1208eee19b7ec3c1b1732a0e504f5354202f636865636b6f75743002390000faed5172861841a053e8fc517286184a190a0b2473657373696f6e5f6964120a0a08736573732d3132335a310900e1eff3517286181209657863657074696f6e1a1b0a11657863657074696f6e2e6d65737361676512060a04626f6f6d7a0c12086465636c696e6564180212690a105b8efff798038103d269b633813fc60c1208eee19b7ec3c1b1742208eee19b7ec3c1b1732a0b636861726765206361726430033980f0f4f0517286184180d1eaf6517286186a1c0a1000000000000000000000000000000001120800000000000000027a021801';

/** 2026-01-01T00:00:00Z, the protobuf fixtures' base time, in ms. */
export const PROTOBUF_TIME_MS = 1767225600000;

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// A tiny protobuf writer for route tests that need timestamps relative to "now". Independent of
// the decoder under test; the golden fixtures above cover conformance with protoc.

type Part = number[];

function varint(value: number | bigint): Part {
  const out: number[] = [];
  let v = BigInt.asUintN(64, BigInt(value));
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

export const pb = {
  len(field: number, bytes: Part | Uint8Array): Part {
    const data = Array.from(bytes);
    return [...varint(field * 8 + 2), ...varint(data.length), ...data];
  },
  str(field: number, value: string): Part {
    return pb.len(field, new TextEncoder().encode(value));
  },
  varint(field: number, value: number | bigint): Part {
    return [...varint(field * 8), ...varint(value)];
  },
  fixed64(field: number, value: bigint): Part {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    return [...varint(field * 8 + 1), ...bytes];
  },
  hex(field: number, value: string): Part {
    return pb.len(field, fromHex(value));
  },
  concat(...parts: Part[]): Part {
    return parts.flat();
  },
};

/** ExportLogsServiceRequest with one resource (service.name) and the given LogRecord bodies. */
export function protobufLogsRequest(service: string, records: Part[]): Uint8Array {
  const resource = pb.len(1, pb.len(1, pb.concat(pb.str(1, 'service.name'), pb.len(2, pb.str(1, service)))));
  const scopeLogs = pb.len(2, pb.concat(...records.map((record) => pb.len(2, record))));
  return new Uint8Array(pb.len(1, pb.concat(resource, scopeLogs)));
}
