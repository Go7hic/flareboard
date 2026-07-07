import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';

export type AiEventRow = {
  id: string;
  sessionId: string;
  visitId: string;
  urlPath: string;
  createdAt: number;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  status: string | null;
  quality: string | null;
  release: string | null;
  environment: string | null;
};

export type AiFilters = {
  model?: string;
  status?: string;
  provider?: string;
  quality?: string;
  release?: string;
  environment?: string;
};

const aiPropsSql = `
  WITH props AS (
    SELECT
      website_event_id,
      MAX(CASE WHEN data_key = 'provider' THEN string_value END) as provider,
      MAX(CASE WHEN data_key = 'model' THEN string_value END) as model,
      MAX(CASE WHEN data_key = 'inputTokens' THEN number_value END) as inputTokens,
      MAX(CASE WHEN data_key = 'outputTokens' THEN number_value END) as outputTokens,
      MAX(CASE WHEN data_key = 'totalTokens' THEN number_value END) as totalTokens,
      MAX(CASE WHEN data_key = 'costUsd' THEN number_value END) as costUsd,
      MAX(CASE WHEN data_key = 'latencyMs' THEN number_value END) as latencyMs,
      MAX(CASE WHEN data_key = 'status' THEN string_value END) as status,
      MAX(CASE WHEN data_key = 'quality' THEN string_value END) as quality,
      MAX(CASE WHEN data_key = 'release' THEN string_value END) as release,
      MAX(CASE WHEN data_key = 'environment' THEN string_value END) as environment
    FROM event_data
    WHERE website_id = ?1
    GROUP BY website_event_id
  )
`;

export async function getAiEvents(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: AiFilters = {},
  limit = 100,
) {
  const rows = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       e.event_id as id,
       e.session_id as sessionId,
       e.visit_id as visitId,
       e.url_path as urlPath,
       e.created_at as createdAt,
       props.provider,
       props.model,
       props.inputTokens,
       props.outputTokens,
       props.totalTokens,
       props.costUsd,
       props.latencyMs,
       props.status,
       props.quality,
       props.release,
       props.environment
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     ORDER BY e.created_at DESC
     LIMIT ?11`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
      Math.min(Math.max(limit, 1), 500),
    )
    .all<AiEventRow>();

  return rows.results ?? [];
}

export async function getAiStats(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: AiFilters = {},
) {
  const row = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       COUNT(*) as calls,
       COUNT(DISTINCT e.session_id) as sessions,
       COALESCE(SUM(COALESCE(props.totalTokens, props.inputTokens, 0) + COALESCE(CASE WHEN props.totalTokens IS NULL THEN props.outputTokens ELSE 0 END, 0)), 0) as tokens,
       COALESCE(SUM(props.costUsd), 0) as costUsd,
       SUM(CASE WHEN props.status = 'error' THEN 1 ELSE 0 END) as errors,
       AVG(props.latencyMs) as avgLatencyMs
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .first<{
      calls: number;
      sessions: number;
      tokens: number;
      costUsd: number;
      errors: number;
      avgLatencyMs: number | null;
    }>();

  const models = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       COALESCE(props.model, 'unknown') as model,
       COUNT(*) as calls,
       COALESCE(SUM(COALESCE(props.totalTokens, props.inputTokens, 0) + COALESCE(CASE WHEN props.totalTokens IS NULL THEN props.outputTokens ELSE 0 END, 0)), 0) as tokens,
       COALESCE(SUM(props.costUsd), 0) as costUsd,
       SUM(CASE WHEN props.status = 'error' THEN 1 ELSE 0 END) as errors,
       AVG(props.latencyMs) as avgLatencyMs
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     GROUP BY COALESCE(props.model, 'unknown')
     ORDER BY calls DESC, model ASC
     LIMIT 10`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ model: string; calls: number; tokens: number; costUsd: number; errors: number; avgLatencyMs: number | null }>();

  const statuses = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       COALESCE(props.status, 'success') as status,
       COUNT(*) as calls
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     GROUP BY COALESCE(props.status, 'success')
     ORDER BY calls DESC, status ASC`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ status: string; calls: number }>();

  const providers = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       COALESCE(props.provider, 'unknown') as provider,
       COUNT(*) as calls,
       COALESCE(SUM(props.costUsd), 0) as costUsd,
       SUM(CASE WHEN props.status = 'error' THEN 1 ELSE 0 END) as errors
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     GROUP BY COALESCE(props.provider, 'unknown')
     ORDER BY calls DESC, provider ASC`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ provider: string; calls: number; costUsd: number; errors: number }>();

  const qualities = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       COALESCE(props.quality, 'unknown') as quality,
       COUNT(*) as calls
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     GROUP BY COALESCE(props.quality, 'unknown')
     ORDER BY calls DESC, quality ASC`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ quality: string; calls: number }>();

  const releases = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       COALESCE(props.release, 'unknown') as release,
       COUNT(*) as calls,
       COALESCE(SUM(props.costUsd), 0) as costUsd,
       SUM(CASE WHEN props.status = 'error' THEN 1 ELSE 0 END) as errors
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     GROUP BY COALESCE(props.release, 'unknown')
     ORDER BY calls DESC, release ASC
     LIMIT 10`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ release: string; calls: number; costUsd: number; errors: number }>();

  const environments = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       COALESCE(props.environment, 'unknown') as environment,
       COUNT(*) as calls,
       COALESCE(SUM(props.costUsd), 0) as costUsd,
       SUM(CASE WHEN props.status = 'error' THEN 1 ELSE 0 END) as errors
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     GROUP BY COALESCE(props.environment, 'unknown')
     ORDER BY calls DESC, environment ASC
     LIMIT 10`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .all<{ environment: string; calls: number; costUsd: number; errors: number }>();

  const trend = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       date(e.created_at / 1000, 'unixepoch') as date,
       COUNT(*) as calls,
       COUNT(DISTINCT e.session_id) as sessions,
       COALESCE(SUM(COALESCE(props.totalTokens, props.inputTokens, 0) + COALESCE(CASE WHEN props.totalTokens IS NULL THEN props.outputTokens ELSE 0 END, 0)), 0) as tokens,
       COALESCE(SUM(props.costUsd), 0) as costUsd,
       SUM(CASE WHEN props.status = 'error' THEN 1 ELSE 0 END) as errors,
       AVG(props.latencyMs) as avgLatencyMs
     FROM website_event e
     LEFT JOIN props ON props.website_event_id = e.event_id
     WHERE e.website_id = ?1
       AND e.created_at >= ?2
       AND e.created_at <= ?3
       AND e.event_type = ?4
       AND (?5 IS NULL OR props.model = ?5)
       AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
       AND (?7 IS NULL OR props.provider = ?7)
       AND (?8 IS NULL OR props.quality = ?8)
       AND (?9 IS NULL OR props.release = ?9)
       AND (?10 IS NULL OR props.environment = ?10)
     GROUP BY date(e.created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(
      websiteId,
      startAt,
      endAt,
      EVENT_TYPE.ai,
      filters.model || null,
      filters.status || null,
      filters.provider || null,
      filters.quality || null,
      filters.release || null,
      filters.environment || null,
    )
    .all<{
      date: string;
      calls: number;
      sessions: number;
      tokens: number;
      costUsd: number;
      errors: number;
      avgLatencyMs: number | null;
    }>();

  return {
    calls: row?.calls ?? 0,
    sessions: row?.sessions ?? 0,
    tokens: row?.tokens ?? 0,
    costUsd: row?.costUsd ?? 0,
    errors: row?.errors ?? 0,
    avgLatencyMs: row?.avgLatencyMs != null ? Math.round(row.avgLatencyMs) : null,
    models: (models.results ?? []).map((item) => ({
      ...item,
      avgLatencyMs: item.avgLatencyMs != null ? Math.round(item.avgLatencyMs) : null,
      errorRate: item.calls ? Math.round((item.errors / item.calls) * 10000) / 100 : 0,
    })),
    statuses: statuses.results ?? [],
    providers: providers.results ?? [],
    qualities: qualities.results ?? [],
    releases: releases.results ?? [],
    environments: environments.results ?? [],
    trend: (trend.results ?? []).map((item) => ({
      ...item,
      avgLatencyMs: item.avgLatencyMs != null ? Math.round(item.avgLatencyMs) : null,
    })),
  };
}
