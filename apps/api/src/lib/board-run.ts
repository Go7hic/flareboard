import { eq } from 'drizzle-orm';
import { createDb, schema, type Website } from '@flareboard/db';
import {
  mergeInsightFilters,
  statsQuerySchema,
  type AuthUser,
  type InsightResult,
  type PropertyFilter,
} from '@flareboard/shared';
import { rolling24hRange } from '@flareboard/shared/date-range';
import { siteCalendarDaysRange } from '@flareboard/shared/timezone';
import type { Env } from '../env';
import { filterBoardWidgetsForPublicShare, parseBoardWidgets, type BoardWidget } from './board-widgets';
import { resolveInsightQuery, runInsightQuery } from './insights';
import { InsightQueryError } from './property-filters';
import { getPageviews, getWebsiteById, getWebsiteStats } from './queries';
import { clampReportRange } from './report-range';

const DAY_PRESETS = { '7d': 7, '30d': 30, '90d': 90 } as const;

/** Window of a board range preset (24h rolling, else whole site-calendar days). */
export function boardPresetRange(preset: unknown, timezone = 'UTC') {
  if (preset === '24h') return rolling24hRange();
  const days = DAY_PRESETS[preset as keyof typeof DAY_PRESETS] ?? 7;
  return siteCalendarDaysRange(days, timezone);
}

/** Explicit `startAt` / `endAt` from the query (bounded), else the board's preset. */
export function boardRunRange(query: Record<string, string>, preset: unknown) {
  const parsed = statsQuerySchema.safeParse(query);
  if (parsed.success && parsed.data.startAt != null && parsed.data.endAt != null) {
    return clampReportRange(parsed.data.startAt, parsed.data.endAt);
  }
  return boardPresetRange(preset);
}

export type BoardRunWidget = BoardWidget & {
  stats?: Awaited<ReturnType<typeof getWebsiteStats>>;
  series?: Array<{ x: string; y: number }>;
  result?: InsightResult;
  insightName?: string;
  /** Saved query that no longer validates (the rest of the board still renders). */
  error?: string;
};

function resetFloor(website: Website | null) {
  const floor = website?.resetAt instanceof Date ? website.resetAt.getTime() : null;
  return floor && floor > 0 ? floor : null;
}

/** Runs one saved insight with extra (board-wide) filters merged into its own. */
export async function runSavedInsight(
  env: Env,
  insight: typeof schema.insight.$inferSelect,
  startAt: number,
  endAt: number,
  filters: readonly PropertyFilter[],
): Promise<InsightResult> {
  const website = await getWebsiteById(env, insight.websiteId);
  const query = mergeInsightFilters(resolveInsightQuery(insight.type, insight.query), filters);
  return runInsightQuery(env, insight.websiteId, insight.type, query, startAt, endAt, {
    timezone: website?.timezone ?? 'UTC',
    minStartAt: resetFloor(website),
  });
}

/**
 * Data of every widget of a board the `viewer` may see: site stats for stats widgets and the
 * insight result for insight widgets, with the board filters applied to every insight.
 */
export async function runBoardWidgets(
  env: Env,
  viewer: AuthUser,
  parameters: unknown,
  options: { startAt: number; endAt: number; filters: readonly PropertyFilter[] },
): Promise<BoardRunWidget[]> {
  const widgets = await filterBoardWidgetsForPublicShare(env, viewer, parseBoardWidgets(parameters));
  const db = createDb(env.DB);
  return Promise.all(
    widgets.map(async (widget): Promise<BoardRunWidget> => {
      if (widget.type === 'stats' && widget.websiteId) {
        const website = await getWebsiteById(env, widget.websiteId);
        const [stats, pageviews] = await Promise.all([
          getWebsiteStats(env, widget.websiteId, options.startAt, options.endAt),
          getPageviews(env, widget.websiteId, options.startAt, options.endAt, 'day', website?.timezone ?? 'UTC'),
        ]);
        return { ...widget, stats, series: pageviews.pageviews };
      }
      if (widget.type === 'insight' && widget.insightId) {
        const [insight] = await db
          .select()
          .from(schema.insight)
          .where(eq(schema.insight.insightId, widget.insightId))
          .limit(1);
        if (!insight) return widget;
        try {
          const result = await runSavedInsight(env, insight, options.startAt, options.endAt, options.filters);
          return { ...widget, insightName: insight.name, result };
        } catch (error) {
          if (error instanceof InsightQueryError) return { ...widget, insightName: insight.name, error: error.message };
          throw error;
        }
      }
      return widget;
    }),
  );
}
