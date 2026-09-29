import { describe, expect, it } from 'vitest';
import { createSurveySchema, submitSurveyResponseSchema } from './schemas';
import {
  legacySurveyFields,
  legacySurveyQuestion,
  nextSurveyQuestion,
  normalizeResponseAnswers,
  normalizeSurveyAppearance,
  normalizeSurveyQuestions,
  primarySurveyAnswer,
  sanitizeSurveyAnswers,
  surveyPalette,
  surveyQuestionsSchema,
  surveySampleBucket,
  surveyScheduleOpen,
  walkSurvey,
  SURVEY_END,
  SURVEY_OTHER,
  type SurveyQuestion,
} from './surveys';

const questions: SurveyQuestion[] = surveyQuestionsSchema.parse([
  {
    id: 'nps',
    type: 'rating',
    scale: 'nps',
    question: 'How likely are you to recommend us?',
    branching: [
      { when: { type: 'range', min: 9, max: 10 }, next: 'features' },
      { when: { type: 'range', min: 0, max: 6 }, next: 'why' },
    ],
  },
  { id: 'why', type: 'open', question: 'What could we do better?', branching: [{ when: { type: 'any' }, next: SURVEY_END }] },
  {
    id: 'features',
    type: 'multiple_choice',
    question: 'Which features do you use?',
    options: ['Replay', 'Flags', 'Surveys'],
    hasOther: true,
    optional: true,
    branching: [{ when: { type: 'choice', value: SURVEY_OTHER }, next: 'cta' }],
  },
  { id: 'plan', type: 'single_choice', question: 'Which plan?', options: ['Free', 'Pro'] },
  { id: 'cta', type: 'link', question: 'Book a call', url: 'https://example.com/call' },
]);

describe('survey question schema', () => {
  it('fills defaults and accepts every question type', () => {
    expect(questions[1]).toMatchObject({ optional: false, description: '', placeholder: '', branching: expect.any(Array) });
    expect(questions[0]).toMatchObject({ scale: 'nps', lowerLabel: '', upperLabel: '' });
    expect(questions[4]).toMatchObject({ type: 'link', url: 'https://example.com/call', optional: false });
  });

  it('rejects backward or unknown branch targets', () => {
    const backward = surveyQuestionsSchema.safeParse([
      { id: 'a', type: 'open', question: 'A' },
      { id: 'b', type: 'open', question: 'B', branching: [{ when: { type: 'any' }, next: 'a' }] },
    ]);
    expect(backward.success).toBe(false);
    const unknown = surveyQuestionsSchema.safeParse([
      { id: 'a', type: 'open', question: 'A', branching: [{ when: { type: 'any' }, next: 'zzz' }] },
    ]);
    expect(unknown.success).toBe(false);
  });

  it('rejects conditions the question cannot produce', () => {
    const cases = [
      [{ id: 'a', type: 'open', question: 'A', branching: [{ when: { type: 'choice', value: 'x' }, next: 'end' }] }],
      [{ id: 'a', type: 'rating', scale: 5, question: 'A', branching: [{ when: { type: 'range', min: 0, max: 3 }, next: 'end' }] }],
      [{ id: 'a', type: 'single_choice', options: ['x', 'y'], question: 'A', branching: [{ when: { type: 'choice', value: 'z' }, next: 'end' }] }],
      [{ id: 'a', type: 'single_choice', options: ['x', 'y'], question: 'A', branching: [{ when: { type: 'choice', value: SURVEY_OTHER }, next: 'end' }] }],
      [{ id: 'a', type: 'single_choice', options: ['x', 'X'], question: 'A' }],
      [{ id: 'a', type: 'open', question: 'A' }, { id: 'a', type: 'open', question: 'B' }],
      [{ id: 'a', type: 'link', question: 'A', url: 'javascript:alert(1)' }],
    ];
    for (const input of cases) expect(surveyQuestionsSchema.safeParse(input).success).toBe(false);
  });

  it('caps surveys at ten questions', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `q${i}`, type: 'open', question: `Q${i}` }));
    expect(surveyQuestionsSchema.safeParse(many).success).toBe(false);
    expect(surveyQuestionsSchema.safeParse(many.slice(0, 10)).success).toBe(true);
  });
});

describe('branching', () => {
  it('follows the first matching rule and otherwise continues in order', () => {
    expect(nextSurveyQuestion(questions, 0, 10)).toBe(2);
    expect(nextSurveyQuestion(questions, 0, 3)).toBe(1);
    expect(nextSurveyQuestion(questions, 0, 8)).toBe(1);
    expect(nextSurveyQuestion(questions, 1, 'slow')).toBe(SURVEY_END);
    expect(nextSurveyQuestion(questions, 2, ['Replay'])).toBe(3);
    expect(nextSurveyQuestion(questions, 2, ['Replay', 'Something else'])).toBe(4);
    expect(nextSurveyQuestion(questions, 2, undefined)).toBe(3);
    expect(nextSurveyQuestion(questions, 4, 'clicked')).toBe(SURVEY_END);
  });

  it('ignores stale rules that point backwards instead of looping', () => {
    const stale = [
      { ...questions[1], id: 'a', branching: [] },
      { ...questions[1], id: 'b', branching: [{ when: { type: 'any' as const }, next: 'a' }] },
    ] as SurveyQuestion[];
    expect(nextSurveyQuestion(stale, 1, 'x')).toBe(SURVEY_END);
  });

  it('walks the path and reports completion', () => {
    expect(walkSurvey(questions, { nps: 4, why: 'Too slow' })).toEqual({ completed: true, path: ['nps', 'why'] });
    expect(walkSurvey(questions, { nps: 10, features: ['Flags'], plan: 'Pro' })).toEqual({
      completed: true,
      path: ['nps', 'features', 'plan', 'cta'],
    });
    // Optional question skipped, required plan missing.
    expect(walkSurvey(questions, { nps: 10 })).toEqual({ completed: false, path: ['nps', 'features', 'plan'] });
    expect(walkSurvey(questions, {})).toEqual({ completed: false, path: ['nps'] });
  });
});

describe('answers', () => {
  it('sanitizes answers against the question shapes', () => {
    expect(
      sanitizeSurveyAnswers(questions, {
        nps: '9',
        why: '  ok  ',
        features: ['Surveys', 'Replay', 'Surveys', 'Custom thing', 'Second custom'],
        plan: 'Enterprise',
        cta: true,
        unknown: 'x',
      }),
    ).toEqual({ nps: 9, why: 'ok', features: ['Replay', 'Surveys', 'Custom thing'], cta: 'clicked' });
    expect(sanitizeSurveyAnswers(questions, { nps: 11 })).toEqual({});
    expect(sanitizeSurveyAnswers(questions, { nps: 7.5 })).toEqual({});
    expect(sanitizeSurveyAnswers(questions, 'not json')).toEqual({});
    expect(sanitizeSurveyAnswers(questions, JSON.stringify({ plan: 'Free' }))).toEqual({ plan: 'Free' });
  });

  it('picks the primary answer text for the legacy answer column', () => {
    expect(primarySurveyAnswer(questions, { features: ['Replay', 'Flags'], nps: 9 })).toBe('9');
    expect(primarySurveyAnswer(questions, { features: ['Replay', 'Flags'] })).toBe('Replay, Flags');
    expect(primarySurveyAnswer(questions, { cta: 'clicked' })).toBe('clicked');
  });

  it('reads stored answers leniently and falls back to the legacy answer column', () => {
    expect(normalizeResponseAnswers(questions, { answers: '{"plan":"Renamed plan","nps":"7"}', answer: 'x' })).toEqual({
      plan: 'Renamed plan',
      nps: 7,
    });
    expect(normalizeResponseAnswers(questions, { answers: null, answer: '6' })).toEqual({ nps: 6 });
    expect(normalizeResponseAnswers(questions, { answers: null, answer: null })).toEqual({});
  });
});

describe('legacy surveys', () => {
  it('converts legacy columns the same way migration 0049 does', () => {
    expect(legacySurveyQuestion({ question: 'Tell us', type: 'text' })).toMatchObject({ id: 'q1', type: 'open' });
    expect(legacySurveyQuestion({ question: 'Rate', type: 'rating' })).toMatchObject({ type: 'rating', scale: 5 });
    expect(
      legacySurveyQuestion({ question: 'NPS', type: 'choice', options: JSON.stringify(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) }),
    ).toMatchObject({ type: 'rating', scale: 'nps' });
    expect(legacySurveyQuestion({ question: 'Plan', type: 'choice', options: ['A', 'B'] })).toMatchObject({
      type: 'single_choice',
      options: ['A', 'B'],
    });
  });

  it('prefers stored questions and falls back on invalid JSON', () => {
    expect(normalizeSurveyQuestions({ questions: JSON.stringify(questions), question: 'x', type: 'text' })).toHaveLength(5);
    expect(normalizeSurveyQuestions({ questions: '[{"broken":true}]', question: 'Legacy', type: 'rating' })).toEqual([
      expect.objectContaining({ id: 'q1', type: 'rating', question: 'Legacy' }),
    ]);
  });

  it('derives legacy columns from the first question', () => {
    expect(legacySurveyFields(questions)).toEqual({
      question: 'How likely are you to recommend us?',
      type: 'choice',
      options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    });
    expect(legacySurveyFields([questions[1]])).toEqual({ question: 'What could we do better?', type: 'text', options: [] });
    expect(legacySurveyFields([questions[2]]).type).toBe('choice');
  });
});

describe('targeting and appearance helpers', () => {
  it('buckets people deterministically', () => {
    expect(surveySampleBucket('s1', 'person')).toBe(surveySampleBucket('s1', 'person'));
    const buckets = new Set(Array.from({ length: 200 }, (_, i) => surveySampleBucket('s1', `p${i}`)));
    expect(buckets.size).toBeGreaterThan(50);
    for (const bucket of buckets) expect(bucket).toBeGreaterThanOrEqual(0);
  });

  it('checks the schedule window', () => {
    expect(surveyScheduleOpen({}, 5)).toBe(true);
    expect(surveyScheduleOpen({ startsAt: 10 }, 5)).toBe(false);
    expect(surveyScheduleOpen({ startsAt: 10, endsAt: 20 }, 15)).toBe(true);
    expect(surveyScheduleOpen({ endsAt: 20 }, 20)).toBe(false);
  });

  it('normalizes appearance and resolves palette colors', () => {
    expect(normalizeSurveyAppearance(null)).toMatchObject({ position: 'bottom-right', theme: 'auto', accent: 'neutral' });
    expect(normalizeSurveyAppearance('{"accent":"#ff0000"}').accent).toBe('neutral');
    expect(normalizeSurveyAppearance({ accent: 'blue', position: 'center' })).toMatchObject({ accent: 'blue', position: 'center' });
    expect(surveyPalette('blue').light.accent).toBe('#006bff');
  });
});

describe('survey request schemas', () => {
  it('accepts multi-question creates and rejects inverted schedules', () => {
    expect(createSurveySchema.safeParse({ name: 'Multi', questions }).success).toBe(true);
    expect(createSurveySchema.safeParse({ name: 'Bad', questions, startsAt: 10, endsAt: 5 }).success).toBe(false);
    expect(createSurveySchema.safeParse({ name: 'Slug', questions, slug: 'Bad Slug!' }).success).toBe(false);
    expect(createSurveySchema.parse({ name: 'Slug', questions, slug: 'Beta-Feedback' }).slug).toBe('beta-feedback');
  });

  it('requires an answer in either form', () => {
    const website = '00000000-0000-0000-0000-000000000099';
    expect(submitSurveyResponseSchema.safeParse({ website, surveyId: 's', answer: 'hi' }).success).toBe(true);
    expect(submitSurveyResponseSchema.safeParse({ website, surveyId: 's', answers: { q1: 'hi' } }).success).toBe(true);
    expect(submitSurveyResponseSchema.safeParse({ website, surveyId: 's', answers: {} }).success).toBe(false);
    expect(submitSurveyResponseSchema.safeParse({ website, surveyId: 's' }).success).toBe(false);
  });
});
