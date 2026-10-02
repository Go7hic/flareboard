import type { SurveyQuestion } from '@flareboard/shared/survey-flow';
import type { Experiment, FeatureFlag, FeatureFlagConditionGroup, Survey } from '../../lib/api';
import { t } from '../../lib/i18n';
import type { StatusTone } from '../StatusBadge';

export type StatusInfo = { tone: StatusTone; label: string };

/* ── Feature flags ─────────────────────────────────────────────────────────── */

export function flagGroups(flag: FeatureFlag): FeatureFlagConditionGroup[] {
  return flag.conditionGroups?.length
    ? flag.conditionGroups
    : [{ conditions: flag.targetingRules ?? [], rollout: flag.rollout, variant: null }];
}

/** On / off / partial rollout, as the list and the detail header show it. */
export function flagStatus(flag: FeatureFlag): StatusInfo {
  if (!flag.enabled) return { tone: 'neutral', label: t('productFlagOff') };
  const groups = flagGroups(flag);
  if (groups.length === 1 && groups[0]!.rollout < 100) {
    return { tone: 'info', label: t('productFlagRollout').replace('{percent}', String(groups[0]!.rollout)) };
  }
  if (groups.every((group) => group.rollout === 0)) {
    return { tone: 'warning', label: t('productFlagRollout').replace('{percent}', '0') };
  }
  return { tone: 'success', label: t('productFlagOn') };
}

/* ── Experiments ───────────────────────────────────────────────────────────── */

const EXPERIMENT_TONES: Record<Experiment['status'], StatusTone> = {
  draft: 'neutral',
  running: 'success',
  paused: 'warning',
  completed: 'info',
};

export function experimentStatus(experiment: Experiment): StatusInfo {
  return { tone: EXPERIMENT_TONES[experiment.status], label: t(`experimentStatus_${experiment.status}`) };
}

/* ── Surveys ───────────────────────────────────────────────────────────────── */

export function surveyStatus(survey: Survey, now: number): StatusInfo {
  if (!survey.enabled) return { tone: 'neutral', label: t('productSurveyOff') };
  if (survey.startsAt != null && now < survey.startsAt) return { tone: 'info', label: t('surveyStatusScheduled') };
  if (survey.endsAt != null && now >= survey.endsAt) return { tone: 'neutral', label: t('surveyStatusEnded') };
  if (survey.responseLimit != null && (survey.summary?.responses ?? 0) >= survey.responseLimit) {
    return { tone: 'warning', label: t('surveyStatusLimitReached') };
  }
  return { tone: 'success', label: t('surveyEnabledLabel') };
}

export type SurveyKind = 'nps' | 'csat' | 'rating' | 'single_choice' | 'multiple_choice' | 'open' | 'link';

/** What the survey measures, read from its first question (NPS, CSAT, choice, open text…). */
export function surveyKind(questions: SurveyQuestion[]): SurveyKind {
  const first = questions[0];
  if (!first) return 'open';
  if (first.type === 'rating') return first.scale === 'nps' ? 'nps' : first.scale === 5 ? 'csat' : 'rating';
  return first.type;
}

export function surveyKindLabel(kind: SurveyKind) {
  return t(`productSurveyKind_${kind}`);
}

/* ── Workflows ─────────────────────────────────────────────────────────────── */

export function workflowStatus(enabled: boolean): StatusInfo {
  return enabled
    ? { tone: 'success', label: t('productWorkflowOn') }
    : { tone: 'neutral', label: t('productWorkflowOff') };
}

const RUN_TONES: Record<string, StatusTone> = {
  success: 'success',
  recorded: 'success',
  passed: 'success',
  sent: 'success',
  rendered: 'success',
  failed: 'danger',
  throttled: 'danger',
  queued: 'info',
  running: 'info',
  waiting: 'info',
  retrying: 'warning',
  stopped: 'neutral',
  cancelled: 'neutral',
  skipped: 'neutral',
  not_reached: 'neutral',
};

const RUN_STATUSES = new Set([
  'recorded',
  'queued',
  'running',
  'waiting',
  'retrying',
  'success',
  'failed',
  'stopped',
  'throttled',
  'cancelled',
  'passed',
]);

/** Execution / attempt status as a sentence-case badge label and tone. */
export function runStatus(status: string): StatusInfo {
  return {
    tone: RUN_TONES[status] ?? 'neutral',
    label: RUN_STATUSES.has(status) ? t(`productRunStatus_${status}`) : status,
  };
}

/** Workflow test step outcome (preview / send). */
export function testStepStatus(status: string): StatusInfo {
  return { tone: RUN_TONES[status] ?? 'neutral', label: t(`productTestStatus_${status}`) };
}
