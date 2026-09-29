import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { OTLP_MAX_REQUEST_BYTES } from '../src/routes/otlp';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { pb, protobufLogsRequest, SPEC_TRACE_JSON } from './helpers/otlp-fixtures';
import { fetchWorkerWithEnv, seedProjectKey } from './helpers/queue';
import { testSiteDb } from './helpers/site-db';

const KEY = `fb_pk_${'OtlpReceiverKey'.padEnd(24, '0')}`;
const LIMITED_SITE = '00000000-0000-0000-0000-0000000000c3';
const LIMITED_KEY = `fb_pk_${'OtlpLimitedKey'.padEnd(24, '0')}`;

function nanos(ms: number) {
  return `${BigInt(ms) * 1_000_000n}`;
}

async function post(path: string, body: BodyInit, headers: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return fetchWorkerWithEnv(path, { method: 'POST', headers, body }, overrides);
}

function jsonHeaders(extra: Record<string, string> = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...extra };
}

function logsPayload(service: string, records: unknown[]) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: service } },
            { key: 'deployment.environment.name', value: { stringValue: 'production' } },
          ],
        },
        scopeLogs: [{ scope: { name: 'test' }, logRecords: records }],
      },
    ],
  };
}

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function logsFor(service: string) {
  const rows = await testSiteDb(TEST_WEBSITE_ID)
    .prepare(
      `SELECT log_id AS logId, website_id AS websiteId, created_at AS createdAt, severity, body, service,
              environment, trace_id AS traceId, session_id AS sessionId, attributes
       FROM log_record WHERE service = ?1 ORDER BY time_us, log_id`,
    )
    .bind(service)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

describe('OTLP/HTTP receiver', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await seedProjectKey(env.DB, TEST_WEBSITE_ID, KEY);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Limited', 'limited.example', '00000000-0000-0000-0000-000000000001', 0, 0)`,
    )
      .bind(LIMITED_SITE)
      .run();
    await seedProjectKey(env.DB, LIMITED_SITE, LIMITED_KEY);
  });

  it('stores JSON logs in the website store', async () => {
    const now = Date.now();
    const response = await post(
      '/v1/logs',
      JSON.stringify(
        logsPayload('json-svc', [
          {
            timeUnixNano: nanos(now - 1000),
            severityNumber: 17,
            body: { stringValue: 'card declined' },
            traceId: '5b8efff798038103d269b633813fc60c',
            attributes: [{ key: '$session_id', value: { stringValue: 'sess-json' } }],
          },
          { timeUnixNano: nanos(now), severityText: 'debug', body: { stringValue: 'retrying' } },
        ]),
      ),
      jsonHeaders(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({});

    const rows = await logsFor('json-svc');
    expect(rows).toEqual([
      expect.objectContaining({
        websiteId: TEST_WEBSITE_ID,
        createdAt: now - 1000,
        severity: 'error',
        body: 'card declined',
        environment: 'production',
        traceId: '5b8efff798038103d269b633813fc60c',
        sessionId: 'sess-json',
        attributes: JSON.stringify({ $session_id: 'sess-json' }),
      }),
      expect.objectContaining({ createdAt: now, severity: 'debug', body: 'retrying' }),
    ]);
  });

  it('does not store a retried batch twice', async () => {
    const body = JSON.stringify(logsPayload('retry-svc', [{ timeUnixNano: nanos(Date.now()), body: { stringValue: 'once' } }]));
    for (let i = 0; i < 2; i++) expect((await post('/v1/logs', body, jsonHeaders())).status).toBe(200);
    expect(await logsFor('retry-svc')).toHaveLength(1);
  });

  it('accepts gzip bodies and the x-flareboard-key header', async () => {
    const body = await gzip(JSON.stringify(logsPayload('gzip-svc', [{ timeUnixNano: nanos(Date.now()), body: { stringValue: 'zipped' } }])));
    const response = await post('/v1/logs', body, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'x-flareboard-key': KEY,
    });
    expect(response.status).toBe(200);
    expect((await logsFor('gzip-svc')).map((row) => row.body)).toEqual(['zipped']);
  });

  it('accepts protobuf and answers in protobuf', async () => {
    const now = Date.now();
    const request = protobufLogsRequest('proto-svc', [
      pb.concat(pb.fixed64(1, BigInt(now) * 1_000_000n), pb.varint(2, 13), pb.len(5, pb.str(1, 'from protobuf'))),
      // Older than the retention window: rejected and reported as a partial success.
      pb.concat(pb.fixed64(1, BigInt(now - 40 * 86_400_000) * 1_000_000n), pb.len(5, pb.str(1, 'too old'))),
    ]);
    const response = await post('/v1/logs', request, { 'Content-Type': 'application/x-protobuf', Authorization: `Bearer ${KEY}` });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-protobuf');
    // ExportLogsServiceResponse { partial_success { rejected_log_records: 1, error_message } }
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 5))).toEqual([0x0a, bytes[1], 0x08, 0x01, 0x12]);
    expect(new TextDecoder().decode(bytes.subarray(6))).toBe('log record older than the 30-day retention');

    expect(await logsFor('proto-svc')).toEqual([expect.objectContaining({ severity: 'warn', body: 'from protobuf' })]);
  });

  it('reports partial success in JSON', async () => {
    const response = await post(
      '/v1/traces',
      JSON.stringify({
        resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'bad', spanId: 'bad', name: 'x' }] }] }],
      }),
      jsonHeaders(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      partialSuccess: { rejectedSpans: 1, errorMessage: 'span without a valid traceId/spanId' },
    });
  });

  it('stores spans and replaces a span sent again', async () => {
    const now = Date.now();
    const trace = structuredClone(SPEC_TRACE_JSON) as any;
    const span = trace.resourceSpans[0].scopeSpans[0].spans[0];
    span.traceId = '0af7651916cd43dd8448eb211c80319c';
    span.startTimeUnixNano = nanos(now);
    span.endTimeUnixNano = nanos(now + 42);
    expect((await post('/v1/traces', JSON.stringify(trace), jsonHeaders())).status).toBe(200);
    span.status = { code: 2, message: 'failed later' };
    expect((await post('/v1/traces', JSON.stringify(trace), jsonHeaders())).status).toBe(200);

    const rows = await testSiteDb(TEST_WEBSITE_ID)
      .prepare(
        `SELECT name, kind, service, duration_us AS durationUs, status_code AS statusCode, status_message AS statusMessage
         FROM trace_span WHERE trace_id = ?1`,
      )
      .bind('0af7651916cd43dd8448eb211c80319c')
      .all();
    expect(rows.results).toEqual([
      { name: "I'm a server span", kind: 'server', service: 'my.service', durationUs: 42_000, statusCode: 'error', statusMessage: 'failed later' },
    ]);
  });

  it('requires a known project key', async () => {
    const body = JSON.stringify(logsPayload('auth-svc', []));
    const missing = await post('/v1/logs', body, { 'Content-Type': 'application/json' });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ code: 16, message: expect.stringContaining('project key') });

    const unknown = await post('/v1/logs', body, jsonHeaders({ Authorization: `Bearer fb_pk_${'Unknown'.padEnd(24, '0')}` }));
    expect(unknown.status).toBe(401);

    // A website id is not a credential here.
    const byId = await post('/v1/logs', body, jsonHeaders({ Authorization: `Bearer ${TEST_WEBSITE_ID}` }));
    expect(byId.status).toBe(401);

    const proto = await post('/v1/traces', new Uint8Array(), { 'Content-Type': 'application/x-protobuf' });
    expect(proto.status).toBe(401);
    expect(decodeStatus(new Uint8Array(await proto.arrayBuffer()))).toEqual({ code: 16, message: expect.any(String) });
  });

  it('rejects unsupported encodings and malformed bodies', async () => {
    const text = await post('/v1/logs', '{}', { 'Content-Type': 'text/plain', Authorization: `Bearer ${KEY}` });
    expect(text.status).toBe(415);

    const brotli = await post('/v1/logs', '{}', jsonHeaders({ 'Content-Encoding': 'br' }));
    expect(brotli.status).toBe(415);

    const badJson = await post('/v1/logs', '{"resourceLogs": [', jsonHeaders());
    expect(badJson.status).toBe(400);

    const badGzip = await post('/v1/logs', 'not gzip', jsonHeaders({ 'Content-Encoding': 'gzip' }));
    expect(badGzip.status).toBe(400);

    const badProto = await post('/v1/logs', new Uint8Array([0x0a, 0xff]), {
      'Content-Type': 'application/x-protobuf',
      Authorization: `Bearer ${KEY}`,
    });
    expect(badProto.status).toBe(400);
    expect(decodeStatus(new Uint8Array(await badProto.arrayBuffer())).code).toBe(3);
  });

  it('enforces request size and record count limits', async () => {
    const huge = new Uint8Array(OTLP_MAX_REQUEST_BYTES + 1).fill(0x20);
    expect((await post('/v1/logs', huge, jsonHeaders())).status).toBe(413);

    const records = Array.from({ length: 10_001 }, () => ({}));
    const tooMany = await post('/v1/logs', JSON.stringify(logsPayload('many-svc', records)), jsonHeaders());
    expect(tooMany.status).toBe(413);
  });

  it('rate limits per project key', async () => {
    const limits = { PROJECT_KEY_RATE_LIMIT: '2' };
    const body = JSON.stringify(logsPayload('limited-svc', []));
    const headers = jsonHeaders({ Authorization: `Bearer ${LIMITED_KEY}` });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post('/v1/logs', body, headers, limits)).status);
    expect(statuses).toEqual([200, 200, 429]);
    const limited = await post('/v1/traces', body, headers, limits);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
  });

  it('is unavailable while the stores are not in use (EVENT_STORE=d1)', async () => {
    const response = await post('/v1/logs', JSON.stringify(logsPayload('d1-svc', [])), jsonHeaders(), { EVENT_STORE: 'd1' });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ code: 12, message: expect.stringContaining('EVENT_STORE') });
  });

  it('allows browser exporters to send the key header', async () => {
    const response = await fetchWorkerWithEnv(
      '/v1/logs',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-flareboard-key',
        },
      },
      {},
    );
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-flareboard-key');
  });
});

/** google.rpc.Status from a protobuf error body. */
function decodeStatus(bytes: Uint8Array): { code: number; message: string } {
  let code = 0;
  let message = '';
  let pos = 0;
  while (pos < bytes.length) {
    const tag = bytes[pos++]!;
    if (tag === 0x08) code = bytes[pos++]!;
    else if (tag === 0x12) {
      const length = bytes[pos++]!;
      message = new TextDecoder().decode(bytes.subarray(pos, pos + length));
      pos += length;
    } else throw new Error(`unexpected tag ${tag}`);
  }
  return { code, message };
}
