import { EVENT_TYPE, type PropertyFilter, type ReplayListQuery, type ReplaySort } from '@flareboard/shared';
import type { Env } from '../env';
import { compilePropertyFilter, likeContainsPattern, SqlParams } from './property-filters';
import { siteDb } from './site-db';

export type ReplayListRow = {
  visitId: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  eventCount: number;
  chunks: number;
  durationMs: number;
  pageviews: number;
  customEvents: number;
  errors: number;
  logs: number;
  aiCalls: number;
  lastIssueAt: number | null;
  clickCount: number;
  inputCount: number;
  consoleLogCount: number;
  consoleWarnCount: number;
  consoleErrorCount: number;
  networkErrorCount: number;
  entryPath: string | null;
  distinctId: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
};

export type ReplayListOptions = Partial<Omit<ReplayListQuery, 'sort' | 'limit'>> & {
  sort?: ReplaySort;
  limit?: number;
  range?: { startAt: number; endAt: number };
};

const REPLAY_ORDER: Record<ReplaySort, string> = {
  newest: 'rm.startedAt DESC',
  oldest: 'rm.startedAt ASC',
  longest: 'durationMs DESC, rm.startedAt DESC',
  shortest: 'durationMs ASC, rm.startedAt DESC',
  most_active: '(rm.clickCount + rm.inputCount) DESC, rm.startedAt DESC',
  most_errors: '(COALESCE(cc.errors, 0) + rm.consoleErrorCount) DESC, rm.startedAt DESC',
};

/** Negated operators are applied as "no event of the visit matches the positive filter". */
const POSITIVE_OF: Partial<Record<PropertyFilter['operator'], PropertyFilter['operator']>> = {
  is_not: 'is',
  not_contains: 'contains',
  not_regex: 'regex',
  is_not_set: 'is_set',
};

/** `EXISTS` over the events of the replay's visit (`rm.visitId`), sessions joined when needed. */
function visitEventExists(website: string, condition: string, needsSession: boolean) {
  const join = needsSession ? ' LEFT JOIN session s ON s.session_id = e.session_id' : '';
  return `EXISTS (SELECT 1 FROM website_event e${join}
    WHERE e.website_id = ${website} AND e.visit_id = rm.visitId AND (${condition}))`;
}

/**
 * Replays of a website, newest first by default, with the filters of the replay list: date
 * range (by start), duration, errors (error events or console errors), person (distinct id),
 * an event performed, a URL visited and property filters over the visit's events and session.
 * Everything here reads the website store only.
 */
export async function listReplays(env: Env, websiteId: string, options: ReplayListOptions = {}): Promise<ReplayListRow[]> {
  const params = new SqlParams();
  const website = params.add(websiteId);
  const start = options.range ? params.add(options.range.startAt) : 'NULL';
  const end = options.range ? params.add(options.range.endAt) : 'NULL';
  const types = {
    pageView: params.add(EVENT_TYPE.pageView),
    custom: params.add(EVENT_TYPE.customEvent),
    error: params.add(EVENT_TYPE.error),
    log: params.add(EVENT_TYPE.log),
    ai: params.add(EVENT_TYPE.ai),
  };

  const where: string[] = [];
  if (options.minDurationMs != null) where.push(`MAX(rm.endedAt - rm.startedAt, 0) >= ${params.add(options.minDurationMs)}`);
  if (options.maxDurationMs != null) where.push(`MAX(rm.endedAt - rm.startedAt, 0) <= ${params.add(options.maxDurationMs)}`);
  if (options.hasErrors === true) where.push('(COALESCE(cc.errors, 0) > 0 OR rm.consoleErrorCount > 0)');
  if (options.hasErrors === false) where.push('(COALESCE(cc.errors, 0) = 0 AND rm.consoleErrorCount = 0)');
  if (options.distinctId) where.push(`s.distinct_id = ${params.add(options.distinctId)}`);
  if (options.event) {
    where.push(visitEventExists(website, `e.event_name = ${params.add(options.event)}`, false));
  }
  if (options.url) {
    const pattern = params.add(likeContainsPattern(options.url));
    where.push(visitEventExists(website, `e.event_type = ${types.pageView} AND e.url_path LIKE ${pattern} ESCAPE '\\'`, false));
  }
  for (const filter of options.filters ?? []) {
    const positive = POSITIVE_OF[filter.operator];
    const compiled = compilePropertyFilter(positive ? { ...filter, operator: positive } : filter, params);
    const exists = visitEventExists(website, compiled.sql, compiled.needsSession);
    where.push(positive ? `NOT ${exists}` : exists);
  }
  const limit = params.add(Math.min(Math.max(options.limit ?? 200, 1), 500));
  params.assertWithinLimit();

  const sql = `WITH rm AS (
       SELECT visit_id AS visitId, session_id AS sessionId, started_at AS startedAt, ended_at AS endedAt,
              event_count AS eventCount, chunks, click_count AS clickCount, input_count AS inputCount,
              console_log_count AS consoleLogCount, console_warn_count AS consoleWarnCount,
              console_error_count AS consoleErrorCount, network_error_count AS networkErrorCount
       FROM session_replay_summary
       WHERE website_id = ${website}
         AND (${start} IS NULL OR started_at >= ${start}) AND (${end} IS NULL OR started_at <= ${end})
       UNION ALL
       SELECT r.visit_id, r.session_id, MIN(r.started_at), MAX(r.ended_at), SUM(r.event_count), COUNT(*),
              SUM(r.click_count), SUM(r.input_count), SUM(r.console_log_count), SUM(r.console_warn_count),
              SUM(r.console_error_count), SUM(r.network_error_count)
       FROM session_replay r
       WHERE r.website_id = ${website}
         AND NOT EXISTS (
           SELECT 1 FROM session_replay_summary x WHERE x.website_id = r.website_id AND x.visit_id = r.visit_id
         )
       GROUP BY r.visit_id, r.session_id
       HAVING (${start} IS NULL OR MIN(r.started_at) >= ${start}) AND (${end} IS NULL OR MIN(r.started_at) <= ${end})
     ),
     cc AS (
       SELECT e.visit_id AS visitId,
              SUM(CASE WHEN e.event_type = ${types.pageView} THEN 1 ELSE 0 END) AS pageviews,
              SUM(CASE WHEN e.event_type = ${types.custom} THEN 1 ELSE 0 END) AS customEvents,
              SUM(CASE WHEN e.event_type = ${types.error} THEN 1 ELSE 0 END) AS errors,
              SUM(CASE WHEN e.event_type = ${types.log} THEN 1 ELSE 0 END) AS logs,
              SUM(CASE WHEN e.event_type = ${types.ai} THEN 1 ELSE 0 END) AS aiCalls,
              MAX(CASE WHEN e.event_type IN (${types.error}, ${types.log}) THEN e.created_at ELSE NULL END) AS lastIssueAt
       FROM website_event e
       INNER JOIN rm ON rm.visitId = e.visit_id
       WHERE e.website_id = ${website}
       GROUP BY e.visit_id
     )
     SELECT rm.visitId, rm.sessionId, rm.startedAt, rm.endedAt, rm.eventCount, rm.chunks,
            MAX(rm.endedAt - rm.startedAt, 0) AS durationMs,
            COALESCE(cc.pageviews, 0) AS pageviews,
            COALESCE(cc.customEvents, 0) AS customEvents,
            COALESCE(cc.errors, 0) AS errors,
            COALESCE(cc.logs, 0) AS logs,
            COALESCE(cc.aiCalls, 0) AS aiCalls,
            cc.lastIssueAt,
            COALESCE(rm.clickCount, 0) AS clickCount,
            COALESCE(rm.inputCount, 0) AS inputCount,
            COALESCE(rm.consoleLogCount, 0) AS consoleLogCount,
            COALESCE(rm.consoleWarnCount, 0) AS consoleWarnCount,
            COALESCE(rm.consoleErrorCount, 0) AS consoleErrorCount,
            COALESCE(rm.networkErrorCount, 0) AS networkErrorCount,
            (SELECT p.url_path FROM website_event p
             WHERE p.website_id = ${website} AND p.visit_id = rm.visitId AND p.event_type = ${types.pageView}
             ORDER BY p.created_at ASC LIMIT 1) AS entryPath,
            s.distinct_id AS distinctId, s.country, s.browser, s.os, s.device
     FROM rm
     LEFT JOIN cc ON cc.visitId = rm.visitId
     LEFT JOIN session s ON s.session_id = rm.sessionId AND s.website_id = ${website}
     ${where.length ? `WHERE ${where.join('\n       AND ')}` : ''}
     ORDER BY ${REPLAY_ORDER[options.sort ?? 'newest']}
     LIMIT ${limit}`;

  const rows = await siteDb(env, websiteId)
    .prepare(sql)
    .bind(...params.values)
    .all<ReplayListRow>();
  return rows.results ?? [];
}

type ChunkRow = { id: string; visitId: string; chunkIndex: number; eventCount: number; startedAt: number; endedAt: number };

/**
 * Chunk index rows and rrweb events of one replay, in chunk order. `ref` is a visit id or a
 * chunk (replay) id. Events come from R2 (`<websiteId>/<visitId>/<chunk>`).
 */
export async function loadReplay(env: Env, websiteId: string, ref: string) {
  const chunks = await siteDb(env, websiteId)
    .prepare(
      `SELECT replay_id as id, visit_id as visitId, chunk_index as chunkIndex,
              event_count as eventCount, started_at as startedAt, ended_at as endedAt
       FROM session_replay
       WHERE website_id = ?1 AND (visit_id = ?2 OR replay_id = ?2)
       ORDER BY chunk_index ASC`,
    )
    .bind(websiteId, ref)
    .all<ChunkRow>();
  const rows = chunks.results ?? [];
  if (!rows.length) return null;

  const visitId = rows[0]!.visitId ?? ref;
  const events: unknown[] = [];
  if (env.REPLAY_BUCKET) {
    const bucket = env.REPLAY_BUCKET;
    const fetched = await Promise.all(
      rows.map(async (chunk) => {
        const obj = await bucket.get(`${websiteId}/${visitId}/${chunk.chunkIndex}`);
        if (!obj) return [] as unknown[];
        try {
          const parsed = JSON.parse(await obj.text());
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [] as unknown[];
        }
      }),
    );
    for (const part of fetched) events.push(...part);
  }
  return {
    visitId,
    chunks: rows,
    startedAt: Math.min(...rows.map((row) => row.startedAt)),
    endedAt: Math.max(...rows.map((row) => row.endedAt)),
    events,
  };
}

/** Whether the website store holds any chunk of this visit. */
export async function replayExists(env: Env, websiteId: string, visitId: string) {
  const row = await siteDb(env, websiteId)
    .prepare('SELECT 1 AS found FROM session_replay WHERE website_id = ?1 AND visit_id = ?2 LIMIT 1')
    .bind(websiteId, visitId)
    .first<{ found: number }>();
  return Boolean(row);
}

export type ReplayShare = {
  id: string;
  visitId: string;
  token: string;
  expiresAt: number | null;
  createdAt: number;
  createdBy: string | null;
};

/** 24 random bytes, base64url: the only secret a replay link carries. */
export function newReplayShareToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const SHARE_COLUMNS = `share_id AS id, visit_id AS visitId, token, expires_at AS expiresAt,
  created_at AS createdAt, created_by AS createdBy`;

export async function listReplayShares(env: Env, websiteId: string, visitId: string) {
  const rows = await env.DB.prepare(
    `SELECT ${SHARE_COLUMNS} FROM session_replay_share
     WHERE website_id = ?1 AND visit_id = ?2 ORDER BY created_at DESC`,
  )
    .bind(websiteId, visitId)
    .all<ReplayShare>();
  return rows.results ?? [];
}

/** A live (not expired) share by token, with its website id. */
export async function getReplayShareByToken(env: Env, token: string, now = Date.now()) {
  const row = await env.DB.prepare(
    `SELECT ${SHARE_COLUMNS}, website_id AS websiteId FROM session_replay_share WHERE token = ?1 LIMIT 1`,
  )
    .bind(token)
    .first<ReplayShare & { websiteId: string }>();
  if (!row || (row.expiresAt != null && row.expiresAt <= now)) return null;
  return row;
}

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
