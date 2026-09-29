import { SqlParams } from '@flareboard/db/property-filters';
import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
import { eventStoreMode, siteDb, siteStoreDb } from './site-db';

/**
 * Where log lines and spans come from, as SQL the query functions in `logs.ts` select from.
 *
 * Two kinds of logs exist:
 * - `otlp`: OpenTelemetry log records and spans (`log_record`, `trace_span`), written by ingest's
 *   /v1/logs and /v1/traces. They live only in the website store.
 * - `browser`: `flareboard.log()` calls from the tracker, stored as `website_event` rows with
 *   `event_type = log` and their fields in the event properties. Log events that carry a
 *   `traceId` also act as lightweight spans.
 *
 * Every source exposes the same columns, so one filter compiler and one set of queries serve both:
 * - logs:  id, source, seq, created_at, time_us, severity, severity_text, body, service, release,
 *          environment, scope, trace_id, span_id, session_id, visit_id, url_path, attributes,
 *          resource
 * - spans: id, source, trace_id, span_id, parent_span_id, name, kind, service, release,
 *          environment, created_at, start_us, duration_us, status, status_message, session_id,
 *          attributes, resource, events, links
 * `seq` is the row's insertion order within its own table (rowid), used by the live tail.
 *
 * Storage modes (`EVENT_STORE`):
 * - `do` and `dual`: everything is read from the website store (in `dual`, browser logs are
 *   written to the store as well; history arrives there with the backfill);
 * - `d1` (legacy): browser logs from D1, read through `event_data`. OTLP is not ingested in this
 *   mode (the stores are not in use yet), so there is no OTLP source.
 *
 * All SQL binds `?1` to the website id. Never join these with D1-only tables.
 */

export type LogSourceName = 'otlp' | 'browser';

export type LogSources = {
  db: D1Database;
  /** False in `d1` mode: OTLP data is not ingested or stored. */
  otlp: boolean;
  /** Log arms by source, each a SELECT with the log columns. */
  logArms: Partial<Record<LogSourceName, string>>;
  /** Span arms by source, each a SELECT with the span columns. */
  spanArms: Partial<Record<LogSourceName, string>>;
};

export const SEVERITIES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Tracker levels → the OTel severity names used for OTLP rows. */
function severitySql(level: string) {
  return `CASE lower(COALESCE(${level}, 'info'))
    WHEN 'trace' THEN 'trace' WHEN 'verbose' THEN 'trace'
    WHEN 'debug' THEN 'debug'
    WHEN 'warn' THEN 'warn' WHEN 'warning' THEN 'warn'
    WHEN 'error' THEN 'error' WHEN 'err' THEN 'error'
    WHEN 'fatal' THEN 'fatal' WHEN 'critical' THEN 'fatal'
    ELSE 'info' END`;
}

const OTLP_LOGS = `SELECT r.log_id AS id, 'otlp' AS source, r.rowid AS seq, r.created_at AS created_at,
    r.time_us AS time_us, r.severity AS severity, r.severity_text AS severity_text, r.body AS body,
    r.service AS service, r.service_version AS release, r.environment AS environment, r.scope AS scope,
    r.trace_id AS trace_id, r.span_id AS span_id, r.session_id AS session_id, NULL AS visit_id,
    NULL AS url_path, r.attributes AS attributes, r.resource AS resource
  FROM log_record r`;

const OTLP_SPANS = `SELECT t.span_id AS id, 'otlp' AS source, t.trace_id AS trace_id, t.span_id AS span_id,
    t.parent_span_id AS parent_span_id, t.name AS name, t.kind AS kind, t.service AS service,
    t.service_version AS release, t.environment AS environment, t.created_at AS created_at,
    t.start_us AS start_us, t.duration_us AS duration_us, t.status_code AS status,
    t.status_message AS status_message, t.session_id AS session_id, t.attributes AS attributes,
    t.resource AS resource, t.events AS events, t.links AS links
  FROM trace_span t`;

/** Reads one tracker property: from the JSON column in a store, from `event_data` in D1. */
type PropReader = (key: string) => string;

const storeProp: PropReader = (key) => `json_extract(e.properties, '$.${key}')`;
const d1Prop: PropReader = (key) =>
  `(SELECT COALESCE(d.string_value, d.number_value) FROM event_data d
     WHERE d.website_event_id = e.event_id AND d.data_key = '${key}' LIMIT 1)`;
// D1 keeps numbers as REAL: whole numbers go back to integers so `status=503` matches as in a store.
const D1_PROPERTIES = `(SELECT json_group_object(d.data_key, CASE d.data_type
       WHEN 2 THEN CASE WHEN d.number_value = CAST(d.number_value AS INTEGER)
                        THEN CAST(d.number_value AS INTEGER) ELSE d.number_value END
       WHEN 3 THEN json(CASE WHEN d.string_value = 'true' THEN 'true' ELSE 'false' END)
       ELSE d.string_value END)
     FROM event_data d WHERE d.website_event_id = e.event_id)`;

function browserLogs(prop: PropReader, properties: string) {
  return `SELECT e.event_id AS id, 'browser' AS source, e.rowid AS seq, e.created_at AS created_at,
    e.created_at * 1000 AS time_us, ${severitySql(prop('level'))} AS severity,
    ${prop('level')} AS severity_text, COALESCE(${prop('message')}, e.event_name) AS body,
    ${prop('service')} AS service, ${prop('release')} AS release, ${prop('environment')} AS environment,
    NULL AS scope, ${prop('traceId')} AS trace_id, ${prop('spanId')} AS span_id,
    e.session_id AS session_id, e.visit_id AS visit_id, e.url_path AS url_path,
    ${properties} AS attributes, NULL AS resource
  FROM website_event e
  WHERE e.website_id = ?1 AND e.event_type = ${EVENT_TYPE.log}`;
}

function browserSpans(prop: PropReader, properties: string) {
  return `SELECT e.event_id AS id, 'browser' AS source, ${prop('traceId')} AS trace_id,
    COALESCE(${prop('spanId')}, e.event_id) AS span_id, ${prop('parentSpanId')} AS parent_span_id,
    COALESCE(${prop('operation')}, ${prop('message')}, e.event_name, 'log') AS name, 'internal' AS kind,
    ${prop('service')} AS service, ${prop('release')} AS release, ${prop('environment')} AS environment,
    e.created_at AS created_at, e.created_at * 1000 AS start_us,
    CAST(COALESCE(${prop('durationMs')}, 0) * 1000 AS INTEGER) AS duration_us,
    CASE WHEN ${prop('status')} = 'error' OR lower(${prop('level')}) IN ('error', 'fatal') THEN 'error'
         WHEN ${prop('status')} = 'ok' THEN 'ok' ELSE 'unset' END AS status,
    NULL AS status_message, e.session_id AS session_id, ${properties} AS attributes, NULL AS resource,
    NULL AS events, NULL AS links
  FROM website_event e
  WHERE e.website_id = ?1 AND e.event_type = ${EVENT_TYPE.log} AND ${prop('traceId')} IS NOT NULL`;
}

export function logSources(env: Env, websiteId: string): LogSources {
  if (eventStoreMode(env) === 'd1') {
    return {
      db: siteDb(env, websiteId),
      otlp: false,
      logArms: { browser: browserLogs(d1Prop, D1_PROPERTIES) },
      spanArms: { browser: browserSpans(d1Prop, D1_PROPERTIES) },
    };
  }
  return {
    db: siteStoreDb(env, websiteId),
    otlp: true,
    logArms: { otlp: OTLP_LOGS, browser: browserLogs(storeProp, 'e.properties') },
    spanArms: { otlp: OTLP_SPANS, browser: browserSpans(storeProp, 'e.properties') },
  };
}

/**
 * `FROM (…) l` over the chosen arms. SQLite pushes the outer WHERE into each UNION ALL arm, so
 * time filters still use each table's index.
 */
export function fromArms(arms: Partial<Record<LogSourceName, string>>, only?: LogSourceName) {
  const selected = Object.entries(arms)
    .filter(([name]) => !only || name === only)
    .map(([, sql]) => sql);
  // A source filter naming an absent source matches nothing.
  if (!selected.length) return `(SELECT * FROM (${Object.values(arms)[0]}) WHERE 0) l`;
  return `(${selected.join('\nUNION ALL\n')}) l`;
}

/** Escapes LIKE wildcards; use with `ESCAPE '\\'`. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Numbered parameters for the dynamically built SQL, with `?1` bound to the website id. */
export function logParams(websiteId: string) {
  const params = new SqlParams();
  params.add(websiteId);
  return params;
}

export { SqlParams };

export type AttributeFilter = { key: string; value?: string };

export type LogFilters = {
  /** One or more severities. */
  levels?: Severity[];
  /** Case-insensitive substring of the log body (spans: of the name). */
  search?: string;
  release?: string;
  environment?: string;
  service?: string;
  traceId?: string;
  sessionId?: string;
  source?: LogSourceName;
  /** Record or resource attribute equals the value (or exists, without a value). */
  attributes?: AttributeFilter[];
};

function attributeCondition(params: SqlParams, filter: AttributeFilter) {
  const key = params.add(filter.key);
  // Booleans read back as true/false and numbers as their text, so `retry=true` or `status=500` match.
  const valueTest =
    filter.value === undefined
      ? ''
      : ` AND (CASE j.type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false'
               WHEN 'real' THEN CASE WHEN j.value = CAST(j.value AS INTEGER) THEN CAST(CAST(j.value AS INTEGER) AS TEXT)
                                     ELSE CAST(j.value AS TEXT) END
               ELSE CAST(j.value AS TEXT) END) = ${params.add(filter.value)}`;
  return `(EXISTS (SELECT 1 FROM json_each(l.attributes) j WHERE j.key = ${key}${valueTest})
    OR EXISTS (SELECT 1 FROM json_each(l.resource) j WHERE j.key = ${key}${valueTest}))`;
}

/** WHERE conditions over `l` for the given filters (log arms; `searchColumn` = body). */
export function logConditions(params: SqlParams, filters: LogFilters, searchColumn = 'l.body'): string[] {
  const conditions: string[] = [];
  if (filters.levels?.length) {
    conditions.push(`l.severity IN (${filters.levels.map((level) => params.add(level)).join(', ')})`);
  }
  if (filters.search) {
    conditions.push(`${searchColumn} LIKE ${params.add(`%${escapeLike(filters.search)}%`)} ESCAPE '\\'`);
  }
  if (filters.release) conditions.push(`l.release = ${params.add(filters.release)}`);
  if (filters.environment) conditions.push(`l.environment = ${params.add(filters.environment)}`);
  if (filters.service) conditions.push(`l.service = ${params.add(filters.service)}`);
  if (filters.traceId) {
    // OTLP ids are stored as lowercase hex; tracker trace ids are free-form.
    conditions.push(`l.trace_id IN (${params.add(filters.traceId)}, ${params.add(filters.traceId.toLowerCase())})`);
  }
  if (filters.sessionId) conditions.push(`l.session_id = ${params.add(filters.sessionId)}`);
  for (const attribute of filters.attributes ?? []) conditions.push(attributeCondition(params, attribute));
  return conditions;
}

export function whereClause(conditions: string[]) {
  return conditions.length ? `WHERE ${conditions.join('\n AND ')}` : '';
}
