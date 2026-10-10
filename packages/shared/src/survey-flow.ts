import { flagHash } from './flag-hash';

/**
 * Survey model shared by the API (builder + results), ingest (tracker config, headless API,
 * response collection) and the dashboard (builder preview, hosted survey page). This module has
 * no runtime dependencies so the browser can import it (`@flareboard/shared/survey-flow`); the
 * zod request schemas live in `./surveys`.
 *
 * A survey is an ordered list of up to SURVEY_MAX_QUESTIONS questions. Each question may carry
 * branching rules ("after this answer, go to question X / end the survey"). Rules only point
 * forward, so every walk through a survey terminates. Answers are stored per response as a JSON
 * object keyed by question id.
 *
 * Legacy surveys (one question in the `question` / `type` / `options` columns) are read through
 * `legacySurveyQuestion`, which mirrors the backfill in migration 0049.
 */

export const SURVEY_MAX_QUESTIONS = 10;
export const SURVEY_MAX_OPTIONS = 20;
/** Branch target that ends the survey. */
export const SURVEY_END = 'end';
/** Choice-condition value matching an "Other" free-text answer. */
export const SURVEY_OTHER = '$other';
export const SURVEY_TEXT_MAX = 2000;
export const SURVEY_OTHER_TEXT_MAX = 500;
/** Question id used for legacy single-question surveys (migration 0049 backfill). */
export const LEGACY_SURVEY_QUESTION_ID = 'q1';

export const surveyQuestionTypes = ['open', 'rating', 'single_choice', 'multiple_choice', 'link'] as const;
export type SurveyQuestionType = (typeof surveyQuestionTypes)[number];

export type SurveyRatingScale = 5 | 10 | 'nps';

export type SurveyBranchCondition =
  | { type: 'any' }
  | { type: 'choice'; value: string }
  | { type: 'range'; min: number; max: number };

export type SurveyBranchRule = {
  when: SurveyBranchCondition;
  /** A later question's id, or SURVEY_END. */
  next: string;
};

type SurveyQuestionBase = {
  id: string;
  question: string;
  description: string;
  /** Optional questions may be skipped. Link steps are always skippable. */
  optional: boolean;
  /** Overrides the survey-level submit/next button text for this step. */
  buttonText: string;
  branching: SurveyBranchRule[];
};

export type SurveyOpenQuestion = SurveyQuestionBase & { type: 'open'; placeholder: string };
export type SurveyRatingQuestion = SurveyQuestionBase & {
  type: 'rating';
  scale: SurveyRatingScale;
  lowerLabel: string;
  upperLabel: string;
};
export type SurveySingleChoiceQuestion = SurveyQuestionBase & {
  type: 'single_choice';
  options: string[];
  hasOther: boolean;
};
export type SurveyMultipleChoiceQuestion = SurveyQuestionBase & {
  type: 'multiple_choice';
  options: string[];
  hasOther: boolean;
};
export type SurveyChoiceQuestion = SurveySingleChoiceQuestion | SurveyMultipleChoiceQuestion;
export type SurveyLinkQuestion = SurveyQuestionBase & { type: 'link'; url: string };
export type SurveyQuestion =
  | SurveyOpenQuestion
  | SurveyRatingQuestion
  | SurveySingleChoiceQuestion
  | SurveyMultipleChoiceQuestion
  | SurveyLinkQuestion;

/** Inclusive score range of a rating question. */
export function surveyRatingRange(scale: SurveyRatingScale): { min: number; max: number } {
  if (scale === 'nps') return { min: 0, max: 10 };
  return { min: 1, max: scale };
}

export function isChoiceQuestion(question: SurveyQuestion): question is SurveyChoiceQuestion {
  return question.type === 'single_choice' || question.type === 'multiple_choice';
}

/**
 * Cross-question checks: unique ids, unique options, and branching rules that only point
 * forward and only use conditions the question type can produce.
 */
export function surveyQuestionIssues(questions: SurveyQuestion[]): string[] {
  const issues: string[] = [];
  const indexById = new Map<string, number>();
  questions.forEach((question, index) => {
    if (indexById.has(question.id)) issues.push(`Duplicate question id "${question.id}"`);
    indexById.set(question.id, index);
  });
  questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    if (isChoiceQuestion(question)) {
      const seen = new Set(question.options.map((option) => option.toLowerCase()));
      if (seen.size !== question.options.length) issues.push(`${label}: options must be unique`);
    }
    if (question.type === 'rating') {
      const { min, max } = surveyRatingRange(question.scale);
      if (question.branching.some((rule) => rule.when.type === 'range' && (rule.when.min < min || rule.when.max > max))) {
        issues.push(`${label}: rating branch outside the ${min}-${max} scale`);
      }
    }
    for (const rule of question.branching) {
      if (rule.next !== SURVEY_END) {
        const target = indexById.get(rule.next);
        if (target === undefined) issues.push(`${label}: branch points to an unknown question`);
        else if (target <= index) issues.push(`${label}: branches may only skip forward`);
      }
      const when = rule.when;
      if (when.type === 'choice') {
        if (!isChoiceQuestion(question)) issues.push(`${label}: choice branches need a choice question`);
        else if (when.value === SURVEY_OTHER ? !question.hasOther : !question.options.includes(when.value)) {
          issues.push(`${label}: branch uses an option that does not exist`);
        }
      } else if (when.type === 'range') {
        if (question.type !== 'rating') issues.push(`${label}: range branches need a rating question`);
        if (when.min > when.max) issues.push(`${label}: branch range minimum is above its maximum`);
      }
    }
  });
  return issues;
}

/* ---------------------------------------------------------------------------------------------
 * Appearance
 * ------------------------------------------------------------------------------------------- */

export const surveyPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'] as const;
export type SurveyPosition = (typeof surveyPositions)[number];
export const surveyAccents = ['neutral', 'blue', 'green', 'amber', 'red', 'purple', 'pink'] as const;
export type SurveyAccent = (typeof surveyAccents)[number];
export const surveyColorSchemes = ['light', 'dark', 'auto'] as const;
export type SurveyColorScheme = (typeof surveyColorSchemes)[number];

export type SurveyAppearance = {
  position: SurveyPosition;
  theme: SurveyColorScheme;
  accent: SurveyAccent;
  /** Button text on the last step (empty = "Submit"). Per-question buttonText wins. */
  submitText: string;
  showThankYou: boolean;
  thankYouMessage: string;
};

export const DEFAULT_SURVEY_APPEARANCE: SurveyAppearance = {
  position: 'bottom-right',
  theme: 'auto',
  accent: 'neutral',
  submitText: '',
  showThankYou: true,
  thankYouMessage: '',
};

export type SurveyColors = {
  background: string;
  text: string;
  mutedText: string;
  border: string;
  accent: string;
  accentText: string;
};

/**
 * Fixed, contrast-checked colors (Geist palette) for widgets rendered outside the dashboard,
 * where the dashboard's CSS tokens do not exist. Customers pick a key, never a raw color.
 */
const ACCENT_COLORS: Record<SurveyAccent, { light: [string, string]; dark: [string, string] }> = {
  neutral: { light: ['#171717', '#ffffff'], dark: ['#ededed', '#0a0a0a'] },
  blue: { light: ['#006bff', '#ffffff'], dark: ['#006efe', '#ffffff'] },
  green: { light: ['#107d32', '#ffffff'], dark: ['#00ac3a', '#0a0a0a'] },
  amber: { light: ['#aa4d00', '#ffffff'], dark: ['#ffae00', '#0a0a0a'] },
  red: { light: ['#ea001d', '#ffffff'], dark: ['#f13242', '#ffffff'] },
  purple: { light: ['#8500d1', '#ffffff'], dark: ['#9440d5', '#ffffff'] },
  pink: { light: ['#e4106e', '#ffffff'], dark: ['#f12b82', '#ffffff'] },
};

export function surveyPalette(accent: SurveyAccent): { light: SurveyColors; dark: SurveyColors } {
  const colors = ACCENT_COLORS[accent] ?? ACCENT_COLORS.neutral;
  return {
    light: {
      background: '#ffffff',
      text: '#171717',
      mutedText: '#4d4d4d',
      border: '#eaeaea',
      accent: colors.light[0],
      accentText: colors.light[1],
    },
    dark: {
      background: '#0a0a0a',
      text: '#ededed',
      mutedText: '#a0a0a0',
      border: '#2e2e2e',
      accent: colors.dark[0],
      accentText: colors.dark[1],
    },
  };
}

/* ---------------------------------------------------------------------------------------------
 * Targeting helpers
 * ------------------------------------------------------------------------------------------- */

/**
 * 0-99 sampling bucket for one person and survey. A person is eligible when
 * `surveySampleBucket(...) < sampleRate`. Same FNV-1a hash the tracker already embeds for flags.
 */
export function surveySampleBucket(surveyId: string, bucketingId: string): number {
  return flagHash(`survey:${surveyId}:${bucketingId}`);
}

export function surveyScheduleOpen(
  schedule: { startsAt?: number | null; endsAt?: number | null },
  now: number,
): boolean {
  if (schedule.startsAt != null && now < schedule.startsAt) return false;
  if (schedule.endsAt != null && now >= schedule.endsAt) return false;
  return true;
}

/* ---------------------------------------------------------------------------------------------
 * Answers and branching
 * ------------------------------------------------------------------------------------------- */

export type SurveyAnswerValue = string | number | string[];
export type SurveyAnswers = Record<string, SurveyAnswerValue>;

export function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function asTrimmedString(value: unknown, max: number): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

/**
 * Coerce one raw answer to the question's shape, or undefined when it cannot be one.
 * Accepts the legacy string form ("7" for ratings, "A" for a multiple-choice answer).
 */
export function sanitizeSurveyAnswer(question: SurveyQuestion, raw: unknown): SurveyAnswerValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  switch (question.type) {
    case 'open':
      return asTrimmedString(raw, SURVEY_TEXT_MAX);
    case 'rating': {
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      const { min, max } = surveyRatingRange(question.scale);
      return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
    }
    case 'single_choice': {
      const text = asTrimmedString(raw, SURVEY_OTHER_TEXT_MAX);
      if (!text) return undefined;
      if (question.options.includes(text)) return text;
      return question.hasOther ? text : undefined;
    }
    case 'multiple_choice': {
      const items = Array.isArray(raw) ? raw : [raw];
      const picked: string[] = [];
      let other: string | undefined;
      for (const item of items) {
        const text = asTrimmedString(item, SURVEY_OTHER_TEXT_MAX);
        if (!text) continue;
        if (question.options.includes(text)) {
          if (!picked.includes(text)) picked.push(text);
        } else if (question.hasOther && other === undefined) {
          other = text;
        }
      }
      // Keep the survey's option order so results and exports read consistently.
      const ordered = question.options.filter((option) => picked.includes(option));
      if (other !== undefined) ordered.push(other);
      return ordered.length ? ordered : undefined;
    }
    case 'link':
      return raw === false || raw === '' ? undefined : 'clicked';
  }
}

/** Keep only answers to known questions, coerced to their shapes. */
export function sanitizeSurveyAnswers(questions: SurveyQuestion[], raw: unknown): SurveyAnswers {
  const source = parseJsonValue(raw);
  const answers: SurveyAnswers = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return answers;
  const record = source as Record<string, unknown>;
  for (const question of questions) {
    if (!Object.prototype.hasOwnProperty.call(record, question.id)) continue;
    const value = sanitizeSurveyAnswer(question, record[question.id]);
    if (value !== undefined) answers[question.id] = value;
  }
  return answers;
}

function conditionMatches(question: SurveyQuestion, condition: SurveyBranchCondition, answer: SurveyAnswerValue | undefined) {
  if (condition.type === 'any') return true;
  if (answer === undefined) return false;
  if (condition.type === 'range') {
    return typeof answer === 'number' && answer >= condition.min && answer <= condition.max;
  }
  const values = Array.isArray(answer) ? answer : [String(answer)];
  if (condition.value === SURVEY_OTHER) {
    const options = isChoiceQuestion(question) ? question.options : [];
    return values.some((value) => !options.includes(value));
  }
  return values.includes(condition.value);
}

/**
 * Index of the question shown after `index` given its answer (undefined = skipped), or
 * SURVEY_END. First matching branch rule wins. Without one the survey continues in order.
 * A rule pointing at a missing or earlier question falls through to the next question, so
 * stale configs never loop.
 */
export function nextSurveyQuestion(
  questions: SurveyQuestion[],
  index: number,
  answer: SurveyAnswerValue | undefined,
): number | typeof SURVEY_END {
  const question = questions[index];
  if (!question) return SURVEY_END;
  for (const rule of question.branching ?? []) {
    if (!conditionMatches(question, rule.when, answer)) continue;
    if (rule.next === SURVEY_END) return SURVEY_END;
    const target = questions.findIndex((item) => item.id === rule.next);
    if (target > index) return target;
    break;
  }
  return index + 1 < questions.length ? index + 1 : SURVEY_END;
}

/**
 * Walk the survey with these answers. `completed` is true when the walk reaches the end without
 * stopping at an unanswered required question. `path` lists the question ids the respondent saw.
 */
export function walkSurvey(questions: SurveyQuestion[], answers: SurveyAnswers): { completed: boolean; path: string[] } {
  const path: string[] = [];
  let index: number | typeof SURVEY_END = questions.length ? 0 : SURVEY_END;
  let guard = 0;
  while (index !== SURVEY_END && guard <= questions.length) {
    guard += 1;
    const question: SurveyQuestion = questions[index];
    path.push(question.id);
    const answer = answers[question.id];
    if (answer === undefined && !question.optional && question.type !== 'link') {
      return { completed: false, path };
    }
    index = nextSurveyQuestion(questions, index, answer);
  }
  return { completed: index === SURVEY_END, path };
}

export function surveyAnswerText(value: SurveyAnswerValue | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/**
 * The `survey_response.answer` column value (feedback inbox, session timeline, warehouse):
 * the first answered non-link question, falling back to "clicked" for link-only responses.
 */
export function primarySurveyAnswer(questions: SurveyQuestion[], answers: SurveyAnswers): string {
  for (const question of questions) {
    if (question.type === 'link') continue;
    const text = surveyAnswerText(answers[question.id]);
    if (text) return text.slice(0, SURVEY_TEXT_MAX);
  }
  for (const value of Object.values(answers)) {
    const text = surveyAnswerText(value);
    if (text) return text.slice(0, SURVEY_TEXT_MAX);
  }
  return '';
}

/**
 * Read one stored answer for display and aggregation. Lenient on purpose: options may have been
 * renamed or a scale changed since the response was recorded, and those answers must still show.
 */
function readStoredAnswer(question: SurveyQuestion, raw: unknown): SurveyAnswerValue | undefined {
  if (question.type === 'link') return raw ? 'clicked' : undefined;
  if (question.type === 'rating') {
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isInteger(value) && value >= 0 && value <= 10 ? value : undefined;
  }
  if (question.type === 'multiple_choice') {
    const items = (Array.isArray(raw) ? raw : [raw])
      .map((item) => asTrimmedString(item, SURVEY_OTHER_TEXT_MAX))
      .filter((item): item is string => Boolean(item));
    return items.length ? items : undefined;
  }
  if (Array.isArray(raw)) return asTrimmedString(raw.join(', '), SURVEY_TEXT_MAX);
  return asTrimmedString(raw, SURVEY_TEXT_MAX);
}

/** Stored `survey_response.answers`, falling back to the legacy `answer` column. */
export function normalizeResponseAnswers(
  questions: SurveyQuestion[],
  row: { answers?: unknown; answer?: string | null },
): SurveyAnswers {
  const stored = parseJsonValue(row.answers);
  const answers: SurveyAnswers = {};
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const record = stored as Record<string, unknown>;
    for (const question of questions) {
      if (!Object.prototype.hasOwnProperty.call(record, question.id)) continue;
      const value = readStoredAnswer(question, record[question.id]);
      if (value !== undefined) answers[question.id] = value;
    }
    return answers;
  }
  const first = questions[0];
  if (!first || !row.answer) return answers;
  const value = readStoredAnswer(first, row.answer);
  if (value !== undefined) answers[first.id] = value;
  return answers;
}

/* ---------------------------------------------------------------------------------------------
 * Legacy single-question surveys
 * ------------------------------------------------------------------------------------------- */

export type LegacySurveyType = 'text' | 'rating' | 'choice';
export const NPS_LEGACY_OPTIONS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

function stringList(raw: unknown): string[] {
  const value = parseJsonValue(raw);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Legacy columns → one question. Must stay in step with migration 0049's backfill. */
export function legacySurveyQuestion(row: { question: string; type: string; options?: unknown }): SurveyQuestion {
  const base = {
    id: LEGACY_SURVEY_QUESTION_ID,
    question: row.question || 'Feedback',
    description: '',
    optional: false,
    buttonText: '',
    branching: [],
  };
  const options = stringList(row.options);
  if (row.type === 'rating') return { ...base, type: 'rating', scale: 5, lowerLabel: '', upperLabel: '' };
  if (row.type === 'choice') {
    if (options.length === NPS_LEGACY_OPTIONS.length && options.every((item, i) => item === NPS_LEGACY_OPTIONS[i])) {
      return { ...base, type: 'rating', scale: 'nps', lowerLabel: '', upperLabel: '' };
    }
    return { ...base, type: 'single_choice', options, hasOther: false };
  }
  return { ...base, type: 'open', placeholder: '' };
}

/**
 * Legacy columns derived from the first question, so readers of `survey.question/type/options`
 * (and trackers released before multi-question surveys) keep working.
 */
export function legacySurveyFields(questions: SurveyQuestion[]): {
  question: string;
  type: LegacySurveyType;
  options: string[];
} {
  const first = questions[0];
  if (!first) return { question: 'Feedback', type: 'text', options: [] };
  switch (first.type) {
    case 'rating': {
      if (first.scale === 5) return { question: first.question, type: 'rating', options: [] };
      const { min, max } = surveyRatingRange(first.scale);
      const options: string[] = [];
      for (let value = min; value <= max; value += 1) options.push(String(value));
      return { question: first.question, type: 'choice', options };
    }
    case 'single_choice':
    case 'multiple_choice':
      return { question: first.question, type: 'choice', options: [...first.options] };
    default:
      return { question: first.question, type: 'text', options: [] };
  }
}

/**
 * Display rules ("show only when <field> <operator> <value>"). Every rule must match. The tracker
 * evaluates path, event, property, language and device in the browser (svRuleOp in
 * apps/ingest/src/tracker/script.ts, parity-tested against surveyDisplayRuleMatches). Country is
 * only known from the request, so /api/tracker-config resolves country rules per request
 * (resolveSurveyCountryRules) and never sends them to the browser.
 */
export const SURVEY_DISPLAY_RULE_FIELDS = ['path', 'event', 'property', 'language', 'country', 'device'] as const;
export type SurveyDisplayRuleField = (typeof SURVEY_DISPLAY_RULE_FIELDS)[number];

export const SURVEY_DISPLAY_RULE_OPERATORS = [
  'equals',
  'contains',
  'starts_with',
  'ends_with',
  'not_equals',
  'not_contains',
  'exists',
  'not_exists',
] as const;
export type SurveyDisplayRuleOperator = (typeof SURVEY_DISPLAY_RULE_OPERATORS)[number];

export type SurveyDisplayRule = {
  field: SurveyDisplayRuleField;
  /** Property name, for `property` rules. */
  key?: string;
  operator: SurveyDisplayRuleOperator;
  value: string;
};

/**
 * Case-insensitive comparison of one rule. `actual` is null (or empty) when the value is unknown:
 * no event on page load, a property the track() call did not send, no country. A missing value
 * only satisfies `not_exists`, `not_equals` and `not_contains`.
 */
export function surveyDisplayRuleMatches(
  operator: string,
  actual: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const a = actual == null || actual === '' ? null : String(actual).toLowerCase();
  const b = String(expected ?? '').toLowerCase();
  if (operator === 'exists') return a != null;
  if (operator === 'not_exists') return a == null;
  if (operator === 'not_equals') return a !== b;
  if (operator === 'not_contains') return a == null || !a.includes(b);
  if (a == null) return false;
  if (operator === 'equals') return a === b;
  if (operator === 'contains') return a.includes(b);
  if (operator === 'starts_with') return a.startsWith(b);
  if (operator === 'ends_with') return a.endsWith(b);
  return false;
}

/**
 * Applies a survey's `country` rules for one visitor (ISO 3166-1 alpha-2, e.g. from
 * request.cf.country): surveys whose country rules fail are dropped, the rest lose their country
 * rules so the tracker only sees rules it can evaluate.
 */
export function resolveSurveyCountryRules<S extends { displayRules: Array<{ field: string; operator: string; value: string }> }>(
  surveys: S[],
  country: string | null | undefined,
): S[] {
  return surveys.flatMap((survey) => {
    const countryRules = survey.displayRules.filter((rule) => rule.field === 'country');
    if (!countryRules.length) return [survey];
    if (!countryRules.every((rule) => surveyDisplayRuleMatches(rule.operator, country, rule.value))) return [];
    return [{ ...survey, displayRules: survey.displayRules.filter((rule) => rule.field !== 'country') }];
  });
}
