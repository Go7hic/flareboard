import { z } from 'zod';
import {
  DEFAULT_SURVEY_APPEARANCE,
  legacySurveyQuestion,
  parseJsonValue,
  surveyAccents,
  surveyColorSchemes,
  surveyPositions,
  surveyQuestionIssues,
  SURVEY_MAX_OPTIONS,
  SURVEY_MAX_QUESTIONS,
  type SurveyAppearance,
  type SurveyQuestion,
} from './survey-flow';

export * from './survey-flow';

/** Zod schemas for survey definitions. The types and runtime logic live in ./survey-flow. */

export const surveyRatingScaleSchema = z.union([z.literal(5), z.literal(10), z.literal('nps')]);

export const surveyBranchConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('any') }),
  z.object({ type: z.literal('choice'), value: z.string().min(1).max(120) }),
  z.object({
    type: z.literal('range'),
    min: z.number().int().min(0).max(10),
    max: z.number().int().min(0).max(10),
  }),
]);

export const surveyBranchRuleSchema = z.object({
  when: surveyBranchConditionSchema,
  next: z.string().min(1).max(40),
});

const questionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Question ids use letters, digits, - and _');
const optionSchema = z.string().trim().min(1).max(120);

const questionBase = {
  id: questionIdSchema,
  question: z.string().trim().min(1).max(500),
  description: z.string().trim().max(1000).optional().default(''),
  optional: z.boolean().optional().default(false),
  buttonText: z.string().trim().max(40).optional().default(''),
  branching: z.array(surveyBranchRuleSchema).max(20).optional().default([]),
};

const httpUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), { message: 'Links must use http or https' });

export const surveyQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    ...questionBase,
    type: z.literal('open'),
    placeholder: z.string().trim().max(120).optional().default(''),
  }),
  z.object({
    ...questionBase,
    type: z.literal('rating'),
    scale: surveyRatingScaleSchema.optional().default(5),
    lowerLabel: z.string().trim().max(60).optional().default(''),
    upperLabel: z.string().trim().max(60).optional().default(''),
  }),
  z.object({
    ...questionBase,
    type: z.literal('single_choice'),
    options: z.array(optionSchema).min(2).max(SURVEY_MAX_OPTIONS),
    hasOther: z.boolean().optional().default(false),
  }),
  z.object({
    ...questionBase,
    type: z.literal('multiple_choice'),
    options: z.array(optionSchema).min(2).max(SURVEY_MAX_OPTIONS),
    hasOther: z.boolean().optional().default(false),
  }),
  z.object({
    ...questionBase,
    type: z.literal('link'),
    url: httpUrlSchema,
  }),
]);
export type SurveyQuestionInput = z.input<typeof surveyQuestionSchema>;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Compile-time guard: the schema output and the hand-written SurveyQuestion type must match. */
const questionTypeMatches: Same<z.infer<typeof surveyQuestionSchema>, SurveyQuestion> = true;
void questionTypeMatches;

export const surveyQuestionsSchema = z
  .array(surveyQuestionSchema)
  .min(1)
  .max(SURVEY_MAX_QUESTIONS)
  .superRefine((questions, ctx) => {
    for (const message of surveyQuestionIssues(questions)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

export const surveyAppearanceSchema = z.object({
  position: z.enum(surveyPositions).optional().default(DEFAULT_SURVEY_APPEARANCE.position),
  theme: z.enum(surveyColorSchemes).optional().default(DEFAULT_SURVEY_APPEARANCE.theme),
  accent: z.enum(surveyAccents).optional().default(DEFAULT_SURVEY_APPEARANCE.accent),
  submitText: z.string().trim().max(40).optional().default(''),
  showThankYou: z.boolean().optional().default(true),
  thankYouMessage: z.string().trim().max(200).optional().default(''),
});
const appearanceTypeMatches: Same<z.infer<typeof surveyAppearanceSchema>, SurveyAppearance> = true;
void appearanceTypeMatches;

export function normalizeSurveyAppearance(raw: unknown): SurveyAppearance {
  const parsed = surveyAppearanceSchema.safeParse(parseJsonValue(raw) ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_SURVEY_APPEARANCE };
}

export const surveySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Slugs use 3-64 lowercase letters, digits and dashes');

/** Stored `survey.questions` JSON, falling back to the legacy columns. */
export function normalizeSurveyQuestions(row: {
  questions?: unknown;
  question: string;
  type: string;
  options?: unknown;
}): SurveyQuestion[] {
  const stored = parseJsonValue(row.questions);
  if (Array.isArray(stored) && stored.length) {
    const parsed = z.array(surveyQuestionSchema).max(SURVEY_MAX_QUESTIONS).safeParse(stored);
    if (parsed.success) return parsed.data;
  }
  return [legacySurveyQuestion(row)];
}
