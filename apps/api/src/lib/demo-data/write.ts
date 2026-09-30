import type { Env } from '../../env';
import { siteStoreDb } from '../site-db';
import type { HeatmapCellRow, HourData } from './generate';

/**
 * Writes generated rows. Every statement is idempotent: fixed ids with INSERT OR IGNORE, or
 * upserts that converge (MIN / MAX / replace), so an hour written twice leaves the same rows.
 * Rows travel as one JSON parameter per table (`json_each`), which keeps a whole hour in a
 * single store round trip without hitting the bound-parameter limit.
 */

type Json = string | number | boolean | null;

function column(index: number) {
  return `json_extract(value, '$[${index}]')`;
}

function columns(count: number) {
  return Array.from({ length: count }, (_, index) => column(index)).join(', ');
}

/** Rows per statement, so one parameter never grows past a few hundred kilobytes. */
const CHUNK = 400;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

const EVENT_COLUMNS = [
  'event_id', 'website_id', 'session_id', 'visit_id', 'created_at', 'url_path', 'url_query', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_content', 'utm_term', 'referrer_path', 'referrer_query', 'referrer_domain', 'page_title', 'gclid',
  'fbclid', 'event_type', 'event_name', 'tag', 'hostname', 'lcp', 'inp', 'cls', 'fcp', 'ttfb', 'properties',
];

export type WriteSummary = { events: number; sessions: number; replays: number; replayChunks: number; logs: number; spans: number };

/** Store rows of one or more hours in one transaction (one RPC). */
export async function writeStoreRows(env: Env, websiteId: string, hours: HourData[], heatmap: HeatmapCellRow[] = []): Promise<WriteSummary> {
  const db = siteStoreDb(env, websiteId);
  const statements: D1PreparedStatement[] = [];
  const all = <K extends keyof HourData>(key: K): HourData[K] => hours.flatMap((hour) => hour[key] as unknown[]) as HourData[K];
  const bind = (sql: string, rows: Json[][]) => {
    for (const part of chunks(rows)) statements.push(db.prepare(sql).bind(JSON.stringify(part)));
  };

  const sessions = all('sessions');
  bind(
    `INSERT INTO session (session_id, website_id, browser, os, device, screen, language, country, region, city, distinct_id, created_at)
     SELECT ${columns(12)} FROM json_each(?1) WHERE true
     ON CONFLICT(session_id) DO UPDATE SET
       distinct_id = COALESCE(session.distinct_id, excluded.distinct_id),
       created_at = MIN(session.created_at, excluded.created_at)`,
    sessions.map((s) => [s.sessionId, websiteId, s.browser, s.os, s.device, s.screen, s.language, s.country, s.region, s.city, s.distinctId, s.createdAt]),
  );

  const events = all('events');
  bind(
    `INSERT OR IGNORE INTO website_event (${EVENT_COLUMNS.join(', ')}) SELECT ${columns(EVENT_COLUMNS.length)} FROM json_each(?1)`,
    events.map((e) => [
      e.id, websiteId, e.sessionId, e.visitId, e.createdAt, e.urlPath, e.urlQuery, e.utmSource, e.utmMedium, e.utmCampaign,
      e.utmContent, e.utmTerm, e.referrerPath, e.referrerQuery, e.referrerDomain, e.pageTitle, e.gclid, e.fbclid, e.eventType,
      e.eventName, e.tag, e.hostname, e.lcp, e.inp, e.cls, e.fcp, e.ttfb, e.properties ? JSON.stringify(e.properties) : null,
    ]),
  );

  bind(
    `INSERT OR IGNORE INTO session_data (session_data_id, website_id, session_id, data_key, string_value, number_value, date_value, data_type, distinct_id, created_at)
     SELECT ${column(0)}, ${column(1)}, ${column(2)}, ${column(3)}, ${column(4)}, ${column(5)}, NULL, ${column(6)}, ${column(7)}, ${column(8)} FROM json_each(?1)`,
    all('sessionData').map((d) => [d.id, websiteId, d.sessionId, d.key, d.stringValue, d.numberValue, d.dataType, d.distinctId, d.createdAt]),
  );

  bind(
    `INSERT OR IGNORE INTO revenue (revenue_id, website_id, session_id, event_id, event_name, currency, revenue, created_at)
     SELECT ${columns(8)} FROM json_each(?1)`,
    all('revenue').map((r) => [r.id, websiteId, r.sessionId, r.eventId, r.eventName, r.currency, r.revenue, r.createdAt]),
  );

  bind(
    `INSERT INTO person (person_id, website_id, distinct_id, properties_json, first_seen_at, last_seen_at, created_at, updated_at)
     SELECT ${column(0)}, ${column(1)}, ${column(2)}, ${column(3)}, ${column(4)}, ${column(5)}, ${column(4)}, ${column(5)} FROM json_each(?1) WHERE true
     ON CONFLICT(website_id, distinct_id) DO UPDATE SET
       properties_json = excluded.properties_json,
       first_seen_at = MIN(COALESCE(person.first_seen_at, excluded.first_seen_at), excluded.first_seen_at),
       last_seen_at = MAX(COALESCE(person.last_seen_at, 0), excluded.last_seen_at),
       created_at = MIN(COALESCE(person.created_at, excluded.created_at), excluded.created_at),
       updated_at = MAX(COALESCE(person.updated_at, 0), excluded.updated_at)`,
    all('persons').map((p) => [p.personId, websiteId, p.distinctId, JSON.stringify(p.properties), p.firstSeenAt, p.lastSeenAt]),
  );

  bind(
    `INSERT OR IGNORE INTO person_group_membership (membership_id, website_id, person_id, group_type, group_key, created_at)
     SELECT ${columns(6)} FROM json_each(?1)`,
    all('memberships').map((m) => [m.id, websiteId, m.personId, m.groupType, m.groupKey, m.createdAt]),
  );

  const replays = all('replays');
  const replayRows: Json[][] = [];
  for (const replay of replays) {
    replay.chunks.forEach((chunk, index) => {
      replayRows.push([
        replayRowId(websiteId, replay.visitId, index), websiteId, replay.sessionId, replay.visitId, index, chunk.events.length,
        chunk.startedAt, chunk.endedAt, chunk.endedAt, chunk.clickCount, chunk.inputCount, chunk.consoleLogCount,
        chunk.consoleWarnCount, chunk.consoleErrorCount, chunk.networkErrorCount,
      ]);
    });
  }
  bind(
    `INSERT OR IGNORE INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at,
       click_count, input_count, console_log_count, console_warn_count, console_error_count, network_error_count)
     SELECT ${columns(5)}, X'', ${column(5)}, ${column(6)}, ${column(7)}, ${column(8)}, ${column(9)}, ${column(10)}, ${column(11)}, ${column(12)}, ${column(13)}, ${column(14)}
     FROM json_each(?1)`,
    replayRows,
  );

  bind(
    `INSERT OR IGNORE INTO log_record (log_id, website_id, created_at, time_us, severity, severity_number, severity_text, body, service, service_version,
       environment, scope, trace_id, span_id, session_id, attributes, resource)
     SELECT ${columns(17)} FROM json_each(?1)`,
    all('logs').map((l) => [
      l.id, websiteId, l.createdAt, l.timeUs, l.severity, l.severityNumber, l.severity.toUpperCase(), l.body, l.service, l.serviceVersion,
      'production', 'demo-instrumentation@1.0.0', l.traceId, l.spanId, l.sessionId, JSON.stringify(l.attributes), JSON.stringify(l.resource),
    ]),
  );

  bind(
    `INSERT OR IGNORE INTO trace_span (trace_id, span_id, website_id, parent_span_id, name, kind, service, service_version, environment, scope,
       created_at, start_us, end_us, duration_us, status_code, status_message, session_id, attributes, resource, events, links)
     SELECT ${columns(20)}, NULL FROM json_each(?1)`,
    all('spans').map((s) => [
      s.traceId, s.spanId, websiteId, s.parentSpanId, s.name, s.kind, s.service, s.serviceVersion, 'production', 'demo-instrumentation@1.0.0',
      s.startMs, s.startMs * 1000, (s.startMs + s.durationMs) * 1000, s.durationMs * 1000, s.statusCode, s.statusMessage, s.sessionId,
      JSON.stringify(s.attributes), JSON.stringify(s.resource), s.events ? JSON.stringify(s.events) : null,
    ]),
  );

  bind(
    `INSERT INTO heatmap_cell (website_id, url_path, day, kind, norm_x, norm_y, device_class, viewport_w, viewport_h, count)
     SELECT ${columns(10)} FROM json_each(?1) WHERE true
     ON CONFLICT(website_id, url_path, day, kind, norm_x, norm_y, device_class) DO UPDATE SET
       count = excluded.count, viewport_w = excluded.viewport_w, viewport_h = excluded.viewport_h`,
    heatmap.map((c) => [websiteId, c.urlPath, c.day, c.kind, c.normX, c.normY, c.deviceClass, c.viewportW, c.viewportH, c.count]),
  );

  if (statements.length) await db.batch(statements);
  return {
    events: events.length,
    sessions: sessions.length,
    replays: replays.length,
    replayChunks: replayRows.length,
    logs: all('logs').length,
    spans: all('spans').length,
  };
}

export function replayRowId(websiteId: string, visitId: string, chunkIndex: number) {
  return `demo-${websiteId.slice(-4)}-${visitId}-${chunkIndex}`;
}

export function replayObjectKey(websiteId: string, visitId: string, chunkIndex: number) {
  return `${websiteId}/${visitId}/${chunkIndex}`;
}

/** Replay chunks go to R2 before their rows exist, like ingest's record route. */
export async function writeReplayObjects(env: Env, websiteId: string, hours: HourData[]): Promise<number> {
  if (!env.REPLAY_BUCKET) return 0;
  const puts: Promise<unknown>[] = [];
  for (const hour of hours) {
    for (const replay of hour.replays) {
      replay.chunks.forEach((chunk, index) => {
        puts.push(
          env.REPLAY_BUCKET!.put(replayObjectKey(websiteId, replay.visitId, index), JSON.stringify(chunk.events), {
            httpMetadata: { contentType: 'application/json' },
          }),
        );
      });
    }
  }
  await Promise.all(puts);
  return puts.length;
}

/** Survey responses and workflow runs live in D1 (they belong to D1 config objects). */
export async function writeD1Rows(env: Env, websiteId: string, hours: HourData[]): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  const all = <K extends keyof HourData>(key: K): HourData[K] => hours.flatMap((hour) => hour[key] as unknown[]) as HourData[K];
  const bind = (sql: string, rows: Json[][]) => {
    for (const part of chunks(rows)) statements.push(env.DB.prepare(sql).bind(JSON.stringify(part)));
  };
  bind(
    `INSERT OR IGNORE INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, answers, completed, source, distinct_id, created_at, updated_at)
     SELECT ${columns(9)}, 'widget', ${column(9)}, ${column(10)}, ${column(10)} FROM json_each(?1)
     WHERE EXISTS (SELECT 1 FROM survey s WHERE s.survey_id = ${column(1)})`,
    all('surveyResponses').map((r) => [
      r.id, r.surveyId, websiteId, r.sessionId, r.visitId, r.answer, r.urlPath, JSON.stringify(r.answers), r.completed ? 1 : 0, r.distinctId, r.createdAt,
    ]),
  );
  bind(
    `INSERT OR IGNORE INTO workflow_execution (execution_id, workflow_id, website_id, session_id, visit_id, event_id, event_name, status, error, distinct_id,
       current_step, attempts, response_code, next_retry_at, created_at, updated_at, completed_at)
     SELECT ${columns(8)}, NULL, ${column(8)}, ${column(9)}, ${column(10)}, NULL, NULL, ${column(11)}, ${column(12)}, ${column(12)} FROM json_each(?1)
     WHERE EXISTS (SELECT 1 FROM workflow w WHERE w.workflow_id = ${column(1)})`,
    all('workflowExecutions').map((w) => [
      w.id, w.workflowId, websiteId, w.sessionId, w.visitId, w.eventId, w.eventName, w.status, w.distinctId, w.currentStep, w.attempts, w.createdAt, w.completedAt,
    ]),
  );
  bind(
    `INSERT OR IGNORE INTO workflow_execution_attempt (attempt_id, execution_id, workflow_id, website_id, step_index, step_type, attempt, status,
       response_code, error, response_body, duration_ms, next_retry_at, created_at)
     SELECT ${columns(6)}, 1, ${column(6)}, NULL, NULL, NULL, ${column(7)}, NULL, ${column(8)} FROM json_each(?1)
     WHERE EXISTS (SELECT 1 FROM workflow_execution x WHERE x.execution_id = ${column(1)})`,
    all('workflowAttempts').map((a) => [a.id, a.executionId, a.workflowId, websiteId, a.stepIndex, a.stepType, a.status, a.durationMs, a.createdAt]),
  );
  if (statements.length) await env.DB.batch(statements);
}
