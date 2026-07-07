import { EVENT_TYPE } from '@flareboard/shared';
import type { Env } from '../env';
import {
  getFunnelReport,
  getJourneyFlowReport,
  getRetentionReport,
  getStickinessReport,
} from './advanced-reports';
import { getEventSeries, getMetrics, getPageviews, getWebsiteMetricsSeries } from './queries';

export type InsightType = 'trend' | 'funnel' | 'retention' | 'path' | 'stickiness' | 'table';

export type InsightQuery = {
  event?: string | null;
  events?: string[];
  path?: string | null;
  steps?: string[];
  metric?: 'pageviews' | 'visitors' | 'visits' | 'events';
  dimension?: string;
  actor?: 'person' | 'session';
  unit?: 'hour' | 'day' | 'week' | 'month';
  limit?: number;
};

export type InsightLike = {
  id: string;
  websiteId: string;
  userId: string;
  type: InsightType | string;
  name: string;
  description: string;
  query: InsightQuery;
  createdAt: number | Date | null;
  updatedAt: number | Date | null;
};

function timeValue(value: number | Date | null) {
  if (value instanceof Date) return value.getTime();
  return value;
}

function normalizeUnit(unit: InsightQuery['unit']) {
  if (unit === 'hour' || unit === 'month') return unit;
  return 'day';
}

function normalizeQuery(query: unknown): InsightQuery {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return {};
  return query as InsightQuery;
}

export function serializeInsight(row: InsightLike) {
  return {
    id: row.id,
    websiteId: row.websiteId,
    userId: row.userId,
    type: row.type,
    name: row.name,
    description: row.description,
    query: normalizeQuery(row.query),
    createdAt: timeValue(row.createdAt),
    updatedAt: timeValue(row.updatedAt),
  };
}

export async function runInsightQuery(
  env: Env,
  websiteId: string,
  type: InsightType,
  query: InsightQuery,
  startAt: number,
  endAt: number,
) {
  if (type === 'trend') {
    const unit = normalizeUnit(query.unit);
    if (query.metric === 'events' || query.event) {
      const event = query.event || query.events?.[0] || '';
      if (!event) {
        const rows = await env.DB.prepare(
          `SELECT strftime(?4, datetime(created_at / 1000, 'unixepoch')) as x,
                  COUNT(*) as y
           FROM website_event
           WHERE website_id = ?1
             AND created_at >= ?2
             AND created_at <= ?3
             AND event_type = ?5
           GROUP BY x
           ORDER BY x ASC`,
        )
          .bind(
            websiteId,
            startAt,
            endAt,
            unit === 'hour' ? '%Y-%m-%d %H:00' : unit === 'month' ? '%Y-%m' : '%Y-%m-%d',
            EVENT_TYPE.customEvent,
          )
          .all<{ x: string; y: number }>();
        return { kind: 'trend', series: rows.results ?? [], startAt, endAt };
      }
      const series = await getEventSeries(env, websiteId, startAt, endAt, event, unit);
      return { kind: 'trend', event, series, startAt, endAt };
    }
    if (query.metric === 'visitors' || query.metric === 'visits') {
      const series = await getWebsiteMetricsSeries(env, websiteId, startAt, endAt, unit);
      return {
        kind: 'trend',
        metric: query.metric,
        series: query.metric === 'visitors' ? series.visitors : series.pageviews,
        startAt,
        endAt,
      };
    }
    const pageviews = await getPageviews(env, websiteId, startAt, endAt, unit);
    return { kind: 'trend', metric: 'pageviews', series: pageviews.pageviews, startAt, endAt };
  }

  if (type === 'funnel') {
    const steps = (query.events ?? []).filter(Boolean);
    return {
      kind: 'funnel',
      ...(await getFunnelReport(env, websiteId, startAt, endAt, steps)),
      startAt,
      endAt,
    };
  }

  if (type === 'retention') {
    return { kind: 'retention', ...(await getRetentionReport(env, websiteId, startAt, endAt)) };
  }

  if (type === 'path') {
    const prefix = (query.steps?.length ? query.steps : query.path ? [query.path] : []).filter(Boolean);
    return {
      kind: 'path',
      ...(await getJourneyFlowReport(env, websiteId, startAt, endAt, prefix, query.limit ?? 20)),
    };
  }

  if (type === 'stickiness') {
    return {
      kind: 'stickiness',
      ...(await getStickinessReport(
        env,
        websiteId,
        startAt,
        endAt,
        query.event ?? query.events?.[0] ?? null,
        query.actor ?? 'person',
      )),
    };
  }

  const dimension = query.dimension ?? (query.metric === 'events' ? 'event' : 'path');
  const rows = await getMetrics(env, websiteId, startAt, endAt, dimension, query.limit ?? 10);
  return { kind: 'table', dimension, rows, startAt, endAt };
}
