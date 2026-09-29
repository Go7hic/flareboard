import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  nextSurveyQuestion,
  sanitizeSurveyAnswer,
  surveyPalette,
  surveyRatingRange,
  SURVEY_END,
  type SurveyAnswers,
  type SurveyAnswerValue,
  type SurveyAppearance,
  type SurveyQuestion,
} from '@flareboard/shared/survey-flow';
import { t } from '../../lib/i18n';

/**
 * Renders a survey one question at a time, following the same branching rules the server uses
 * (`nextSurveyQuestion` from packages/shared). Used by the builder preview and the hosted
 * survey page. Colors come from the survey's palette (the same values the tracker receives),
 * not from the dashboard theme, so the preview matches what visitors see.
 */
export type SurveyRendererProps = {
  questions: SurveyQuestion[];
  appearance: SurveyAppearance;
  /** Resolved light/dark scheme for `appearance.theme === 'auto'`. */
  scheme: 'light' | 'dark';
  /** Called after each answered step with everything answered so far. */
  onProgress?: (answers: SurveyAnswers) => void;
  /** Called once the respondent reaches the end. A rejected promise shows an error and allows retry. */
  onComplete?: (answers: SurveyAnswers) => Promise<void> | void;
  /** Preview mode: nothing is sent and the thank-you step offers a restart. */
  preview?: boolean;
  /** Preview only: jump to this question (builder "preview question N"). */
  focusIndex?: number;
  className?: string;
};

type Draft = { text: string; choice: string; picked: string[]; other: string; otherSelected: boolean; rating: number | null };

const EMPTY_DRAFT: Draft = { text: '', choice: '', picked: [], other: '', otherSelected: false, rating: null };

function draftValue(question: SurveyQuestion, draft: Draft): SurveyAnswerValue | undefined {
  switch (question.type) {
    case 'open':
      return sanitizeSurveyAnswer(question, draft.text);
    case 'rating':
      return draft.rating == null ? undefined : sanitizeSurveyAnswer(question, draft.rating);
    case 'single_choice':
      return sanitizeSurveyAnswer(question, draft.otherSelected ? draft.other : draft.choice);
    case 'multiple_choice':
      return sanitizeSurveyAnswer(question, draft.otherSelected ? [...draft.picked, draft.other] : draft.picked);
    case 'link':
      return undefined;
  }
}

export function surveyWidgetStyle(appearance: SurveyAppearance, scheme: 'light' | 'dark'): CSSProperties {
  const palette = surveyPalette(appearance.accent)[appearance.theme === 'auto' ? scheme : appearance.theme];
  return {
    '--survey-bg': palette.background,
    '--survey-text': palette.text,
    '--survey-muted': palette.mutedText,
    '--survey-border': palette.border,
    '--survey-accent': palette.accent,
    '--survey-accent-text': palette.accentText,
  } as CSSProperties;
}

export function SurveyRenderer({
  questions,
  appearance,
  scheme,
  onProgress,
  onComplete,
  preview = false,
  focusIndex,
  className,
}: SurveyRendererProps) {
  const [index, setIndex] = useState<number | typeof SURVEY_END>(0);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The builder edits questions live: restart when the structure changes or a step is focused.
  const structureKey = useMemo(() => questions.map((question) => `${question.id}:${question.type}`).join('|'), [questions]);
  useEffect(() => {
    setIndex(focusIndex != null && focusIndex < questions.length ? focusIndex : 0);
    setAnswers({});
    setDraft(EMPTY_DRAFT);
    setError(null);
  }, [structureKey, focusIndex, questions.length]);

  const style = surveyWidgetStyle(appearance, scheme);
  const rootClass = ['survey-widget', className].filter(Boolean).join(' ');

  if (!questions.length) return null;

  if (index === SURVEY_END) {
    return (
      <div className={rootClass} style={style} role="status">
        {appearance.showThankYou ? (
          <p className="survey-widget-question">{appearance.thankYouMessage || t('surveyThankYouDefault')}</p>
        ) : (
          <p className="survey-widget-description">{t('surveyWidgetClosedHint')}</p>
        )}
        {preview ? (
          <div className="survey-widget-actions">
            <button type="button" className="survey-widget-secondary" onClick={() => setIndex(0)}>
              {t('surveyPreviewRestart')}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const question = questions[index];
  if (!question) return null;
  const value = draftValue(question, draft);
  const next = nextSurveyQuestion(questions, index, question.type === 'link' ? 'clicked' : value);
  const isLast = next === SURVEY_END;
  const buttonText =
    question.buttonText || (isLast ? appearance.submitText || t('surveyWidgetSubmit') : t('surveyWidgetNext'));
  const canSkip = question.optional || question.type === 'link';

  async function advance(answer: SurveyAnswerValue | undefined) {
    if (index === SURVEY_END) return;
    const nextAnswers = { ...answers };
    if (answer !== undefined) nextAnswers[question.id] = answer;
    const target = nextSurveyQuestion(questions, index, answer);
    setAnswers(nextAnswers);
    if (answer !== undefined) onProgress?.(nextAnswers);
    if (target === SURVEY_END) {
      if (!preview && onComplete) {
        setSending(true);
        setError(null);
        try {
          await onComplete(nextAnswers);
        } catch (err) {
          setSending(false);
          setError(err instanceof Error ? err.message : t('surveyWidgetSendFailed'));
          return;
        }
        setSending(false);
      }
    }
    setDraft(EMPTY_DRAFT);
    setIndex(target);
  }

  const stepLabel = t('surveyWidgetStep')
    .replace('{n}', String(index + 1))
    .replace('{total}', String(questions.length));

  return (
    <form
      className={rootClass}
      style={style}
      aria-label={question.question}
      onSubmit={(event) => {
        event.preventDefault();
        if (question.type === 'link') return;
        if (value === undefined && !question.optional) return;
        void advance(value);
      }}
    >
      {questions.length > 1 ? <p className="survey-widget-step">{stepLabel}</p> : null}
      <p className="survey-widget-question" id={`survey-q-${question.id}`}>
        {question.question}
      </p>
      {question.description ? <p className="survey-widget-description">{question.description}</p> : null}

      {question.type === 'open' ? (
        <textarea
          className="survey-widget-textarea"
          rows={4}
          maxLength={2000}
          aria-labelledby={`survey-q-${question.id}`}
          placeholder={question.placeholder || t('surveyWidgetPlaceholder')}
          value={draft.text}
          onChange={(event) => setDraft((prev) => ({ ...prev, text: event.target.value }))}
        />
      ) : null}

      {question.type === 'rating' ? <RatingInput question={question} draft={draft} setDraft={setDraft} /> : null}

      {question.type === 'single_choice' || question.type === 'multiple_choice' ? (
        <div
          className="survey-widget-choices"
          role={question.type === 'single_choice' ? 'radiogroup' : 'group'}
          aria-labelledby={`survey-q-${question.id}`}
        >
          {question.options.map((option) => {
            const selected =
              question.type === 'single_choice'
                ? !draft.otherSelected && draft.choice === option
                : draft.picked.includes(option);
            return (
              <button
                key={option}
                type="button"
                role={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                aria-checked={selected}
                className={`survey-widget-choice${selected ? ' is-selected' : ''}`}
                onClick={() =>
                  setDraft((prev) =>
                    question.type === 'single_choice'
                      ? { ...prev, choice: option, otherSelected: false }
                      : {
                          ...prev,
                          picked: prev.picked.includes(option)
                            ? prev.picked.filter((item) => item !== option)
                            : [...prev.picked, option],
                        },
                  )
                }
              >
                {option}
              </button>
            );
          })}
          {question.hasOther ? (
            <>
              <button
                type="button"
                role={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                aria-checked={draft.otherSelected}
                className={`survey-widget-choice${draft.otherSelected ? ' is-selected' : ''}`}
                onClick={() => setDraft((prev) => ({ ...prev, otherSelected: !prev.otherSelected || question.type === 'single_choice' }))}
              >
                {t('surveyWidgetOther')}
              </button>
              {draft.otherSelected ? (
                <input
                  className="survey-widget-input"
                  maxLength={500}
                  aria-label={t('surveyWidgetOther')}
                  placeholder={t('surveyWidgetOtherPlaceholder')}
                  value={draft.other}
                  onChange={(event) => setDraft((prev) => ({ ...prev, other: event.target.value }))}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="survey-widget-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="survey-widget-actions">
        {canSkip && question.type !== 'link' ? (
          <button type="button" className="survey-widget-secondary" disabled={sending} onClick={() => void advance(undefined)}>
            {t('surveyWidgetSkip')}
          </button>
        ) : null}
        {question.type === 'link' ? (
          <>
            <button type="button" className="survey-widget-secondary" disabled={sending} onClick={() => void advance(undefined)}>
              {isLast ? t('surveyWidgetClose') : t('surveyWidgetNext')}
            </button>
            <a
              className="survey-widget-primary"
              href={question.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (preview) event.preventDefault();
                void advance('clicked');
              }}
            >
              {question.buttonText || t('surveyWidgetOpenLink')}
            </a>
          </>
        ) : (
          <button
            type="submit"
            className="survey-widget-primary"
            disabled={sending || (value === undefined && !question.optional)}
          >
            {sending ? t('saving') : buttonText}
          </button>
        )}
      </div>
    </form>
  );
}

function RatingInput({
  question,
  draft,
  setDraft,
}: {
  question: Extract<SurveyQuestion, { type: 'rating' }>;
  draft: Draft;
  setDraft: (update: (prev: Draft) => Draft) => void;
}) {
  const { min, max } = surveyRatingRange(question.scale);
  const scores: number[] = [];
  for (let score = min; score <= max; score += 1) scores.push(score);
  return (
    <div className="survey-widget-rating-wrap">
      <div
        className="survey-widget-rating"
        role="radiogroup"
        aria-labelledby={`survey-q-${question.id}`}
        style={{ gridTemplateColumns: `repeat(${scores.length}, minmax(0, 1fr))` }}
      >
        {scores.map((score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={draft.rating === score}
            className={`survey-widget-score${draft.rating === score ? ' is-selected' : ''}`}
            onClick={() => setDraft((prev) => ({ ...prev, rating: score }))}
          >
            {score}
          </button>
        ))}
      </div>
      {question.lowerLabel || question.upperLabel ? (
        <div className="survey-widget-rating-labels">
          <span>{question.lowerLabel}</span>
          <span>{question.upperLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
