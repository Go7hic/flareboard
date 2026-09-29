import { describe, expect, it } from 'vitest';
import {
  normalizeId,
  normalizeLogs,
  normalizeSeverity,
  normalizeSpans,
  OTLP_LIMITS,
  OtlpPayloadError,
} from '../../src/lib/otlp/normalize';
import { SPEC_LOGS_JSON, SPEC_TIME_MS, SPEC_TRACE_JSON } from '../helpers/otlp-fixtures';

const NOW = Date.UTC(2026, 8, 29, 12);

function logsRequest(records: unknown[], resourceAttributes: unknown[] = []) {
  return { resourceLogs: [{ resource: { attributes: resourceAttributes }, scopeLogs: [{ logRecords: records }] }] };
}

function nanos(ms: number) {
  return `${BigInt(ms) * 1_000_000n}`;
}

describe('OTLP log mapping', () => {
  it('maps the OpenTelemetry spec example (examples/logs.json)', async () => {
    const { rows, rejected, reasons } = await normalizeLogs(SPEC_LOGS_JSON, SPEC_TIME_MS + 1000);
    expect(rejected).toBe(0);
    expect(reasons).toEqual([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      createdAt: SPEC_TIME_MS,
      timeUs: SPEC_TIME_MS * 1000,
      severity: 'info',
      severityNumber: 10,
      severityText: 'Information',
      body: 'Example log record',
      service: 'my.service',
      serviceVersion: null,
      environment: null,
      scope: 'my.library@1.0.0',
      traceId: '5b8efff798038103d269b633813fc60c',
      spanId: 'eee19b7ec3c1b174',
      sessionId: null,
      resource: null,
    });
    expect(row!.logId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(row!.attributes!)).toEqual({
      'string.attribute': 'some string',
      'boolean.attribute': true,
      'int.attribute': 10,
      'double.attribute': 637.704,
      'array.attribute': ['many', 'values'],
      'map.attribute': { 'some.map.key': 'some value' },
    });
  });

  it('derives stable ids so a retried batch is not stored twice, but keeps identical lines apart', async () => {
    const record = { timeUnixNano: nanos(NOW), body: { stringValue: 'same line' } };
    const first = await normalizeLogs(logsRequest([record, record]), NOW);
    const retry = await normalizeLogs(logsRequest([record, record]), NOW + 60_000);
    expect(first.rows.map((row) => row.logId)).toEqual(retry.rows.map((row) => row.logId));
    expect(new Set(first.rows.map((row) => row.logId)).size).toBe(2);
  });

  it('maps severity numbers, texts and defaults', () => {
    expect([1, 4, 5, 9, 13, 16, 17, 21, 24].map((n) => normalizeSeverity(n, null))).toEqual([
      'trace',
      'trace',
      'debug',
      'info',
      'warn',
      'warn',
      'error',
      'fatal',
      'fatal',
    ]);
    expect(normalizeSeverity(0, 'WARNING')).toBe('warn');
    expect(normalizeSeverity(0, 'Error2')).toBe('error');
    expect(normalizeSeverity(0, 'critical')).toBe('fatal');
    expect(normalizeSeverity(0, 'whatever')).toBe('info');
    expect(normalizeSeverity(0, null)).toBe('info');
    // The number wins over the text.
    expect(normalizeSeverity(18, 'info')).toBe('error');
  });

  it('accepts enum names for severity numbers', async () => {
    const { rows } = await normalizeLogs(logsRequest([{ timeUnixNano: nanos(NOW), severityNumber: 'SEVERITY_NUMBER_WARN2' }]), NOW);
    expect(rows[0]).toMatchObject({ severity: 'warn', severityNumber: 14 });
  });

  it('maps resource attributes and session ids', async () => {
    const { rows } = await normalizeLogs(
      logsRequest(
        [
          { timeUnixNano: nanos(NOW), attributes: [{ key: '$session_id', value: { stringValue: 'from-record' } }] },
          { timeUnixNano: nanos(NOW) },
        ],
        [
          { key: 'service.name', value: { stringValue: 'api' } },
          { key: 'service.version', value: { stringValue: '1.2.3' } },
          { key: 'deployment.environment', value: { stringValue: 'staging' } },
          { key: 'session.id', value: { stringValue: 'from-resource' } },
          { key: 'cloud.region', value: { stringValue: 'eu' } },
        ],
      ),
      NOW,
    );
    expect(rows[0]).toMatchObject({ service: 'api', serviceVersion: '1.2.3', environment: 'staging', sessionId: 'from-record' });
    expect(rows[1]!.sessionId).toBe('from-resource');
    expect(JSON.parse(rows[0]!.resource!)).toEqual({ 'session.id': 'from-resource', 'cloud.region': 'eu' });
  });

  it('uses the observed time, then the receive time, when the record has no timestamp', async () => {
    const { rows } = await normalizeLogs(
      logsRequest([{ observedTimeUnixNano: nanos(NOW - 5000) }, { timeUnixNano: '0' }, { timeUnixNano: nanos(NOW + 3 * 86_400_000) }]),
      NOW,
    );
    expect(rows.map((row) => row.createdAt)).toEqual([NOW - 5000, NOW, NOW]);
  });

  it('rejects records older than the retention window and reports why', async () => {
    const { rows, rejected, reasons } = await normalizeLogs(
      logsRequest([{ timeUnixNano: nanos(NOW - 31 * 86_400_000) }, { timeUnixNano: nanos(NOW) }, 'not a record']),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rejected).toBe(2);
    expect(reasons).toEqual(['log record older than the 30-day retention', 'log record is not an object']);
  });

  it('caps attribute count, key and value length, and body length', async () => {
    const attributes = Array.from({ length: OTLP_LIMITS.maxAttributes + 5 }, (_, i) => ({
      key: `k${i}`,
      value: { stringValue: 'v' },
    }));
    attributes[0] = { key: 'x'.repeat(1000), value: { stringValue: 'y'.repeat(10_000) } };
    attributes[1] = {
      key: 'nested',
      value: { arrayValue: { values: Array.from({ length: 100 }, () => ({ stringValue: 'z'.repeat(100) })) } },
    };
    const { rows, reasons } = await normalizeLogs(
      logsRequest([{ timeUnixNano: nanos(NOW), body: { stringValue: 'b'.repeat(100_000) }, attributes }]),
      NOW,
    );
    const stored = JSON.parse(rows[0]!.attributes!) as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(OTLP_LIMITS.maxAttributes);
    expect(stored['x'.repeat(OTLP_LIMITS.maxKeyLength)]).toBe('y'.repeat(OTLP_LIMITS.maxValueLength));
    // A nested value too large once serialized is kept as truncated JSON text.
    expect(typeof stored.nested).toBe('string');
    expect((stored.nested as string).length).toBe(OTLP_LIMITS.maxValueLength);
    expect(rows[0]!.body!.length).toBe(OTLP_LIMITS.maxBodyLength);
    expect(reasons).toEqual([`attributes beyond ${OTLP_LIMITS.maxAttributes} per record were dropped`]);
  });

  it('refuses requests with too many records', async () => {
    const records = Array.from({ length: OTLP_LIMITS.maxItems + 1 }, () => ({}));
    await expect(normalizeLogs(logsRequest(records), NOW)).rejects.toThrow(OtlpPayloadError);
  });

  it('refuses bodies that are not OTLP objects', async () => {
    await expect(normalizeLogs([], NOW)).rejects.toThrow(OtlpPayloadError);
    await expect(normalizeLogs({ resourceLogs: {} }, NOW)).rejects.toThrow(/must be an array/);
    await expect(normalizeLogs({}, NOW)).resolves.toEqual({ rows: [], rejected: 0, reasons: [] });
  });

  it('keeps int64 precision and non-finite doubles', async () => {
    const { rows } = await normalizeLogs(
      logsRequest([
        {
          timeUnixNano: nanos(NOW),
          attributes: [
            { key: 'big', value: { intValue: '-9223372036854775808' } },
            { key: 'n', value: { intValue: 42 } },
            { key: 'nan', value: { doubleValue: 'NaN' } },
            { key: 'empty', value: {} },
          ],
        },
      ]),
      NOW,
    );
    expect(JSON.parse(rows[0]!.attributes!)).toEqual({ big: '-9223372036854775808', n: 42, nan: 'NaN', empty: null });
  });
});

describe('OTLP span mapping', () => {
  it('maps the OpenTelemetry spec example (examples/trace.json)', async () => {
    const { rows, rejected } = await normalizeSpans(SPEC_TRACE_JSON, SPEC_TIME_MS);
    expect(rejected).toBe(0);
    expect(rows).toEqual([
      {
        traceId: '5b8efff798038103d269b633813fc60c',
        spanId: 'eee19b7ec3c1b174',
        parentSpanId: 'eee19b7ec3c1b173',
        name: "I'm a server span",
        kind: 'server',
        service: 'my.service',
        serviceVersion: null,
        environment: null,
        scope: 'my.library@1.0.0',
        createdAt: 1544712660000,
        startUs: 1544712660000000,
        endUs: 1544712661000000,
        durationUs: 1_000_000,
        statusCode: 'unset',
        statusMessage: null,
        sessionId: null,
        attributes: JSON.stringify({ 'my.span.attr': 'some value' }),
        resource: null,
        events: null,
        links: null,
      },
    ]);
  });

  it('rejects spans without valid ids and accepts enum names', async () => {
    const { rows, rejected, reasons } = await normalizeSpans(
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  { traceId: '00000000000000000000000000000000', spanId: 'eee19b7ec3c1b174', startTimeUnixNano: nanos(NOW) },
                  { traceId: 'xyz', spanId: 'eee19b7ec3c1b174' },
                  {
                    traceId: '5b8efff798038103d269b633813fc60c',
                    spanId: 'eee19b7ec3c1b174',
                    startTimeUnixNano: nanos(NOW),
                    endTimeUnixNano: nanos(NOW - 1),
                    kind: 'SPAN_KIND_CONSUMER',
                    status: { code: 'STATUS_CODE_ERROR' },
                  },
                ],
              },
            ],
          },
        ],
      },
      NOW,
    );
    expect(rejected).toBe(2);
    expect(reasons).toEqual(['span without a valid traceId/spanId']);
    expect(rows[0]).toMatchObject({ kind: 'consumer', statusCode: 'error', durationUs: 0, name: '(unnamed)' });
  });
});

describe('trace and span ids', () => {
  it('accepts hex in any case and the base64 form some clients send', () => {
    expect(normalizeId('5B8EFFF798038103D269B633813FC60C', 16)).toBe('5b8efff798038103d269b633813fc60c');
    expect(normalizeId('W47/95gDgQPSabYzgT/GDA==', 16)).toBe('5b8efff798038103d269b633813fc60c');
    expect(normalizeId('7uGbfsPBsXQ=', 8)).toBe('eee19b7ec3c1b174');
    expect(normalizeId('0000000000000000', 8)).toBeNull();
    expect(normalizeId('eee19b7e', 8)).toBeNull();
    expect(normalizeId(42, 8)).toBeNull();
  });
});
