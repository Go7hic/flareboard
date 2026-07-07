import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type SavedReplayRow = {
  id: string;
  name: string;
  visitId: string;
  createdAt: number | string;
  sessionId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  eventCount: number;
  chunks: number;
  durationMs: number;
  pageviews: number;
  customEvents: number;
  errors: number;
  logs: number;
  aiCalls: number;
  lastIssueAt: number | null;
};

export async function getSavedReplays(env: Env, websiteId: string) {
  const rows = await env.DB.prepare(
    `WITH replay_meta AS (
       SELECT visit_id as visitId,
              session_id as sessionId,
              started_at as startedAt,
              ended_at as endedAt,
              event_count as eventCount,
              chunks
       FROM session_replay_summary
       WHERE website_id = ?1
       UNION ALL
       SELECT r.visit_id as visitId,
              r.session_id as sessionId,
              MIN(r.started_at) as startedAt,
              MAX(r.ended_at) as endedAt,
              SUM(r.event_count) as eventCount,
              COUNT(*) as chunks
       FROM session_replay r
       WHERE r.website_id = ?1
         AND NOT EXISTS (
           SELECT 1
           FROM session_replay_summary s
           WHERE s.website_id = r.website_id AND s.visit_id = r.visit_id
         )
       GROUP BY r.visit_id, r.session_id
     ),
     context_counts AS (
       SELECT e.visit_id as visitId,
              SUM(CASE WHEN e.event_type = ?2 THEN 1 ELSE 0 END) as pageviews,
              SUM(CASE WHEN e.event_type = ?3 THEN 1 ELSE 0 END) as customEvents,
              SUM(CASE WHEN e.event_type = ?4 THEN 1 ELSE 0 END) as errors,
              SUM(CASE WHEN e.event_type = ?5 THEN 1 ELSE 0 END) as logs,
              SUM(CASE WHEN e.event_type = ?6 THEN 1 ELSE 0 END) as aiCalls,
              MAX(CASE WHEN e.event_type IN (?4, ?5) THEN e.created_at ELSE NULL END) as lastIssueAt
       FROM website_event e
       INNER JOIN session_replay_saved saved ON saved.visit_id = e.visit_id AND saved.website_id = ?1
       WHERE e.website_id = ?1
       GROUP BY e.visit_id
     )
     SELECT saved.saved_replay_id as id,
            saved.name,
            saved.visit_id as visitId,
            saved.created_at as createdAt,
            meta.sessionId,
            meta.startedAt,
            meta.endedAt,
            meta.eventCount,
            meta.chunks,
            CASE
              WHEN meta.startedAt IS NULL OR meta.endedAt IS NULL THEN 0
              ELSE MAX(meta.endedAt - meta.startedAt, 0)
            END as durationMs,
            COALESCE(context_counts.pageviews, 0) as pageviews,
            COALESCE(context_counts.customEvents, 0) as customEvents,
            COALESCE(context_counts.errors, 0) as errors,
            COALESCE(context_counts.logs, 0) as logs,
            COALESCE(context_counts.aiCalls, 0) as aiCalls,
            context_counts.lastIssueAt
     FROM session_replay_saved saved
     LEFT JOIN replay_meta meta ON meta.visitId = saved.visit_id
     LEFT JOIN context_counts ON context_counts.visitId = saved.visit_id
     WHERE saved.website_id = ?1
     ORDER BY saved.created_at DESC`,
  )
    .bind(
      websiteId,
      EVENT_TYPE.pageView,
      EVENT_TYPE.customEvent,
      EVENT_TYPE.error,
      EVENT_TYPE.log,
      EVENT_TYPE.ai,
    )
    .all<{
      id: string;
      name: string;
      visitId: string;
      createdAt: number | string;
      sessionId: string | null;
      startedAt: number | null;
      endedAt: number | null;
      eventCount: number | null;
      chunks: number | null;
      durationMs: number | null;
      pageviews: number | null;
      customEvents: number | null;
      errors: number | null;
      logs: number | null;
      aiCalls: number | null;
      lastIssueAt: number | null;
    }>();

  return (rows.results ?? []).map((row): SavedReplayRow => ({
    id: row.id,
    name: row.name,
    visitId: row.visitId,
    createdAt: row.createdAt,
    sessionId: row.sessionId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    eventCount: row.eventCount ?? 0,
    chunks: row.chunks ?? 0,
    durationMs: row.durationMs ?? 0,
    pageviews: row.pageviews ?? 0,
    customEvents: row.customEvents ?? 0,
    errors: row.errors ?? 0,
    logs: row.logs ?? 0,
    aiCalls: row.aiCalls ?? 0,
    lastIssueAt: row.lastIssueAt,
  }));
}
