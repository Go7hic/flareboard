import {
  INSIGHT_TYPES,
  parseInsightQuery,
  type FunnelActorsResult,
  type InsightQuery,
  type InsightResult,
  type InsightType,
} from '@flareboard/shared';
import type { Env } from '../env';
import { getJourneyFlowReport } from './advanced-reports';
import { runLifecycle, runRetention, runStickiness, retentionPlanFromQuery } from './insight-activity';
import { runFunnel, runFunnelActors } from './insight-funnels';
import type { InsightContext } from './insight-sql';
import { runTrends } from './insight-trends';
import { InsightQueryError } from './property-filters';
import { getMetrics, getWebsiteById } from './queries';
import { clampReportRange } from './report-range';
import { siteDb } from './site-db';

export type { InsightQuery, InsightType };

export type InsightLike = {
  id: string;
  websiteId: string;
  userId: string;
  type: InsightType | string;
  name: string;
  description: string;
  query: unknown;
  createdAt: number | Date | null;
  updatedAt: number | Date | null;
};

function timeValue(value: number | Date | null) {
  if (value instanceof Date) return value.getTime();
  return value;
}

export function isInsightType(type: string): type is InsightType {
  return (INSIGHT_TYPES as readonly string[]).includes(type);
}

/** Stored or submitted query as v2, or an InsightQueryError. */
export function resolveInsightQuery(type: string, raw: unknown): InsightQuery {
  if (!isInsightType(type)) throw new InsightQueryError(`Unknown insight type "${type}"`);
  const parsed = parseInsightQuery(type, raw);
  if (!parsed.ok) throw new InsightQueryError(parsed.error);
  return parsed.query;
}

/** API shape of a saved insight. `query` is always v2; unreadable rows keep their raw query. */
export function serializeInsight(row: InsightLike) {
  let query: unknown = row.query;
  if (isInsightType(row.type)) {
    const parsed = parseInsightQuery(row.type, row.query);
    if (parsed.ok) query = parsed.query;
  }
  return {
    id: row.id,
    websiteId: row.websiteId,
    userId: row.userId,
    type: row.type,
    name: row.name,
    description: row.description,
    query,
    createdAt: timeValue(row.createdAt),
    updatedAt: timeValue(row.updatedAt),
  };
}

export type RunInsightOptions = {
  /** Site timezone for buckets; looked up when omitted. */
  timezone?: string;
  /** Statistics reset floor: nothing before it is counted. */
  minStartAt?: number | null;
};

async function insightContext(
  env: Env,
  websiteId: string,
  startAt: number,
  endAt: number,
  options: RunInsightOptions,
): Promise<InsightContext> {
  const timezone = options.timezone ?? (await getWebsiteById(env, websiteId))?.timezone ?? 'UTC';
  const range = clampReportRange(startAt, endAt);
  const floor = options.minStartAt ?? 0;
  return {
    db: siteDb(env, websiteId),
    websiteId,
    startAt: floor > range.startAt ? Math.min(floor, range.endAt) : range.startAt,
    endAt: range.endAt,
    timezone,
  };
}

export async function runInsightQuery(
  env: Env,
  websiteId: string,
  type: InsightType | string,
  rawQuery: unknown,
  startAt: number,
  endAt: number,
  options: RunInsightOptions = {},
): Promise<InsightResult> {
  const query = resolveInsightQuery(type, rawQuery);
  const ctx = await insightContext(env, websiteId, startAt, endAt, options);

  switch (type as InsightType) {
    case 'trend':
      return runTrends(ctx, query);
    case 'funnel':
      return runFunnel(ctx, query);
    case 'retention':
      return runRetention(ctx, retentionPlanFromQuery(ctx, query, options.minStartAt ?? undefined));
    case 'lifecycle':
      return runLifecycle(ctx, query);
    case 'stickiness':
      return runStickiness(ctx, query.series?.[0] ?? { kind: 'all' }, query.countBy ?? 'person', query.filters);
    case 'path': {
      const report = await getJourneyFlowReport(
        env,
        websiteId,
        ctx.startAt,
        ctx.endAt,
        query.path?.steps ?? [],
        query.path?.limit ?? 20,
        query.filters?.length ? { properties: query.filters } : null,
      );
      return { kind: 'path', ...report };
    }
    case 'table': {
      const dimension = query.table?.dimension ?? 'path';
      const rows = await getMetrics(env, websiteId, ctx.startAt, ctx.endAt, dimension, query.table?.limit ?? 10);
      return { kind: 'table', dimension, rows, startAt: ctx.startAt, endAt: ctx.endAt };
    }
  }
}

export async function runInsightFunnelActors(
  env: Env,
  websiteId: string,
  rawQuery: unknown,
  startAt: number,
  endAt: number,
  actors: Parameters<typeof runFunnelActors>[2],
  options: RunInsightOptions = {},
): Promise<FunnelActorsResult> {
  const query = resolveInsightQuery('funnel', rawQuery);
  const ctx = await insightContext(env, websiteId, startAt, endAt, options);
  return runFunnelActors(ctx, query, actors);
}
