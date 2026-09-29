import {
  normalizeSurveyAppearance,
  normalizeSurveyQuestions,
  surveyPalette,
  surveyScheduleOpen,
  type SurveyQuestion,
} from '@flareboard/shared';
import type { Env } from '../env';

/** Columns every public survey read needs. */
export const SURVEY_COLUMNS = `survey_id as id, website_id as websiteId, name, question, type, options, questions,
  appearance, enabled, trigger_path as triggerPath, trigger_event as triggerEvent,
  display_delay_seconds as displayDelaySeconds, display_rules as displayRules, sample_rate as sampleRate,
  response_limit as responseLimit, starts_at as startsAt, ends_at as endsAt,
  repeat_interval_days as repeatIntervalDays, hosted_enabled as hostedEnabled, slug`;

export type SurveyDbRow = {
  id: string;
  websiteId: string;
  name: string;
  question: string;
  type: string;
  options: string | null;
  questions: string | null;
  appearance: string | null;
  enabled: number;
  triggerPath: string | null;
  triggerEvent: string | null;
  displayDelaySeconds: number | null;
  displayRules: string | null;
  sampleRate: number | null;
  responseLimit: number | null;
  startsAt: number | null;
  endsAt: number | null;
  repeatIntervalDays: number | null;
  hostedEnabled: number;
  slug: string | null;
};

export function surveyRowQuestions(row: SurveyDbRow): SurveyQuestion[] {
  return normalizeSurveyQuestions(row);
}

/** Appearance plus resolved colors, for renderers that cannot use the dashboard's CSS tokens. */
export function publicAppearance(raw: unknown) {
  const appearance = normalizeSurveyAppearance(raw);
  return { ...appearance, colors: surveyPalette(appearance.accent) };
}

function stringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function displayRules(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item && typeof item.field === 'string' && typeof item.operator === 'string' && typeof item.value === 'string',
      )
      .map((item) => ({
        field: item.field as string,
        operator: item.operator as string,
        value: item.value as string,
        ...(typeof item.key === 'string' ? { key: item.key as string } : {}),
      }));
  } catch {
    return [];
  }
}

/**
 * One survey as the tracker and the headless API see it. The top-level question/type/options
 * are the legacy single-question fields (trackers released before multi-question surveys render
 * only those). Newer renderers use `questions`, `appearance`, `sampleRate` and
 * `repeatIntervalDays`. Schedule and response limits are enforced before a survey is listed.
 */
export function publicSurvey(row: SurveyDbRow) {
  return {
    id: row.id,
    name: row.name,
    question: row.question,
    type: row.type,
    options: stringList(row.options),
    triggerPath: row.triggerPath,
    triggerEvent: row.triggerEvent,
    displayDelaySeconds: Math.min(60, Math.max(0, Number(row.displayDelaySeconds ?? 0))),
    displayRules: displayRules(row.displayRules),
    version: 2,
    questions: surveyRowQuestions(row),
    appearance: publicAppearance(row.appearance),
    sampleRate: Math.min(100, Math.max(0, Number(row.sampleRate ?? 100))),
    repeatIntervalDays: row.repeatIntervalDays ?? null,
    endsAt: row.endsAt ?? null,
  };
}

/** Enabled surveys whose schedule is open and whose response limit is not reached. */
export async function listActiveSurveys(env: Env, websiteId: string, now = Date.now(), limit = 10) {
  const rows = await env.DB.prepare(
    `SELECT ${SURVEY_COLUMNS}
     FROM survey
     WHERE website_id = ?1
       AND enabled = 1
       AND (starts_at IS NULL OR starts_at <= ?2)
       AND (ends_at IS NULL OR ends_at > ?2)
       AND (
         response_limit IS NULL
         OR (SELECT COUNT(*) FROM survey_response r WHERE r.survey_id = survey.survey_id AND r.completed = 1) < response_limit
       )
     ORDER BY created_at ASC
     LIMIT ?3`,
  )
    .bind(websiteId, now, limit)
    .all<SurveyDbRow>();
  return (rows.results ?? []).map(publicSurvey);
}

export async function completedResponseCount(env: Env, surveyId: string) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM survey_response WHERE survey_id = ?1 AND completed = 1',
  )
    .bind(surveyId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Why a survey no longer takes new responses, or null when it is open. */
export async function surveyClosedReason(env: Env, row: SurveyDbRow, now = Date.now()) {
  if (!row.enabled) return 'disabled' as const;
  if (!surveyScheduleOpen(row, now)) return 'schedule' as const;
  if (row.responseLimit != null && (await completedResponseCount(env, row.id)) >= row.responseLimit) {
    return 'limit' as const;
  }
  return null;
}
