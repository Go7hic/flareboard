import { eventStoreMode } from '@flareboard/db/site-store';
import type { Env } from '../../env';
import { siteStoreDb } from '../site-db';
import type { LogRow, SpanRow } from './normalize';

/**
 * Writes OTLP rows straight into the website's store (`log_record` / `trace_span`), one
 * transaction per request.
 *
 * Why not the event queue: exporters already batch (the SDK batch processor sends up to 512
 * records, the Collector thousands), so a request is a natural write unit; writing in-request
 * lets a failed write answer 503 and the exporter retry (queue messages are also capped at
 * 128 KB, far below an OTLP batch). Rows travel as one JSON parameter per ~1 MB chunk and are
 * expanded by `json_each` in SQLite, instead of one statement per row (the store caps bound
 * parameters per statement at 100).
 *
 * These tables live only in the website store. In legacy `EVENT_STORE=d1` mode the stores are
 * not in use yet, so OTLP ingestion is unavailable (`null` here).
 */
export function otelStore(env: Env, websiteId: string): D1Database | null {
  return eventStoreMode(env) === 'd1' ? null : siteStoreDb(env, websiteId);
}

/** Below the store's 2 MB string limit with headroom. */
const CHUNK_CHARS = 1024 * 1024;

function chunks(rows: unknown[][]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const row of rows) {
    const encoded = JSON.stringify(row);
    if (current.length && size + encoded.length > CHUNK_CHARS) {
      out.push(`[${current.join(',')}]`);
      current = [];
      size = 0;
    }
    current.push(encoded);
    size += encoded.length + 1;
  }
  if (current.length) out.push(`[${current.join(',')}]`);
  return out;
}

function columnsFromJson(count: number) {
  return Array.from({ length: count }, (_, i) => `json_extract(value, '$[${i}]')`).join(', ');
}

const LOG_COLUMNS = [
  'log_id',
  'created_at',
  'time_us',
  'severity',
  'severity_number',
  'severity_text',
  'body',
  'service',
  'service_version',
  'environment',
  'scope',
  'trace_id',
  'span_id',
  'session_id',
  'attributes',
  'resource',
];

const SPAN_COLUMNS = [
  'trace_id',
  'span_id',
  'parent_span_id',
  'name',
  'kind',
  'service',
  'service_version',
  'environment',
  'scope',
  'created_at',
  'start_us',
  'end_us',
  'duration_us',
  'status_code',
  'status_message',
  'session_id',
  'attributes',
  'resource',
  'events',
  'links',
];

// Retries of a batch reuse the same deterministic log ids: ignore duplicates.
const INSERT_LOGS = `INSERT OR IGNORE INTO log_record (website_id, ${LOG_COLUMNS.join(', ')})
  SELECT ?1, ${columnsFromJson(LOG_COLUMNS.length)} FROM json_each(?2)`;
// A span re-sent (retry, or a later export of the same span) replaces the earlier copy.
const INSERT_SPANS = `INSERT OR REPLACE INTO trace_span (website_id, ${SPAN_COLUMNS.join(', ')})
  SELECT ?1, ${columnsFromJson(SPAN_COLUMNS.length)} FROM json_each(?2)`;

export async function writeLogRows(db: D1Database, websiteId: string, rows: LogRow[]) {
  if (!rows.length) return;
  const values = rows.map((row) => [
    row.logId,
    row.createdAt,
    row.timeUs,
    row.severity,
    row.severityNumber,
    row.severityText,
    row.body,
    row.service,
    row.serviceVersion,
    row.environment,
    row.scope,
    row.traceId,
    row.spanId,
    row.sessionId,
    row.attributes,
    row.resource,
  ]);
  await db.batch(chunks(values).map((chunk) => db.prepare(INSERT_LOGS).bind(websiteId, chunk)));
}

export async function writeSpanRows(db: D1Database, websiteId: string, rows: SpanRow[]) {
  if (!rows.length) return;
  const values = rows.map((row) => [
    row.traceId,
    row.spanId,
    row.parentSpanId,
    row.name,
    row.kind,
    row.service,
    row.serviceVersion,
    row.environment,
    row.scope,
    row.createdAt,
    row.startUs,
    row.endUs,
    row.durationUs,
    row.statusCode,
    row.statusMessage,
    row.sessionId,
    row.attributes,
    row.resource,
    row.events,
    row.links,
  ]);
  await db.batch(chunks(values).map((chunk) => db.prepare(INSERT_SPANS).bind(websiteId, chunk)));
}
