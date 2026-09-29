/**
 * AI surfaces: input schemas of the tools shared by the MCP server and the "Ask Flareboard"
 * assistant (apps/api/src/lib/ai-tools.ts), and the assistant's wire types used by the dashboard.
 */
import { z } from 'zod';
import type { InsightQuery, InsightResult } from './insight-query';

// ---------------------------------------------------------------------------------------------
// Tool inputs
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export const AI_RANGE_PRESETS = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
  '180d': 180 * DAY_MS,
  '365d': 365 * DAY_MS,
} as const;
export type AiRangePreset = keyof typeof AI_RANGE_PRESETS;
const RANGE_KEYS = Object.keys(AI_RANGE_PRESETS) as [AiRangePreset, ...AiRangePreset[]];

const rangeInput = {
  range: z.enum(RANGE_KEYS).optional(),
  dateFrom: z.string().trim().max(40).optional(),
  dateTo: z.string().trim().max(40).optional(),
};

export const AI_INSIGHT_TYPES = ['trend', 'funnel', 'retention'] as const;
export type AiInsightType = (typeof AI_INSIGHT_TYPES)[number];

export const AI_ANNOTATION_CATEGORIES = ['note', 'release', 'campaign', 'incident', 'experiment'] as const;

export const AI_TOOL_LIMITS = {
  people: 25,
  errorIssues: 25,
} as const;

const empty = z.object({}).passthrough();

export const aiToolInputSchemas = {
  list_websites: empty,
  run_insight: z.object({ type: z.enum(AI_INSIGHT_TYPES), query: z.record(z.unknown()), ...rangeInput }),
  list_event_names: z.object({ search: z.string().trim().max(120).optional(), ...rangeInput }),
  list_property_keys: z.object({ type: z.enum(['event', 'person']), ...rangeInput }),
  list_property_values: z.object({
    type: z.enum(['event', 'person', 'dimension']),
    key: z.string().trim().min(1).max(200),
    search: z.string().trim().max(200).optional(),
    ...rangeInput,
  }),
  get_sql_schema: empty,
  run_sql: z.object({ sql: z.string().trim().min(1).max(20_000) }),
  search_people: z.object({
    search: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(AI_TOOL_LIMITS.people).optional(),
    ...rangeInput,
  }),
  list_error_issues: z.object({
    status: z.enum(['open', 'resolved', 'ignored', 'regressed']).optional(),
    limit: z.number().int().min(1).max(AI_TOOL_LIMITS.errorIssues).optional(),
    ...rangeInput,
  }),
  list_feature_flags: empty,
  evaluate_feature_flag: z.object({
    key: z.string().trim().min(1).max(200),
    distinctId: z.string().trim().min(1).max(200),
    personProperties: z.record(z.unknown()).optional(),
  }),
  list_experiments: z.object({ status: z.enum(['draft', 'running', 'completed']).optional() }),
  create_annotation: z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    category: z.enum(AI_ANNOTATION_CATEGORIES).optional(),
    happenedAt: z.string().trim().max(40).optional(),
  }),
  toggle_feature_flag: z.object({ key: z.string().trim().min(1).max(200), enabled: z.boolean() }),
} as const;

export type AiToolName = keyof typeof aiToolInputSchemas;
export type AiToolInput<N extends AiToolName> = z.infer<(typeof aiToolInputSchemas)[N]>;

/** First validation problem as `path: message`. */
export function aiToolInputError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input';
  return `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`;
}

// ---------------------------------------------------------------------------------------------
// Assistant wire types
// ---------------------------------------------------------------------------------------------

/** Longest question the assistant accepts. */
export const AI_QUESTION_MAX_CHARS = 4_000;

/** Body of `POST /api/websites/:websiteId/assistant/messages`. */
export const aiAskSchema = z.object({
  message: z.string().trim().min(1).max(AI_QUESTION_MAX_CHARS),
  conversationId: z.string().trim().min(1).max(64).nullable().optional(),
});

/** What the dashboard renders for a tool call (the model sees a compact summary instead). */
export type AiToolDisplay =
  | {
      kind: 'insight';
      insightType: AiInsightType;
      query: InsightQuery;
      startAt: number;
      endAt: number;
      /** Dropped from stored history when too large; the dashboard re-runs the query then. */
      result?: InsightResult;
    }
  | { kind: 'table'; title: string; columns: string[]; rows: Array<Record<string, unknown>>; truncated: boolean };

export type AiAssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown; ok: boolean; error?: string; display?: AiToolDisplay };

export type AiAssistantMessage =
  | { id: string; role: 'user'; text: string; createdAt: number }
  | { id: string; role: 'assistant'; blocks: AiAssistantBlock[]; status: 'complete' | 'error' | 'refused' | 'truncated'; createdAt: number };

export type AiConversationSummary = { id: string; title: string; createdAt: number; updatedAt: number };

export type AiAssistantStatus = {
  enabled: boolean;
  /** Hosted mode: requests today and the daily cap; null when uncapped. */
  usage: { used: number; limit: number } | null;
};

/** Server-sent events of `POST /api/websites/:websiteId/assistant/messages` (`data:` JSON lines). */
export type AiStreamEvent =
  | { type: 'conversation'; conversation: AiConversationSummary; userMessageId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; error?: string; display?: AiToolDisplay }
  | { type: 'done'; message: AiAssistantMessage }
  | { type: 'error'; message: string };
