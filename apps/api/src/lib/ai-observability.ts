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

type AiPropsRow = {
  sessionId: string;
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

// Scoped to AI events inside the queried time window (binds: ?1 websiteId,
// ?2 startAt, ?3 endAt, ?4 event type) so it never scans a website's full
// event_data set.
const aiPropsSql = `
  WITH props AS (
    SELECT
      d.website_event_id,
      MAX(CASE WHEN d.data_key = 'provider' THEN d.string_value END) as provider,
      MAX(CASE WHEN d.data_key = 'model' THEN d.string_value END) as model,
      MAX(CASE WHEN d.data_key = 'inputTokens' THEN d.number_value END) as inputTokens,
      MAX(CASE WHEN d.data_key = 'outputTokens' THEN d.number_value END) as outputTokens,
      MAX(CASE WHEN d.data_key = 'totalTokens' THEN d.number_value END) as totalTokens,
      MAX(CASE WHEN d.data_key = 'costUsd' THEN d.number_value END) as costUsd,
      MAX(CASE WHEN d.data_key = 'latencyMs' THEN d.number_value END) as latencyMs,
      MAX(CASE WHEN d.data_key = 'status' THEN d.string_value END) as status,
      MAX(CASE WHEN d.data_key = 'quality' THEN d.string_value END) as quality,
      MAX(CASE WHEN d.data_key = 'release' THEN d.string_value END) as release,
      MAX(CASE WHEN d.data_key = 'environment' THEN d.string_value END) as environment
    FROM event_data d
    JOIN website_event ev
      ON ev.event_id = d.website_event_id
     AND ev.website_id = ?1
     AND ev.event_type = ?4
     AND ev.created_at >= ?2
     AND ev.created_at <= ?3
    WHERE d.website_id = ?1
      AND d.data_key IN ('provider', 'model', 'inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'latencyMs', 'status', 'quality', 'release', 'environment')
    GROUP BY d.website_event_id
  )
`;

const aiFilterSql = `
  AND (?5 IS NULL OR props.model = ?5)
  AND (?6 IS NULL OR COALESCE(props.status, 'success') = ?6)
  AND (?7 IS NULL OR props.provider = ?7)
  AND (?8 IS NULL OR props.quality = ?8)
  AND (?9 IS NULL OR props.release = ?9)
  AND (?10 IS NULL OR props.environment = ?10)
`;

function aiFilterBinds(websiteId: string, startAt: number, endAt: number, filters: AiFilters) {
  return [
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
  ];
}

function tokenCount(row: Pick<AiPropsRow, 'totalTokens' | 'inputTokens' | 'outputTokens'>) {
  if (row.totalTokens != null) return row.totalTokens;
  return (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

function normalizedStatus(status: string | null) {
  return status ?? 'success';
}

function trendDate(createdAt: number) {
  return new Date(createdAt).toISOString().slice(0, 10);
}

function roundAvgLatency(value: number | null) {
  return value != null ? Math.round(value) : null;
}

function topByCalls<T extends { calls: number }>(rows: T[], limit: number, tieBreak: (a: T, b: T) => number) {
  return [...rows].sort((a, b) => b.calls - a.calls || tieBreak(a, b)).slice(0, limit);
}

async function queryAiPropsRows(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  filters: AiFilters,
) {
  const rows = await env.DB.prepare(
    `${aiPropsSql}
     SELECT
       e.session_id as sessionId,
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
       ${aiFilterSql}`,
  )
    .bind(...aiFilterBinds(websiteId, startAt, endAt, filters))
    .all<AiPropsRow>();

  return rows.results ?? [];
}

function aggregateAiStats(rows: AiPropsRow[]) {
  const sessions = new Set<string>();
  let tokens = 0;
  let costUsd = 0;
  let errors = 0;
  let latencySum = 0;
  let latencyCount = 0;

  const modelMap = new Map<string, { calls: number; tokens: number; costUsd: number; errors: number; latencySum: number; latencyCount: number }>();
  const statusMap = new Map<string, number>();
  const providerMap = new Map<string, { calls: number; costUsd: number; errors: number }>();
  const qualityMap = new Map<string, number>();
  const releaseMap = new Map<string, { calls: number; costUsd: number; errors: number }>();
  const environmentMap = new Map<string, { calls: number; costUsd: number; errors: number }>();
  const trendMap = new Map<string, { calls: number; sessions: Set<string>; tokens: number; costUsd: number; errors: number; latencySum: number; latencyCount: number }>();

  for (const row of rows) {
    sessions.add(row.sessionId);
    const rowTokens = tokenCount(row);
    tokens += rowTokens;
    costUsd += row.costUsd ?? 0;
    const isError = row.status === 'error';
    if (isError) errors += 1;
    if (row.latencyMs != null) {
      latencySum += row.latencyMs;
      latencyCount += 1;
    }

    const model = row.model ?? 'unknown';
    const modelRow = modelMap.get(model) ?? { calls: 0, tokens: 0, costUsd: 0, errors: 0, latencySum: 0, latencyCount: 0 };
    modelRow.calls += 1;
    modelRow.tokens += rowTokens;
    modelRow.costUsd += row.costUsd ?? 0;
    if (isError) modelRow.errors += 1;
    if (row.latencyMs != null) {
      modelRow.latencySum += row.latencyMs;
      modelRow.latencyCount += 1;
    }
    modelMap.set(model, modelRow);

    const status = normalizedStatus(row.status);
    statusMap.set(status, (statusMap.get(status) ?? 0) + 1);

    const provider = row.provider ?? 'unknown';
    const providerRow = providerMap.get(provider) ?? { calls: 0, costUsd: 0, errors: 0 };
    providerRow.calls += 1;
    providerRow.costUsd += row.costUsd ?? 0;
    if (isError) providerRow.errors += 1;
    providerMap.set(provider, providerRow);

    const quality = row.quality ?? 'unknown';
    qualityMap.set(quality, (qualityMap.get(quality) ?? 0) + 1);

    const release = row.release ?? 'unknown';
    const releaseRow = releaseMap.get(release) ?? { calls: 0, costUsd: 0, errors: 0 };
    releaseRow.calls += 1;
    releaseRow.costUsd += row.costUsd ?? 0;
    if (isError) releaseRow.errors += 1;
    releaseMap.set(release, releaseRow);

    const environment = row.environment ?? 'unknown';
    const environmentRow = environmentMap.get(environment) ?? { calls: 0, costUsd: 0, errors: 0 };
    environmentRow.calls += 1;
    environmentRow.costUsd += row.costUsd ?? 0;
    if (isError) environmentRow.errors += 1;
    environmentMap.set(environment, environmentRow);

    const date = trendDate(row.createdAt);
    const trendRow = trendMap.get(date) ?? {
      calls: 0,
      sessions: new Set<string>(),
      tokens: 0,
      costUsd: 0,
      errors: 0,
      latencySum: 0,
      latencyCount: 0,
    };
    trendRow.calls += 1;
    trendRow.sessions.add(row.sessionId);
    trendRow.tokens += rowTokens;
    trendRow.costUsd += row.costUsd ?? 0;
    if (isError) trendRow.errors += 1;
    if (row.latencyMs != null) {
      trendRow.latencySum += row.latencyMs;
      trendRow.latencyCount += 1;
    }
    trendMap.set(date, trendRow);
  }

  const models = topByCalls(
    [...modelMap.entries()].map(([model, item]) => ({
      model,
      calls: item.calls,
      tokens: item.tokens,
      costUsd: item.costUsd,
      errors: item.errors,
      avgLatencyMs: roundAvgLatency(item.latencyCount ? item.latencySum / item.latencyCount : null),
      errorRate: item.calls ? Math.round((item.errors / item.calls) * 10000) / 100 : 0,
    })),
    10,
    (a, b) => a.model.localeCompare(b.model),
  );

  const statuses = [...statusMap.entries()]
    .map(([status, calls]) => ({ status, calls }))
    .sort((a, b) => b.calls - a.calls || a.status.localeCompare(b.status));

  const providers = [...providerMap.entries()]
    .map(([provider, item]) => ({ provider, calls: item.calls, costUsd: item.costUsd, errors: item.errors }))
    .sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider));

  const qualities = [...qualityMap.entries()]
    .map(([quality, calls]) => ({ quality, calls }))
    .sort((a, b) => b.calls - a.calls || a.quality.localeCompare(b.quality));

  const releases = topByCalls(
    [...releaseMap.entries()].map(([release, item]) => ({
      release,
      calls: item.calls,
      costUsd: item.costUsd,
      errors: item.errors,
    })),
    10,
    (a, b) => a.release.localeCompare(b.release),
  );

  const environments = topByCalls(
    [...environmentMap.entries()].map(([environment, item]) => ({
      environment,
      calls: item.calls,
      costUsd: item.costUsd,
      errors: item.errors,
    })),
    10,
    (a, b) => a.environment.localeCompare(b.environment),
  );

  const trend = [...trendMap.entries()]
    .map(([date, item]) => ({
      date,
      calls: item.calls,
      sessions: item.sessions.size,
      tokens: item.tokens,
      costUsd: item.costUsd,
      errors: item.errors,
      avgLatencyMs: roundAvgLatency(item.latencyCount ? item.latencySum / item.latencyCount : null),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 90);

  return {
    calls: rows.length,
    sessions: sessions.size,
    tokens,
    costUsd,
    errors,
    avgLatencyMs: roundAvgLatency(latencyCount ? latencySum / latencyCount : null),
    models,
    statuses,
    providers,
    qualities,
    releases,
    environments,
    trend,
  };
}

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
       ${aiFilterSql}
     ORDER BY e.created_at DESC
     LIMIT ?11`,
  )
    .bind(...aiFilterBinds(websiteId, startAt, endAt, filters), Math.min(Math.max(limit, 1), 500))
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
  const rows = await queryAiPropsRows(env, websiteId, startAt, endAt, filters);
  return aggregateAiStats(rows);
}
