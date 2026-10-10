import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Copy, FilePlus, Gauge, MessageSquareText, Plus, Smile, Trash2, X } from 'lucide-react';
import {
  isChoiceQuestion,
  surveyAccents,
  surveyColorSchemes,
  surveyPositions,
  surveyQuestionIssues,
  surveyRatingRange,
  DEFAULT_SURVEY_APPEARANCE,
  SURVEY_DISPLAY_RULE_FIELDS,
  SURVEY_DISPLAY_RULE_OPERATORS,
  SURVEY_END,
  SURVEY_MAX_OPTIONS,
  SURVEY_MAX_QUESTIONS,
  SURVEY_OTHER,
  type SurveyAppearance,
  type SurveyBranchRule,
  type SurveyQuestion,
  type SurveyQuestionType,
  type SurveyRatingScale,
} from '@flareboard/shared/survey-flow';
import { ModalDialog } from '../ModalDialog';
import { FormErrors, FormSection } from '../product/ProductForm';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import type { Survey, SurveyDisplayRule } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { SurveyRenderer } from './SurveyRenderer';

/* -------------------------------------------------------------------------------------------- */
/* Draft model                                                                                   */
/* -------------------------------------------------------------------------------------------- */

type QuestionDraft = SurveyQuestion & {
  /** Stable React key (ids can be edited by the API only, never here). */
  key: string;
  /** Choice options as edited, one per line. */
  optionsText: string;
};

type RepeatMode = 'once' | 'interval';

type SurveyDraft = {
  name: string;
  enabled: boolean;
  questions: QuestionDraft[];
  triggerPath: string;
  triggerEvent: string;
  displayDelaySeconds: string;
  displayRulesText: string;
  sampleRate: string;
  responseLimit: string;
  startsAt: string;
  endsAt: string;
  repeatMode: RepeatMode;
  repeatIntervalDays: string;
  hostedEnabled: boolean;
  slug: string;
  appearance: SurveyAppearance;
};

export type SurveyBody = {
  name: string;
  enabled: boolean;
  questions: SurveyQuestion[];
  triggerPath: string | null;
  triggerEvent: string | null;
  displayDelaySeconds: number;
  displayRules: SurveyDisplayRule[];
  sampleRate: number;
  responseLimit: number | null;
  startsAt: number | null;
  endsAt: number | null;
  repeatIntervalDays: number | null;
  hostedEnabled: boolean;
  slug: string | null;
  appearance: SurveyAppearance;
};

export type SurveyTemplateKey = 'blank' | 'nps' | 'csat' | 'feedback';

function randomId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `q_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function toDraft(question: SurveyQuestion): QuestionDraft {
  return {
    ...question,
    key: `${question.id}-${randomId()}`,
    optionsText: isChoiceQuestion(question) ? question.options.join('\n') : '',
  } as QuestionDraft;
}

const BASE = { description: '', optional: false, buttonText: '', branching: [] as SurveyBranchRule[] };

function newQuestion(type: SurveyQuestionType, question = ''): SurveyQuestion {
  const id = randomId();
  switch (type) {
    case 'rating':
      return { ...BASE, id, type, question, scale: 5, lowerLabel: '', upperLabel: '' };
    case 'single_choice':
    case 'multiple_choice':
      return { ...BASE, id, type, question, options: [], hasOther: false };
    case 'link':
      return { ...BASE, id, type, question, url: 'https://', optional: true };
    default:
      return { ...BASE, id, type: 'open', question, placeholder: '' };
  }
}

export function surveyTemplate(key: SurveyTemplateKey): { name: string; questions: SurveyQuestion[] } {
  if (key === 'nps') {
    const score = newQuestion('rating', t('surveyTemplateNpsQuestion')) as Extract<SurveyQuestion, { type: 'rating' }>;
    const reason = newQuestion('open', t('surveyTemplateNpsFollowUp'));
    return {
      name: t('surveyTemplateNps'),
      questions: [
        { ...score, scale: 'nps', lowerLabel: t('surveyTemplateNpsLow'), upperLabel: t('surveyTemplateNpsHigh') },
        reason,
      ],
    };
  }
  if (key === 'csat') {
    const score = newQuestion('rating', t('surveyTemplateCsatQuestion')) as Extract<SurveyQuestion, { type: 'rating' }>;
    const reason = newQuestion('open', t('surveyTemplateCsatFollowUp'));
    return {
      name: t('surveyTemplateCsat'),
      questions: [
        {
          ...score,
          lowerLabel: t('surveyTemplateCsatLow'),
          upperLabel: t('surveyTemplateCsatHigh'),
          branching: [{ when: { type: 'range', min: 4, max: 5 }, next: SURVEY_END }],
        },
        reason,
      ],
    };
  }
  if (key === 'feedback') {
    return { name: t('surveyTemplateFeedback'), questions: [newQuestion('open', t('surveyTemplateFeedbackQuestion'))] };
  }
  return { name: '', questions: [newQuestion('open')] };
}

function convertQuestion(question: QuestionDraft, type: SurveyQuestionType): QuestionDraft {
  const fresh = newQuestion(type, question.question);
  const options = isChoiceQuestion(question) ? question.options : [];
  const converted = {
    ...fresh,
    id: question.id,
    description: question.description,
    optional: type === 'link' ? true : question.optional,
    buttonText: question.buttonText,
    // Only "any answer" rules survive a type change: the others test type-specific answers.
    branching: question.branching.filter((rule) => rule.when.type === 'any'),
    ...(type === 'single_choice' || type === 'multiple_choice' ? { options } : {}),
  } as SurveyQuestion;
  return { ...converted, key: question.key, optionsText: options.join('\n') } as QuestionDraft;
}

function parseOptions(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/* Display rules keep the existing "field operator value" line format. */
export function parseDisplayRules(value: string): SurveyDisplayRule[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawField = '', operator = '', ...rest] = line.split(/\s+/);
      const [field, key] = rawField.includes('.')
        ? (rawField.split('.', 2) as [SurveyDisplayRule['field'], string])
        : [rawField as SurveyDisplayRule['field'], undefined];
      return {
        field,
        key,
        operator: operator as SurveyDisplayRule['operator'],
        value: rest.join(' ').trim(),
      };
    })
    .filter(
      (rule) =>
        SURVEY_DISPLAY_RULE_FIELDS.includes(rule.field) &&
        SURVEY_DISPLAY_RULE_OPERATORS.includes(rule.operator) &&
        (rule.operator === 'exists' || rule.operator === 'not_exists' || rule.value) &&
        (rule.field === 'property' ? Boolean(rule.key) : true),
    );
}

function stringifyDisplayRules(rules: SurveyDisplayRule[] | undefined) {
  return (rules ?? [])
    .map((rule) => `${rule.key ? `${rule.field}.${rule.key}` : rule.field} ${rule.operator} ${rule.value}`.trim())
    .join('\n');
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** ms → value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(ms: number | null) {
  if (ms == null) return '';
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function draftFromSurvey(survey: Survey | null, template: SurveyTemplateKey): SurveyDraft {
  const seed = survey ? { name: survey.name, questions: survey.questions } : surveyTemplate(template);
  return {
    name: seed.name,
    enabled: survey?.enabled ?? true,
    questions: seed.questions.map(toDraft),
    triggerPath: survey?.triggerPath ?? '',
    triggerEvent: survey?.triggerEvent ?? '',
    displayDelaySeconds: String(survey?.displayDelaySeconds ?? 0),
    displayRulesText: stringifyDisplayRules(survey?.displayRules),
    sampleRate: String(survey?.sampleRate ?? 100),
    responseLimit: survey?.responseLimit != null ? String(survey.responseLimit) : '',
    startsAt: toLocalInput(survey?.startsAt ?? null),
    endsAt: toLocalInput(survey?.endsAt ?? null),
    repeatMode: survey?.repeatIntervalDays ? 'interval' : 'once',
    repeatIntervalDays: String(survey?.repeatIntervalDays ?? 30),
    hostedEnabled: survey?.hostedEnabled ?? false,
    slug: survey?.slug ?? '',
    appearance: { ...DEFAULT_SURVEY_APPEARANCE, ...(survey?.appearance ?? {}) },
  };
}

function intInRange(text: string, min: number, max: number) {
  const value = Number(text);
  return text.trim() !== '' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Questions as the API expects them (options parsed, draft-only fields stripped). */
function questionsFromDraft(drafts: QuestionDraft[]): SurveyQuestion[] {
  return drafts.map((draft) => {
    const { key: _key, optionsText, ...rest } = draft;
    void _key;
    const question = { ...rest, question: rest.question.trim() } as SurveyQuestion;
    if (isChoiceQuestion(question)) return { ...question, options: parseOptions(optionsText) };
    if (question.type === 'link') return { ...question, url: question.url.trim() };
    return question;
  });
}

function buildBody(draft: SurveyDraft): { body: SurveyBody | null; errors: string[] } {
  const errors: string[] = [];
  const questions = questionsFromDraft(draft.questions);
  if (!draft.name.trim()) errors.push(t('surveyErrorName'));
  questions.forEach((question, index) => {
    const label = t('surveyQuestionNumber').replace('{n}', String(index + 1));
    if (!question.question) errors.push(`${label}: ${t('surveyErrorQuestionText')}`);
    if (isChoiceQuestion(question)) {
      if (question.options.length < 2) errors.push(`${label}: ${t('surveyErrorOptions')}`);
      if (question.options.length > SURVEY_MAX_OPTIONS) errors.push(`${label}: ${t('surveyErrorTooManyOptions')}`);
      if (new Set(question.options.map((option) => option.toLowerCase())).size !== question.options.length) {
        errors.push(`${label}: ${t('surveyErrorDuplicateOptions')}`);
      }
    }
    if (question.type === 'link' && !/^https?:\/\/[^\s/]+\.[^\s]+/i.test(question.url)) {
      errors.push(`${label}: ${t('surveyErrorLink')}`);
    }
    const ids = questions.map((item) => item.id);
    for (const rule of question.branching) {
      if (rule.next !== SURVEY_END && ids.indexOf(rule.next) <= index) {
        errors.push(`${label}: ${t('surveyErrorBranchBackward')}`);
      }
      if (rule.when.type === 'choice' && isChoiceQuestion(question)) {
        const exists = rule.when.value === SURVEY_OTHER ? question.hasOther : question.options.includes(rule.when.value);
        if (!exists) errors.push(`${label}: ${t('surveyErrorBranchOption')}`);
      }
      if (rule.when.type === 'range' && rule.when.min > rule.when.max) {
        errors.push(`${label}: ${t('surveyErrorBranchRange')}`);
      }
    }
  });
  if (!errors.length) errors.push(...surveyQuestionIssues(questions));

  const displayDelaySeconds = intInRange(draft.displayDelaySeconds, 0, 60);
  if (displayDelaySeconds == null) errors.push(t('surveyErrorDelay'));
  const sampleRate = intInRange(draft.sampleRate, 0, 100);
  if (sampleRate == null) errors.push(t('surveyErrorSampleRate'));
  const responseLimit = draft.responseLimit.trim() ? intInRange(draft.responseLimit, 1, 1_000_000) : null;
  if (draft.responseLimit.trim() && responseLimit == null) errors.push(t('surveyErrorResponseLimit'));
  const repeatIntervalDays = draft.repeatMode === 'interval' ? intInRange(draft.repeatIntervalDays, 1, 365) : null;
  if (draft.repeatMode === 'interval' && repeatIntervalDays == null) errors.push(t('surveyErrorRepeat'));
  const startsAt = fromLocalInput(draft.startsAt);
  const endsAt = fromLocalInput(draft.endsAt);
  if (startsAt != null && endsAt != null && startsAt >= endsAt) errors.push(t('surveyErrorSchedule'));
  const slug = draft.slug.trim().toLowerCase();
  if (slug && !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) errors.push(t('surveyErrorSlug'));
  const displayRules = parseDisplayRules(draft.displayRulesText);
  const ruleLines = draft.displayRulesText.split('\n').filter((line) => line.trim()).length;
  if (ruleLines !== displayRules.length) errors.push(t('surveyErrorDisplayRules'));

  if (errors.length) return { body: null, errors };
  return {
    errors,
    body: {
      name: draft.name.trim(),
      enabled: draft.enabled,
      questions,
      triggerPath: draft.triggerPath.trim() || null,
      triggerEvent: draft.triggerEvent.trim() || null,
      displayDelaySeconds: displayDelaySeconds!,
      displayRules,
      sampleRate: sampleRate!,
      responseLimit,
      startsAt,
      endsAt,
      repeatIntervalDays,
      hostedEnabled: draft.hostedEnabled,
      slug: slug || null,
      appearance: draft.appearance,
    },
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Labels                                                                                        */
/* -------------------------------------------------------------------------------------------- */

const QUESTION_TYPES: SurveyQuestionType[] = ['open', 'rating', 'single_choice', 'multiple_choice', 'link'];

export function questionTypeLabel(type: SurveyQuestionType) {
  return t(`surveyQuestionType_${type}`);
}

function ratingScaleLabel(scale: SurveyRatingScale) {
  if (scale === 'nps') return t('surveyScaleNps');
  return t('surveyScaleRange').replace('{max}', String(scale));
}

/* -------------------------------------------------------------------------------------------- */
/* Branching editor                                                                              */
/* -------------------------------------------------------------------------------------------- */

function BranchingEditor({
  question,
  index,
  questions,
  onChange,
}: {
  question: QuestionDraft;
  index: number;
  questions: QuestionDraft[];
  onChange: (rules: SurveyBranchRule[]) => void;
}) {
  const options = isChoiceQuestion(question) ? parseOptions(question.optionsText) : [];
  const later = questions.slice(index + 1);
  const range = question.type === 'rating' ? surveyRatingRange(question.scale) : null;

  function conditionKind(rule: SurveyBranchRule) {
    return rule.when.type;
  }

  function defaultRule(): SurveyBranchRule {
    const next = later[0]?.id ?? SURVEY_END;
    if (range) return { when: { type: 'range', min: range.min, max: range.max }, next };
    if (options.length) return { when: { type: 'choice', value: options[0] }, next };
    return { when: { type: 'any' }, next };
  }

  function update(ruleIndex: number, rule: SurveyBranchRule) {
    onChange(question.branching.map((item, i) => (i === ruleIndex ? rule : item)));
  }

  const canBranchOnAnswer = Boolean(range) || isChoiceQuestion(question);

  return (
    <div className="product-branching">
      <div className="product-branching-head">
        <span className="product-branching-title">{t('surveyBranching')}</span>
        <span className="product-branching-hint">
          {question.branching.length ? t('surveyBranchOtherwise') : t('surveyBranchNone')}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={question.branching.length >= 20}
          onClick={() => onChange([...question.branching, defaultRule()])}
        >
          <Plus size={14} strokeWidth={2} aria-hidden />
          {t('surveyAddBranch')}
        </Button>
      </div>
      {question.branching.map((rule, ruleIndex) => (
        <div key={ruleIndex} className="product-branch-row">
          <span className="product-branch-word">{t('surveyBranchIf')}</span>
          <select
            className="select"
            aria-label={t('surveyBranchCondition')}
            value={conditionKind(rule)}
            onChange={(event) => {
              const kind = event.target.value;
              if (kind === 'range' && range) update(ruleIndex, { ...rule, when: { type: 'range', min: range.min, max: range.max } });
              else if (kind === 'choice') update(ruleIndex, { ...rule, when: { type: 'choice', value: options[0] ?? '' } });
              else update(ruleIndex, { ...rule, when: { type: 'any' } });
            }}
          >
            <option value="any">{t('surveyBranchAny')}</option>
            {range ? <option value="range">{t('surveyBranchRange')}</option> : null}
            {canBranchOnAnswer && !range ? <option value="choice">{t('surveyBranchChoice')}</option> : null}
          </select>
          {rule.when.type === 'range' && range ? (
            <>
              <Input
                className="product-number-input"
                type="number"
                min={range.min}
                max={range.max}
                aria-label={t('surveyBranchMin')}
                value={rule.when.min}
                onChange={(event) =>
                  update(ruleIndex, {
                    ...rule,
                    when: { type: 'range', min: Number(event.target.value), max: (rule.when as { max: number }).max },
                  })
                }
              />
              <span className="product-branch-word">–</span>
              <Input
                className="product-number-input"
                type="number"
                min={range.min}
                max={range.max}
                aria-label={t('surveyBranchMax')}
                value={rule.when.max}
                onChange={(event) =>
                  update(ruleIndex, {
                    ...rule,
                    when: { type: 'range', min: (rule.when as { min: number }).min, max: Number(event.target.value) },
                  })
                }
              />
            </>
          ) : null}
          {rule.when.type === 'choice' ? (
            <select
              className="select"
              aria-label={t('surveyBranchChoice')}
              value={rule.when.value}
              onChange={(event) => update(ruleIndex, { ...rule, when: { type: 'choice', value: event.target.value } })}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {isChoiceQuestion(question) && question.hasOther ? (
                <option value={SURVEY_OTHER}>{t('surveyWidgetOther')}</option>
              ) : null}
            </select>
          ) : null}
          <span className="product-branch-word">→</span>
          <select
            className="select"
            aria-label={t('surveyBranchTarget')}
            value={rule.next}
            onChange={(event) => update(ruleIndex, { ...rule, next: event.target.value })}
          >
            {later.map((item) => (
              <option key={item.key} value={item.id}>
                {t('surveyQuestionNumber').replace('{n}', String(questions.indexOf(item) + 1))}
                {item.question ? `: ${item.question.slice(0, 40)}` : ''}
              </option>
            ))}
            <option value={SURVEY_END}>{t('surveyBranchEnd')}</option>
          </select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('surveyRemoveBranch')}
            onClick={() => onChange(question.branching.filter((_, i) => i !== ruleIndex))}
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </Button>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Question editor                                                                               */
/* -------------------------------------------------------------------------------------------- */

function QuestionEditor({
  question,
  index,
  questions,
  onChange,
  onMove,
  onRemove,
  onDuplicate,
  onPreview,
}: {
  question: QuestionDraft;
  index: number;
  questions: QuestionDraft[];
  onChange: (next: QuestionDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onPreview: () => void;
}) {
  const idPrefix = `survey-q-${question.key}`;
  const patch = (partial: Partial<QuestionDraft>) => onChange({ ...question, ...partial } as QuestionDraft);
  return (
    <div className="product-question">
      <div className="product-question-head">
        <button type="button" className="product-question-number" onClick={onPreview} title={t('surveyPreviewQuestion')}>
          {t('surveyQuestionNumber').replace('{n}', String(index + 1))}
        </button>
        <select
          className="select product-question-type"
          aria-label={t('surveyType')}
          value={question.type}
          onChange={(event) => onChange(convertQuestion(question, event.target.value as SurveyQuestionType))}
        >
          {QUESTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {questionTypeLabel(type)}
            </option>
          ))}
        </select>
        <div className="product-question-tools">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('surveyMoveUp')} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={14} strokeWidth={2} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('surveyMoveDown')}
            disabled={index === questions.length - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={14} strokeWidth={2} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('surveyDuplicateQuestion')}
            disabled={questions.length >= SURVEY_MAX_QUESTIONS}
            onClick={onDuplicate}
          >
            <Copy size={14} strokeWidth={2} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="destructive-ghost"
            size="icon-sm"
            aria-label={t('surveyRemoveQuestion')}
            disabled={questions.length <= 1}
            onClick={onRemove}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </div>

      <div className="product-form-grid">
        <div className="field product-field product-form-wide">
          <Label htmlFor={`${idPrefix}-text`}>{t('surveyQuestion')}</Label>
          <Input
            id={`${idPrefix}-text`}
            value={question.question}
            maxLength={500}
            placeholder={t('surveyQuestionPlaceholder')}
            onChange={(event) => patch({ question: event.target.value })}
          />
        </div>
        <div className="field product-field product-form-wide">
          <Label htmlFor={`${idPrefix}-description`}>{t('surveyQuestionDescription')}</Label>
          <Input
            id={`${idPrefix}-description`}
            value={question.description}
            maxLength={1000}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>

        {question.type === 'open' ? (
          <div className="field product-field product-form-wide">
            <Label htmlFor={`${idPrefix}-placeholder`}>{t('surveyPlaceholderLabel')}</Label>
            <Input
              id={`${idPrefix}-placeholder`}
              value={question.placeholder}
              maxLength={120}
              onChange={(event) => patch({ placeholder: event.target.value })}
            />
          </div>
        ) : null}

        {question.type === 'rating' ? (
          <>
            <div className="field product-field">
              <Label htmlFor={`${idPrefix}-scale`}>{t('surveyRatingScale')}</Label>
              <select
                id={`${idPrefix}-scale`}
                className="select"
                value={String(question.scale)}
                onChange={(event) => {
                  const scale = (event.target.value === 'nps' ? 'nps' : Number(event.target.value)) as SurveyRatingScale;
                  // Range branches depend on the scale, so they are dropped when it changes.
                  patch({ scale, branching: question.branching.filter((rule) => rule.when.type !== 'range') } as Partial<QuestionDraft>);
                }}
              >
                {([5, 10, 'nps'] as SurveyRatingScale[]).map((scale) => (
                  <option key={String(scale)} value={String(scale)}>
                    {ratingScaleLabel(scale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field product-field">
              <Label htmlFor={`${idPrefix}-low`}>{t('surveyLowerLabel')}</Label>
              <Input
                id={`${idPrefix}-low`}
                value={question.lowerLabel}
                maxLength={60}
                onChange={(event) => patch({ lowerLabel: event.target.value } as Partial<QuestionDraft>)}
              />
            </div>
            <div className="field product-field">
              <Label htmlFor={`${idPrefix}-high`}>{t('surveyUpperLabel')}</Label>
              <Input
                id={`${idPrefix}-high`}
                value={question.upperLabel}
                maxLength={60}
                onChange={(event) => patch({ upperLabel: event.target.value } as Partial<QuestionDraft>)}
              />
            </div>
          </>
        ) : null}

        {question.type === 'single_choice' || question.type === 'multiple_choice' ? (
          <>
            <div className="field product-field product-form-wide">
              <Label htmlFor={`${idPrefix}-options`}>{t('surveyOptions')}</Label>
              <Textarea
                id={`${idPrefix}-options`}
                value={question.optionsText}
                placeholder={t('surveyOptionsPlaceholder')}
                onChange={(event) =>
                  patch({ optionsText: event.target.value, options: parseOptions(event.target.value) } as Partial<QuestionDraft>)
                }
              />
            </div>
            <label className="checkbox-row product-form-wide">
              <input
                type="checkbox"
                checked={question.hasOther}
                onChange={(event) => patch({ hasOther: event.target.checked } as Partial<QuestionDraft>)}
              />
              <span>{t('surveyHasOther')}</span>
            </label>
          </>
        ) : null}

        {question.type === 'link' ? (
          <div className="field product-field product-form-wide">
            <Label htmlFor={`${idPrefix}-url`}>{t('surveyLinkUrl')}</Label>
            <Input
              id={`${idPrefix}-url`}
              type="url"
              className="mono"
              value={question.url}
              maxLength={1000}
              placeholder="https://"
              onChange={(event) => patch({ url: event.target.value } as Partial<QuestionDraft>)}
            />
          </div>
        ) : null}

        <div className="field product-field">
          <Label htmlFor={`${idPrefix}-button`}>{t('surveyButtonText')}</Label>
          <Input
            id={`${idPrefix}-button`}
            value={question.buttonText}
            maxLength={40}
            placeholder={question.type === 'link' ? t('surveyWidgetOpenLink') : t('surveyWidgetNext')}
            onChange={(event) => patch({ buttonText: event.target.value })}
          />
        </div>
        {question.type !== 'link' ? (
          <label className="checkbox-row product-check-cell">
            <input type="checkbox" checked={question.optional} onChange={(event) => patch({ optional: event.target.checked })} />
            <span>{t('surveyOptionalQuestion')}</span>
          </label>
        ) : null}
      </div>

      <BranchingEditor
        question={question}
        index={index}
        questions={questions}
        onChange={(branching) => patch({ branching })}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Dialog                                                                                        */
/* -------------------------------------------------------------------------------------------- */

export function hostedSurveyUrl(survey: { id?: string; slug?: string | null }) {
  const key = survey.slug || survey.id;
  return key ? `${window.location.origin}/s/${encodeURIComponent(key)}` : '';
}

const TEMPLATES: SurveyTemplateKey[] = ['nps', 'csat', 'feedback', 'blank'];

const TEMPLATE_ICONS: Record<SurveyTemplateKey, typeof Gauge> = {
  blank: FilePlus,
  nps: Gauge,
  csat: Smile,
  feedback: MessageSquareText,
};

/** First step of "New survey": pick a template (or blank) before the builder opens. */
function TemplatePicker({ onPick }: { onPick: (template: SurveyTemplateKey) => void }) {
  return (
    <div className="product-template-grid" role="list">
      {TEMPLATES.map((template) => {
        const Icon = TEMPLATE_ICONS[template];
        return (
          <button key={template} type="button" role="listitem" className="product-template" onClick={() => onPick(template)}>
            <span className="product-template-icon" aria-hidden>
              <Icon strokeWidth={2} />
            </span>
            <span className="product-template-copy">
              <span className="product-template-title">{t(`surveyTemplateTitle_${template}`)}</span>
              <span className="product-template-body">{t(`surveyTemplateBody_${template}`)}</span>
            </span>
            <ChevronRight className="product-template-chevron" strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function SurveyBuilderDialog({
  survey,
  template,
  saving,
  error,
  onClose,
  onSave,
}: {
  /** Null creates a new survey. */
  survey: Survey | null;
  /** Starting point for a new survey; omitted shows the template step first. */
  template?: SurveyTemplateKey;
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (body: SurveyBody) => void;
}) {
  const [step, setStep] = useState<'template' | 'build'>(survey || template ? 'build' : 'template');
  const [draft, setDraft] = useState<SurveyDraft>(() => draftFromSurvey(survey, template ?? 'blank'));
  const [previewIndex, setPreviewIndex] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const theme = useResolvedTheme();
  const { body, errors } = useMemo(() => buildBody(draft), [draft]);
  const previewQuestions = useMemo(() => questionsFromDraft(draft.questions), [draft.questions]);

  function updateQuestion(key: string, next: QuestionDraft) {
    setDraft((prev) => ({ ...prev, questions: prev.questions.map((item) => (item.key === key ? next : item)) }));
  }

  function moveQuestion(index: number, delta: -1 | 1) {
    setDraft((prev) => {
      const questions = [...prev.questions];
      const target = index + delta;
      if (target < 0 || target >= questions.length) return prev;
      [questions[index], questions[target]] = [questions[target], questions[index]];
      return { ...prev, questions };
    });
  }

  function removeQuestion(index: number) {
    setDraft((prev) => {
      const removed = prev.questions[index];
      // Rules that pointed at the removed question fall back to "next question".
      const questions = prev.questions
        .filter((_, i) => i !== index)
        .map((item) => ({ ...item, branching: item.branching.filter((rule) => rule.next !== removed.id) }) as QuestionDraft);
      return { ...prev, questions };
    });
  }

  function addQuestion(type: SurveyQuestionType) {
    setDraft((prev) => ({ ...prev, questions: [...prev.questions, toDraft(newQuestion(type))] }));
  }

  function setAppearance(partial: Partial<SurveyAppearance>) {
    setDraft((prev) => ({ ...prev, appearance: { ...prev.appearance, ...partial } }));
  }

  const hostedUrl = hostedSurveyUrl({ id: survey?.id, slug: draft.slug.trim().toLowerCase() || null });
  const title = survey ? t('surveyEdit') : t('createSurvey');

  if (step === 'template') {
    return (
      <ModalDialog className="product-dialog product-dialog--narrow" aria-label={title} onClose={onClose}>
        <header className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <p className="dialog-description">{t('surveyStartFromLead')}</p>
        </header>
        <div className="dialog-body">
          <TemplatePicker
            onPick={(key) => {
              setDraft(draftFromSurvey(null, key));
              setStep('build');
            }}
          />
        </div>
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
        </footer>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog className="product-dialog product-dialog--builder" aria-label={title} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{title}</h2>
      </header>
      <div className="dialog-body product-form product-survey-builder">
        <div className="product-survey-builder-main">
          <div className="product-form-grid">
            <div className="field product-field">
              <Label htmlFor="survey-builder-name">{t('name')}</Label>
              <Input
                id="survey-builder-name"
                value={draft.name}
                maxLength={120}
                placeholder={t('surveyNamePlaceholder')}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <label className="checkbox-row product-check-cell">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <span>{t('surveyEnabledLabel')}</span>
            </label>
          </div>

          <FormSection title={t('surveyQuestions')} lead={t('surveyQuestionsLead')}>
            <div className="product-question-list">
              {draft.questions.map((question, index) => (
                <QuestionEditor
                  key={question.key}
                  question={question}
                  index={index}
                  questions={draft.questions}
                  onChange={(next) => updateQuestion(question.key, next)}
                  onMove={(delta) => moveQuestion(index, delta)}
                  onRemove={() => removeQuestion(index)}
                  onDuplicate={() =>
                    setDraft((prev) => {
                      const copy = toDraft({ ...questionsFromDraft([question])[0], id: randomId(), branching: [] });
                      const questions = [...prev.questions];
                      questions.splice(index + 1, 0, copy);
                      return { ...prev, questions };
                    })
                  }
                  onPreview={() => setPreviewIndex(index)}
                />
              ))}
            </div>
            <div className="product-add-row">
              <span className="product-add-row-label">{t('surveyAddQuestion')}</span>
              {QUESTION_TYPES.map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={draft.questions.length >= SURVEY_MAX_QUESTIONS}
                  onClick={() => addQuestion(type)}
                >
                  <Plus size={14} strokeWidth={2} aria-hidden />
                  {questionTypeLabel(type)}
                </Button>
              ))}
            </div>
          </FormSection>

          <FormSection title={t('surveyTargeting')} lead={t('surveyTargetingLead')}>
            <div className="product-form-grid">
              <div className="field product-field">
                <Label htmlFor="survey-builder-path">{t('surveyTriggerPath')}</Label>
                <Input
                  id="survey-builder-path"
                  className="mono"
                  value={draft.triggerPath}
                  placeholder="/pricing"
                  onChange={(event) => setDraft((prev) => ({ ...prev, triggerPath: event.target.value }))}
                />
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-event">{t('surveyTriggerEvent')}</Label>
                <Input
                  id="survey-builder-event"
                  className="mono"
                  value={draft.triggerEvent}
                  placeholder="checkout_started"
                  onChange={(event) => setDraft((prev) => ({ ...prev, triggerEvent: event.target.value }))}
                />
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-delay">{t('surveyDisplayDelay')}</Label>
                <Input
                  id="survey-builder-delay"
                  type="number"
                  min={0}
                  max={60}
                  value={draft.displayDelaySeconds}
                  onChange={(event) => setDraft((prev) => ({ ...prev, displayDelaySeconds: event.target.value }))}
                />
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-sample">{t('surveySampleRate')}</Label>
                <Input
                  id="survey-builder-sample"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.sampleRate}
                  onChange={(event) => setDraft((prev) => ({ ...prev, sampleRate: event.target.value }))}
                />
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-repeat">{t('surveyFrequency')}</Label>
                <select
                  id="survey-builder-repeat"
                  className="select"
                  value={draft.repeatMode}
                  onChange={(event) => setDraft((prev) => ({ ...prev, repeatMode: event.target.value as RepeatMode }))}
                >
                  <option value="once">{t('surveyFrequencyOnce')}</option>
                  <option value="interval">{t('surveyFrequencyInterval')}</option>
                </select>
              </div>
              {draft.repeatMode === 'interval' ? (
                <div className="field product-field">
                  <Label htmlFor="survey-builder-repeat-days">{t('surveyRepeatDays')}</Label>
                  <Input
                    id="survey-builder-repeat-days"
                    type="number"
                    min={1}
                    max={365}
                    value={draft.repeatIntervalDays}
                    onChange={(event) => setDraft((prev) => ({ ...prev, repeatIntervalDays: event.target.value }))}
                  />
                </div>
              ) : null}
              <div className="field product-field">
                <Label htmlFor="survey-builder-limit">{t('surveyResponseLimit')}</Label>
                <Input
                  id="survey-builder-limit"
                  type="number"
                  min={1}
                  value={draft.responseLimit}
                  placeholder={t('surveyNoLimit')}
                  onChange={(event) => setDraft((prev) => ({ ...prev, responseLimit: event.target.value }))}
                />
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-start">{t('surveyStartsAt')}</Label>
                <Input
                  id="survey-builder-start"
                  type="datetime-local"
                  value={draft.startsAt}
                  onChange={(event) => setDraft((prev) => ({ ...prev, startsAt: event.target.value }))}
                />
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-end">{t('surveyEndsAt')}</Label>
                <Input
                  id="survey-builder-end"
                  type="datetime-local"
                  value={draft.endsAt}
                  onChange={(event) => setDraft((prev) => ({ ...prev, endsAt: event.target.value }))}
                />
              </div>
              <div className="field product-field product-form-wide">
                <Label htmlFor="survey-builder-rules">{t('surveyDisplayRules')}</Label>
                <Textarea
                  id="survey-builder-rules"
                  className="mono product-code-input"
                  value={draft.displayRulesText}
                  placeholder={t('surveyDisplayRulesPlaceholder')}
                  onChange={(event) => setDraft((prev) => ({ ...prev, displayRulesText: event.target.value }))}
                />
                <p className="field-hint">
                  {t('surveyDisplayRulesHint').replace('{count}', String(parseDisplayRules(draft.displayRulesText).length))}
                </p>
              </div>
            </div>
          </FormSection>

          <FormSection title={t('surveyHosted')} lead={t('surveyHostedLead')}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.hostedEnabled}
                onChange={(event) => setDraft((prev) => ({ ...prev, hostedEnabled: event.target.checked }))}
              />
              <span>{t('surveyHostedEnable')}</span>
            </label>
            {draft.hostedEnabled ? (
              <div className="product-form-grid">
                <div className="field product-field">
                  <Label htmlFor="survey-builder-slug">{t('surveySlug')}</Label>
                  <Input
                    id="survey-builder-slug"
                    className="mono"
                    value={draft.slug}
                    maxLength={64}
                    placeholder="beta-feedback"
                    onChange={(event) => setDraft((prev) => ({ ...prev, slug: event.target.value }))}
                  />
                </div>
                <div className="field product-field">
                  <span className="field-label">{t('surveyHostedLink')}</span>
                  {hostedUrl ? (
                    <div className="product-copy-row">
                      <code className="mono product-copy-value">{hostedUrl}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('copyToClipboard')}
                        onClick={() => {
                          void navigator.clipboard?.writeText(hostedUrl).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          });
                        }}
                      >
                        <Copy size={14} strokeWidth={2} aria-hidden />
                      </Button>
                      {copied ? <span className="product-copy-done">{t('copied')}</span> : null}
                    </div>
                  ) : (
                    <p className="field-hint">{t('surveyHostedAfterSave')}</p>
                  )}
                </div>
              </div>
            ) : null}
          </FormSection>

          <FormSection title={t('surveyAppearance')} lead={t('surveyAppearanceLead')}>
            <div className="product-form-grid">
              <div className="field product-field">
                <Label htmlFor="survey-builder-position">{t('surveyPosition')}</Label>
                <select
                  id="survey-builder-position"
                  className="select"
                  value={draft.appearance.position}
                  onChange={(event) => setAppearance({ position: event.target.value as SurveyAppearance['position'] })}
                >
                  {surveyPositions.map((position) => (
                    <option key={position} value={position}>
                      {t(`surveyPosition_${position.replace('-', '_')}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-theme">{t('surveyColorScheme')}</Label>
                <select
                  id="survey-builder-theme"
                  className="select"
                  value={draft.appearance.theme}
                  onChange={(event) => setAppearance({ theme: event.target.value as SurveyAppearance['theme'] })}
                >
                  {surveyColorSchemes.map((scheme) => (
                    <option key={scheme} value={scheme}>
                      {t(`surveyColorScheme_${scheme}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field product-field product-form-wide">
                <span className="field-label">{t('surveyAccent')}</span>
                <div className="survey-accent-list" role="radiogroup" aria-label={t('surveyAccent')}>
                  {surveyAccents.map((accent) => (
                    <button
                      key={accent}
                      type="button"
                      role="radio"
                      aria-checked={draft.appearance.accent === accent}
                      className={`survey-accent-option${draft.appearance.accent === accent ? ' is-selected' : ''}`}
                      onClick={() => setAppearance({ accent })}
                    >
                      <span className="survey-accent-dot" data-accent={accent} aria-hidden />
                      {t(`surveyAccent_${accent}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field product-field">
                <Label htmlFor="survey-builder-submit">{t('surveySubmitText')}</Label>
                <Input
                  id="survey-builder-submit"
                  value={draft.appearance.submitText}
                  maxLength={40}
                  placeholder={t('surveyWidgetSubmit')}
                  onChange={(event) => setAppearance({ submitText: event.target.value })}
                />
              </div>
              <label className="checkbox-row product-check-cell">
                <input
                  type="checkbox"
                  checked={draft.appearance.showThankYou}
                  onChange={(event) => setAppearance({ showThankYou: event.target.checked })}
                />
                <span>{t('surveyShowThankYou')}</span>
              </label>
              {draft.appearance.showThankYou ? (
                <div className="field product-field product-form-wide">
                  <Label htmlFor="survey-builder-thanks">{t('surveyThankYouMessage')}</Label>
                  <Input
                    id="survey-builder-thanks"
                    value={draft.appearance.thankYouMessage}
                    maxLength={200}
                    placeholder={t('surveyThankYouDefault')}
                    onChange={(event) => setAppearance({ thankYouMessage: event.target.value })}
                  />
                </div>
              ) : null}
            </div>
          </FormSection>

          {showErrors ? <FormErrors errors={errors} /> : null}
          {error ? (
            <p className="text-danger" role="alert">
              {error.message}
            </p>
          ) : null}
        </div>

        <aside className="product-survey-preview" aria-label={t('surveyPreview')}>
          <span className="product-survey-preview-label">{t('surveyPreview')}</span>
          <div className={`survey-preview-stage survey-preview-stage--${draft.appearance.position}`}>
            {previewQuestions.some((question) => question.question) ? (
              <SurveyRenderer
                preview
                questions={previewQuestions}
                appearance={draft.appearance}
                scheme={theme}
                focusIndex={previewIndex}
              />
            ) : (
              <p className="text-muted survey-preview-empty">{t('surveyPreviewEmpty')}</p>
            )}
          </div>
          <p className="product-note">{t('surveyPreviewHint')}</p>
        </aside>
      </div>
      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={saving}
          onClick={() => {
            if (body) onSave(body);
            else setShowErrors(true);
          }}
        >
          {saving ? t('saving') : survey ? t('save') : t('createSurvey')}
        </Button>
      </footer>
    </ModalDialog>
  );
}
