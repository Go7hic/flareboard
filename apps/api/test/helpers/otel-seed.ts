import { EVENT_TYPE } from '@flareboard/shared';
import { testSiteDb } from './site-db';

/** Seeds OpenTelemetry rows (as ingest's /v1/logs and /v1/traces store them) and tracker logs. */

export type SeedLog = {
  id: string;
  at: number;
  severity?: string;
  body?: string;
  service?: string | null;
  release?: string | null;
  environment?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  sessionId?: string | null;
  attributes?: Record<string, unknown> | null;
  resource?: Record<string, unknown> | null;
  timeUs?: number;
};

export async function seedOtlpLog(websiteId: string, log: SeedLog) {
  await testSiteDb(websiteId)
    .prepare(
      `INSERT INTO log_record (log_id, website_id, created_at, time_us, severity, severity_number, severity_text, body,
         service, service_version, environment, scope, trace_id, span_id, session_id, attributes, resource)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, ?6, ?7, ?8, ?9, 'test', ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(
      log.id,
      websiteId,
      log.at,
      log.timeUs ?? log.at * 1000,
      log.severity ?? 'info',
      log.body ?? null,
      log.service === undefined ? 'api' : log.service,
      log.release ?? null,
      log.environment ?? null,
      log.traceId ?? null,
      log.spanId ?? null,
      log.sessionId ?? null,
      log.attributes ? JSON.stringify(log.attributes) : null,
      log.resource ? JSON.stringify(log.resource) : null,
    )
    .run();
}

export type SeedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  service?: string;
  startMs: number;
  durationMs: number;
  status?: 'unset' | 'ok' | 'error';
  sessionId?: string | null;
  events?: unknown[] | null;
};

export async function seedSpan(websiteId: string, span: SeedSpan) {
  await testSiteDb(websiteId)
    .prepare(
      `INSERT INTO trace_span (trace_id, span_id, website_id, parent_span_id, name, kind, service, created_at,
         start_us, end_us, duration_us, status_code, session_id, events)
       VALUES (?1, ?2, ?3, ?4, ?5, 'server', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      span.traceId,
      span.spanId,
      websiteId,
      span.parentSpanId ?? null,
      span.name,
      span.service ?? 'api',
      span.startMs,
      span.startMs * 1000,
      (span.startMs + span.durationMs) * 1000,
      span.durationMs * 1000,
      span.status ?? 'unset',
      span.sessionId ?? null,
      span.events ? JSON.stringify(span.events) : null,
    )
    .run();
}

/** A `flareboard.log()` event: a website_event row with its fields in the properties. */
export async function seedBrowserLog(
  websiteId: string,
  log: { id: string; at: number; level?: string; message: string; sessionId?: string; props?: Record<string, string | number> },
) {
  const db = testSiteDb(websiteId);
  const sessionId = log.sessionId ?? `${log.id}-session`;
  await db
    .prepare(
      `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
       VALUES (?1, ?2, ?3, ?3, ?4, '/app', ?5, 'log')`,
    )
    .bind(log.id, websiteId, sessionId, log.at, EVENT_TYPE.log)
    .run();
  const props: Record<string, string | number> = { level: log.level ?? 'info', message: log.message, ...log.props };
  for (const [key, value] of Object.entries(props)) {
    await db
      .prepare(
        `INSERT INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        `${log.id}-${key}`,
        websiteId,
        log.id,
        key,
        typeof value === 'string' ? value : null,
        typeof value === 'number' ? value : null,
        typeof value === 'number' ? 2 : 1,
        log.at,
      )
      .run();
  }
}
