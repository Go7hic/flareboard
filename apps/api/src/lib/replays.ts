import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
import { siteDb } from './site-db';

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

/** Visit ids per query: D1-compatible stores allow 100 bound parameters (5 are used for types). */
const VISIT_CHUNK = 90;

export async function getSavedReplays(env: Env, websiteId: string) {
  // Saved replays are configuration (D1); recordings and events live in the website store.
  const saved = await env.DB.prepare(
    `SELECT saved_replay_id as id, name, visit_id as visitId, created_at as createdAt
     FROM session_replay_saved
     WHERE website_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(websiteId)
    .all<{ id: string; name: string; visitId: string; createdAt: number | string }>();
  const savedRows = saved.results ?? [];
  if (!savedRows.length) return [];

  const meta = new Map<string, ReplayMeta>();
  const counts = new Map<string, ContextCounts>();
  const visitIds = [...new Set(savedRows.map((row) => row.visitId))];
  const db = siteDb(env, websiteId);
  for (let offset = 0; offset < visitIds.length; offset += VISIT_CHUNK) {
    const chunk = visitIds.slice(offset, offset + VISIT_CHUNK);
    const visitList = chunk.map((_, index) => `?${index + 7}`).join(', ');
    const [metaRows, countRows] = await db.batch([
      db
        .prepare(
          `SELECT visit_id as visitId, session_id as sessionId, started_at as startedAt, ended_at as endedAt,
                  event_count as eventCount, chunks
           FROM session_replay_summary
           WHERE website_id = ?1 AND visit_id IN (${visitList})
           UNION ALL
           SELECT r.visit_id, r.session_id, MIN(r.started_at), MAX(r.ended_at), SUM(r.event_count), COUNT(*)
           FROM session_replay r
           WHERE r.website_id = ?1 AND r.visit_id IN (${visitList})
             AND NOT EXISTS (
               SELECT 1 FROM session_replay_summary s WHERE s.website_id = r.website_id AND s.visit_id = r.visit_id
             )
           GROUP BY r.visit_id, r.session_id`,
        )
        .bind(websiteId, 0, 0, 0, 0, 0, ...chunk),
      db
        .prepare(
          `SELECT e.visit_id as visitId,
                  SUM(CASE WHEN e.event_type = ?2 THEN 1 ELSE 0 END) as pageviews,
                  SUM(CASE WHEN e.event_type = ?3 THEN 1 ELSE 0 END) as customEvents,
                  SUM(CASE WHEN e.event_type = ?4 THEN 1 ELSE 0 END) as errors,
                  SUM(CASE WHEN e.event_type = ?5 THEN 1 ELSE 0 END) as logs,
                  SUM(CASE WHEN e.event_type = ?6 THEN 1 ELSE 0 END) as aiCalls,
                  MAX(CASE WHEN e.event_type IN (?4, ?5) THEN e.created_at ELSE NULL END) as lastIssueAt
           FROM website_event e
           WHERE e.website_id = ?1 AND e.visit_id IN (${visitList})
           GROUP BY e.visit_id`,
        )
        .bind(
          websiteId,
          EVENT_TYPE.pageView,
          EVENT_TYPE.customEvent,
          EVENT_TYPE.error,
          EVENT_TYPE.log,
          EVENT_TYPE.ai,
          ...chunk,
        ),
    ]);
    for (const row of (metaRows?.results ?? []) as ReplayMeta[]) meta.set(row.visitId, row);
    for (const row of (countRows?.results ?? []) as ContextCounts[]) counts.set(row.visitId, row);
  }

  return savedRows.map((row): SavedReplayRow => {
    const m = meta.get(row.visitId);
    const c = counts.get(row.visitId);
    const startedAt = m?.startedAt ?? null;
    const endedAt = m?.endedAt ?? null;
    return {
      id: row.id,
      name: row.name,
      visitId: row.visitId,
      createdAt: row.createdAt,
      sessionId: m?.sessionId ?? null,
      startedAt,
      endedAt,
      eventCount: m?.eventCount ?? 0,
      chunks: m?.chunks ?? 0,
      durationMs: startedAt === null || endedAt === null ? 0 : Math.max(endedAt - startedAt, 0),
      pageviews: c?.pageviews ?? 0,
      customEvents: c?.customEvents ?? 0,
      errors: c?.errors ?? 0,
      logs: c?.logs ?? 0,
      aiCalls: c?.aiCalls ?? 0,
      lastIssueAt: c?.lastIssueAt ?? null,
    };
  });
}

type ReplayMeta = {
  visitId: string;
  sessionId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  eventCount: number | null;
  chunks: number | null;
};

type ContextCounts = {
  visitId: string;
  pageviews: number;
  customEvents: number;
  errors: number;
  logs: number;
  aiCalls: number;
  lastIssueAt: number | null;
};
