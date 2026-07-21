import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, MessageSquareText } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { ResourceEditDialog } from '../components/ResourceEditDialog';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Survey, type SurveyDisplayRule, type SurveyResponsesResponse } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { formatDateOnly, formatDateTime, formatNumber, formatPercent } from '../lib/format';

const DEFAULT_SURVEY = {
  name: '',
  question: '',
  type: 'text' as Survey['type'],
  optionsText: '',
  triggerPath: '',
  triggerEvent: '',
  displayDelaySeconds: 0,
  displayRulesText: '',
};

function surveyTypeLabel(type: Survey['type']) {
  if (type === 'rating') return t('surveyType_rating');
  if (type === 'choice') return t('surveyType_choice');
  return t('surveyType_text');
}

function formatRating(value: number | null | undefined) {
  if (value == null) return '-';
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function sentimentLabel(sentiment: 'positive' | 'negative' | 'neutral') {
  if (sentiment === 'positive') return t('sentiment_positive');
  if (sentiment === 'negative') return t('sentiment_negative');
  return t('sentiment_neutral');
}

function themeLabel(theme: string) {
  switch (theme) {
    case 'price':
      return t('surveyTheme_price');
    case 'bug':
      return t('surveyTheme_bug');
    case 'confusion':
      return t('surveyTheme_confusion');
    case 'feature_request':
      return t('surveyTheme_feature_request');
    case 'support':
      return t('surveyTheme_support');
    case 'performance':
      return t('surveyTheme_performance');
    default:
      return t('surveyTheme_other');
  }
}

function parseSurveyOptions(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifySurveyOptions(survey: Survey) {
  return survey.options.join('\n');
}

const DISPLAY_RULE_FIELDS = ['path', 'event', 'property', 'language', 'country', 'device'] as const;
const DISPLAY_RULE_OPERATORS = [
  'equals',
  'contains',
  'starts_with',
  'ends_with',
  'not_equals',
  'not_contains',
  'exists',
  'not_exists',
] as const;

function parseDisplayRules(value: string): SurveyDisplayRule[] {
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
        DISPLAY_RULE_FIELDS.includes(rule.field) &&
        DISPLAY_RULE_OPERATORS.includes(rule.operator) &&
        (rule.operator === 'exists' || rule.operator === 'not_exists' || rule.value) &&
        (rule.field === 'property' ? Boolean(rule.key) : true),
    );
}

function stringifyDisplayRules(survey: Survey) {
  return (survey.displayRules ?? [])
    .map((rule) => `${rule.key ? `${rule.field}.${rule.key}` : rule.field} ${rule.operator} ${rule.value}`.trim())
    .join('\n');
}

function SurveyEditDialog({
  survey,
  saving,
  error,
  onClose,
  onSave,
}: {
  survey: Survey;
  saving: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: (survey: Survey, patch: Partial<Survey>) => void;
}) {
  const [draft, setDraft] = useState({
    name: survey.name,
    question: survey.question,
    type: survey.type,
    optionsText: stringifySurveyOptions(survey),
    triggerPath: survey.triggerPath ?? '',
    triggerEvent: survey.triggerEvent ?? '',
    displayDelaySeconds: survey.displayDelaySeconds ?? 0,
    displayRulesText: stringifyDisplayRules(survey),
    enabled: survey.enabled,
  });

  useEffect(() => {
    setDraft({
      name: survey.name,
      question: survey.question,
      type: survey.type,
      optionsText: stringifySurveyOptions(survey),
      triggerPath: survey.triggerPath ?? '',
      triggerEvent: survey.triggerEvent ?? '',
      displayDelaySeconds: survey.displayDelaySeconds ?? 0,
      displayRulesText: stringifyDisplayRules(survey),
      enabled: survey.enabled,
    });
  }, [survey]);

  const options = draft.type === 'choice' ? parseSurveyOptions(draft.optionsText) : [];
  const displayRules = parseDisplayRules(draft.displayRulesText);
  const displayRuleLineCount = draft.displayRulesText.split('\n').map((line) => line.trim()).filter(Boolean).length;
  const canSave =
    Boolean(draft.name.trim() && draft.question.trim()) &&
    (draft.type !== 'choice' || options.length >= 2) &&
    displayRuleLineCount === displayRules.length &&
    !saving;

  return (
    <ResourceEditDialog
      title={t('surveyEdit')}
      ariaLabel={t('surveyEdit')}
      panelClassName="survey-dialog"
      bodyClassName="survey-dialog-body"
      saving={saving}
      error={error}
      canSave={canSave}
      onClose={onClose}
      onSave={() =>
        onSave(survey, {
          name: draft.name.trim(),
          question: draft.question.trim(),
          type: draft.type,
          options,
          triggerPath: draft.triggerPath.trim() || null,
          triggerEvent: draft.triggerEvent.trim() || null,
          displayDelaySeconds: Number(draft.displayDelaySeconds),
          displayRules,
          enabled: draft.enabled,
        })
      }
    >
          <div className="field">
            <Label htmlFor="survey-dialog-name">{t('name')}</Label>
            <Input
              id="survey-dialog-name"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-dialog-type">{t('surveyType')}</Label>
            <select
              id="survey-dialog-type"
              className="select"
              value={draft.type}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, type: event.target.value as Survey['type'] }))
              }
            >
              <option value="text">{t('surveyTypeText')}</option>
              <option value="rating">{t('surveyTypeRating')}</option>
              <option value="choice">{t('surveyTypeChoice')}</option>
            </select>
          </div>
          <div className="field survey-dialog-wide">
            <Label htmlFor="survey-dialog-question">{t('surveyQuestion')}</Label>
            <Input
              id="survey-dialog-question"
              value={draft.question}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, question: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-dialog-trigger">{t('surveyTriggerPath')}</Label>
            <Input
              id="survey-dialog-trigger"
              value={draft.triggerPath}
              placeholder="/pricing"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, triggerPath: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-dialog-event">{t('surveyTriggerEvent')}</Label>
            <Input
              id="survey-dialog-event"
              value={draft.triggerEvent}
              placeholder="checkout_started"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, triggerEvent: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-dialog-delay">{t('surveyDisplayDelay')}</Label>
            <Input
              id="survey-dialog-delay"
              type="number"
              min={0}
              max={60}
              value={draft.displayDelaySeconds}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, displayDelaySeconds: Number(event.target.value) }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-dialog-status">{t('status')}</Label>
            <select
              id="survey-dialog-status"
              className="select"
              value={draft.enabled ? 'enabled' : 'disabled'}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, enabled: event.target.value === 'enabled' }))
              }
            >
              <option value="enabled">{t('enabled')}</option>
              <option value="disabled">{t('disabled')}</option>
            </select>
          </div>
          {draft.type === 'choice' ? (
            <div className="field survey-dialog-wide">
              <Label htmlFor="survey-dialog-options">{t('surveyOptions')}</Label>
              <textarea
                id="survey-dialog-options"
                className="textarea"
                value={draft.optionsText}
                placeholder={t('surveyOptionsPlaceholder')}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, optionsText: event.target.value }))
                }
              />
            </div>
          ) : null}
          <div className="field survey-dialog-wide">
            <Label htmlFor="survey-dialog-display-rules">{t('surveyDisplayRules')}</Label>
            <textarea
              id="survey-dialog-display-rules"
              className="textarea"
              value={draft.displayRulesText}
              placeholder={t('surveyDisplayRulesPlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, displayRulesText: event.target.value }))
              }
            />
            <p className={displayRuleLineCount === displayRules.length ? 'text-muted' : 'text-danger'}>
              {t('surveyDisplayRulesHint').replace('{count}', String(displayRules.length))}
            </p>
          </div>
    </ResourceEditDialog>
  );
}

export default function WebsiteSurveysPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId, 'surveys');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_SURVEY);
  const [filters, setFilters] = useState({ q: '', path: '', answer: '' });
  const [editingSurvey, setEditingSurvey] = useState<Survey | null>(null);

  const surveysQuery = useQuery({
    queryKey: ['surveys', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Survey[]>(`/api/websites/${websiteId}/surveys`),
  });

  const surveys = useMemo(() => surveysQuery.data ?? [], [surveysQuery.data]);
  const { selectedId: selectedSurveyId, setSelectedId: setSelectedSurveyId, selectedItem: selectedSurveyFromList } =
    useMasterDetailSelection(surveys, (survey) => survey.id);

  useEffect(() => {
    if (!surveys.length) {
      setSelectedSurveyId(null);
      return;
    }
    const requestedSurveyId = searchParams.get('survey');
    if (requestedSurveyId && surveys.some((survey) => survey.id === requestedSurveyId)) {
      setSelectedSurveyId(requestedSurveyId);
      return;
    }
    if (!selectedSurveyId || !surveys.some((survey) => survey.id === selectedSurveyId)) {
      const nextSurveyId = surveys[0].id;
      setSelectedSurveyId(nextSurveyId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('survey', nextSurveyId);
        return next;
      }, { replace: true });
    }
  }, [searchParams, selectedSurveyId, setSearchParams, surveys]);

  useEffect(() => {
    setFilters({ q: '', path: '', answer: '' });
  }, [selectedSurveyId]);

  const debouncedQ = useDebouncedValue(filters.q, 300);
  const debouncedPath = useDebouncedValue(filters.path, 300);

  const responsesQuery = useQuery({
    queryKey: ['survey-responses', websiteId, selectedSurveyId, debouncedQ, debouncedPath, filters.answer],
    enabled: Boolean(websiteId && selectedSurveyId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
      if (debouncedPath.trim()) params.set('path', debouncedPath.trim());
      if (filters.answer.trim()) params.set('answer', filters.answer.trim());
      const qs = params.toString();
      return api<SurveyResponsesResponse>(
        `/api/websites/${websiteId}/surveys/${selectedSurveyId}/responses${qs ? `?${qs}` : ''}`,
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<Survey>(`/api/websites/${websiteId}/surveys`, {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          question: draft.question.trim(),
          type: draft.type,
          options: draft.type === 'choice' ? parseSurveyOptions(draft.optionsText) : [],
          triggerPath: draft.triggerPath.trim() || null,
          triggerEvent: draft.triggerEvent.trim() || null,
          displayDelaySeconds: Number(draft.displayDelaySeconds),
          displayRules: parseDisplayRules(draft.displayRulesText),
          enabled: true,
        }),
      }),
    onSuccess: (survey) => {
      setDraft(DEFAULT_SURVEY);
      setSelectedSurveyId(survey.id);
      queryClient.invalidateQueries({ queryKey: ['surveys', websiteId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Survey> }) =>
      api<Survey>(`/api/websites/${websiteId}/surveys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      setEditingSurvey(null);
      queryClient.invalidateQueries({ queryKey: ['surveys', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['survey-responses', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/websites/${websiteId}/surveys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['surveys', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['survey-responses', websiteId] });
    },
  });

  const selectedSurvey =
    selectedSurveyFromList ?? responsesQuery.data?.survey ?? null;
  const responses = responsesQuery.data?.responses ?? [];
  const summary = responsesQuery.data?.summary ?? selectedSurvey?.summary;
  const answerOptions =
    selectedSurvey?.type === 'rating'
      ? ['1', '2', '3', '4', '5']
      : selectedSurvey?.type === 'choice'
        ? selectedSurvey.options
        : [];
  const optionCount = draft.optionsText
    ? parseSurveyOptions(draft.optionsText).length
    : 0;
  const displayRules = parseDisplayRules(draft.displayRulesText);
  const displayRuleLineCount = draft.displayRulesText.split('\n').map((line) => line.trim()).filter(Boolean).length;
  const canCreate =
    Boolean(draft.name.trim() && draft.question.trim()) &&
    (draft.type !== 'choice' || optionCount >= 2) &&
    displayRuleLineCount === displayRules.length &&
    !createMutation.isPending;

  return (
    <Page className="page-surveys">
      <PageHeader title={t('surveys')} lead={t('surveysLead')} />

      <PageBody>

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      {canEdit ? (
      <section className="panel section-gap">
        <div className="panel-form">
          <div className="field">
            <Label htmlFor="survey-name">{t('name')}</Label>
            <Input
              id="survey-name"
              value={draft.name}
              placeholder={t('surveyNamePlaceholder')}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="field feature-flag-description-field">
            <Label htmlFor="survey-question">{t('surveyQuestion')}</Label>
            <Input
              id="survey-question"
              value={draft.question}
              placeholder={t('surveyQuestionPlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, question: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-type">{t('surveyType')}</Label>
            <select
              id="survey-type"
              className="select"
              value={draft.type}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, type: event.target.value as Survey['type'] }))
              }
            >
              <option value="text">{t('surveyTypeText')}</option>
              <option value="rating">{t('surveyTypeRating')}</option>
              <option value="choice">{t('surveyTypeChoice')}</option>
            </select>
          </div>
          <div className="field">
            <Label htmlFor="survey-trigger-path">{t('surveyTriggerPath')}</Label>
            <Input
              id="survey-trigger-path"
              value={draft.triggerPath}
              placeholder="/pricing"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, triggerPath: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-trigger-event">{t('surveyTriggerEvent')}</Label>
            <Input
              id="survey-trigger-event"
              value={draft.triggerEvent}
              placeholder="checkout_started"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, triggerEvent: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <Label htmlFor="survey-display-delay">{t('surveyDisplayDelay')}</Label>
            <Input
              id="survey-display-delay"
              type="number"
              min={0}
              max={60}
              value={draft.displayDelaySeconds}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, displayDelaySeconds: Number(event.target.value) }))
              }
            />
          </div>
          {draft.type === 'choice' ? (
            <div className="field feature-flag-description-field">
              <Label htmlFor="survey-options">{t('surveyOptions')}</Label>
              <textarea
                id="survey-options"
                className="textarea"
                value={draft.optionsText}
                placeholder={t('surveyOptionsPlaceholder')}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, optionsText: event.target.value }))
                }
              />
            </div>
          ) : null}
          <div className="field feature-flag-description-field">
            <Label htmlFor="survey-display-rules">{t('surveyDisplayRules')}</Label>
            <textarea
              id="survey-display-rules"
              className="textarea"
              value={draft.displayRulesText}
              placeholder={t('surveyDisplayRulesPlaceholder')}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, displayRulesText: event.target.value }))
              }
            />
            <p className={displayRuleLineCount === displayRules.length ? 'text-muted' : 'text-danger'}>
              {t('surveyDisplayRulesHint').replace('{count}', String(displayRules.length))}
            </p>
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="primary"
              disabled={!canCreate}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? t('saving') : t('createSurvey')}
            </Button>
          </div>
        </div>
        {createMutation.error ? (
          <p className="text-danger">{(createMutation.error as Error).message}</p>
        ) : null}
      </section>
      ) : null}

      <section className="section-gap">
        {surveysQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : surveys.length ? (
          <MasterDetailLayout
            list={surveys.map((survey) => (
              <MasterDetailListItem
                key={survey.id}
                selected={survey.id === selectedSurveyId}
                onSelect={() => {
                  setSelectedSurveyId(survey.id);
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set('survey', survey.id);
                    return next;
                  });
                }}
                icon={<MessageSquareText size={16} strokeWidth={2} aria-hidden />}
                title={survey.name}
                subtitle={survey.question}
                meta={
                  <>
                    <span className="badge">{survey.enabled ? t('enabled') : t('disabled')}</span>
                    <span className="text-muted">
                      {formatNumber(survey.summary?.responses ?? 0)} {t('surveyResponses')}
                    </span>
                  </>
                }
              />
            ))}
            detail={
              selectedSurvey ? (
                <MasterDetailPane
                  title={selectedSurvey.name}
                  description={
                    <>
                      <p className="text-muted">{selectedSurvey.question}</p>
                      <p className="text-muted">
                        {t('surveyType')}: {surveyTypeLabel(selectedSurvey.type)}
                      </p>
                      {selectedSurvey.triggerPath ? (
                        <p className="text-muted">
                          {t('surveyTriggerPath')}: {selectedSurvey.triggerPath}
                        </p>
                      ) : null}
                      {selectedSurvey.triggerEvent ? (
                        <p className="text-muted">
                          {t('surveyTriggerEvent')}: {selectedSurvey.triggerEvent}
                        </p>
                      ) : null}
                      {selectedSurvey.displayDelaySeconds ? (
                        <p className="text-muted">
                          {t('surveyDisplayDelay')}: {selectedSurvey.displayDelaySeconds}s
                        </p>
                      ) : null}
                      {selectedSurvey.displayRules?.length ? (
                        <p className="text-muted">
                          {t('surveyDisplayRules')}: {selectedSurvey.displayRules.length}
                        </p>
                      ) : null}
                    </>
                  }
                  actions={
                    canEdit ? (
                      <div className="cohorts-row-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateMutation.mutate({
                              id: selectedSurvey.id,
                              patch: { enabled: !selectedSurvey.enabled },
                            })
                          }
                        >
                          {selectedSurvey.enabled ? t('disable') : t('enable')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingSurvey(selectedSurvey)}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="btn-danger-text"
                          onClick={() => deleteMutation.mutate(selectedSurvey.id)}
                        >
                          {t('delete')}
                        </Button>
                      </div>
                    ) : null
                  }
                >
                  <div className="detail-stats">
                    <div>
                      <span className="stat-label">{t('surveyResponses')}</span>
                      <strong className="stat-value">
                        {formatNumber((summary?.responses ?? 0))}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('surveySessions')}</span>
                      <strong className="stat-value">
                        {formatNumber((summary?.sessions ?? 0))}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('surveyLastResponse')}</span>
                      <strong className="stat-value">{formatDateTime(summary?.lastResponseAt)}</strong>
                    </div>
                    {selectedSurvey.type === 'rating' ? (
                      <div>
                        <span className="stat-label">{t('surveyAverageRating')}</span>
                        <strong className="stat-value">
                          {formatRating(summary?.averageRating)}
                        </strong>
                      </div>
                    ) : null}
                  </div>

                  {summary?.trend?.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('surveyTrend')}</h3>
                          <p className="text-muted">{t('surveyTrendLead')}</p>
                        </div>
                      </div>
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>{t('date')}</th>
                              <th>{t('surveyResponses')}</th>
                              <th>{t('surveySessions')}</th>
                              {selectedSurvey.type === 'rating' ? (
                                <th>{t('surveyAverageRating')}</th>
                              ) : null}
                            </tr>
                          </thead>
                          <tbody>
                            {summary.trend.map((item) => (
                              <tr key={item.date}>
                                <td className="text-muted">{item.date}</td>
                                <td className="num">{formatNumber(item.responses)}</td>
                                <td className="num">{formatNumber(item.sessions)}</td>
                                {selectedSurvey.type === 'rating' ? (
                                  <td className="num">{formatRating(item.averageRating)}</td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {summary?.sentiment?.length || summary?.themes?.length ? (
                    <div className="workflow-insights-grid">
                      {summary?.sentiment?.length ? (
                        <div className="detail-section">
                          <div className="panel-header compact-panel-header">
                            <div>
                              <h3 className="section-title experiment-title">
                                {t('surveySentimentBreakdown')}
                              </h3>
                              <p className="text-muted">{t('surveySentimentBreakdownLead')}</p>
                            </div>
                          </div>
                          <div className="breakdown-list">
                            {summary.sentiment.map((item) => (
                              <div key={item.sentiment} className="breakdown-row">
                                <div className="breakdown-meta">
                                  <strong>{sentimentLabel(item.sentiment)}</strong>
                                  <span className="text-muted">
                                    {formatNumber(item.responses)} {t('surveyResponses')} ·{' '}
                                    {formatNumber(item.percentage)}%
                                  </span>
                                </div>
                                <div className="breakdown-track" aria-hidden>
                                  <span style={{ width: `${Math.min(100, item.percentage)}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {summary?.themes?.length ? (
                        <div className="detail-section">
                          <div className="panel-header compact-panel-header">
                            <div>
                              <h3 className="section-title experiment-title">
                                {t('surveyThemeBreakdown')}
                              </h3>
                              <p className="text-muted">{t('surveyThemeBreakdownLead')}</p>
                            </div>
                          </div>
                          <div className="breakdown-list">
                            {summary.themes.map((item) => (
                              <div key={item.theme} className="breakdown-row">
                                <div className="breakdown-meta">
                                  <strong>{themeLabel(item.theme)}</strong>
                                  <span className="text-muted">
                                    {formatNumber(item.responses)} {t('surveyResponses')} ·{' '}
                                    {formatNumber(item.percentage)}%
                                  </span>
                                </div>
                                <div className="breakdown-track" aria-hidden>
                                  <span style={{ width: `${Math.min(100, item.percentage)}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {summary?.pages?.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">
                            {t('surveyPageBreakdown')}
                          </h3>
                          <p className="text-muted">{t('surveyPageBreakdownLead')}</p>
                        </div>
                      </div>
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>{t('page')}</th>
                              <th>{t('surveyResponses')}</th>
                              <th>{t('surveySessions')}</th>
                              <th>{t('surveyLastResponse')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.pages.map((item) => (
                              <tr key={item.urlPath}>
                                <td>{item.urlPath}</td>
                                <td className="num">{formatNumber(item.responses)}</td>
                                <td className="num">{formatNumber(item.sessions)}</td>
                                <td className="text-muted">{formatDateTime(item.lastResponseAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {summary?.breakdown?.length ? (
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">
                            {t('surveyResultBreakdown')}
                          </h3>
                          <p className="text-muted">{t('surveyResultBreakdownLead')}</p>
                        </div>
                      </div>
                      <div className="breakdown-list">
                        {summary.breakdown.map((item) => (
                          <div key={item.answer} className="breakdown-row">
                            <div className="breakdown-meta">
                              <strong>{item.answer}</strong>
                              <span className="text-muted">
                                {formatNumber(item.responses)} {t('surveyResponses')} ·{' '}
                                {formatNumber(item.percentage)}%
                              </span>
                            </div>
                            <div className="breakdown-track" aria-hidden>
                              <span style={{ width: `${Math.min(100, item.percentage)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="survey-response-filters">
                    <div className="field">
                      <Label htmlFor="survey-filter-q">{t('surveyFilterSearch')}</Label>
                      <Input
                        id="survey-filter-q"
                        type="search"
                        value={filters.q}
                        placeholder={t('surveyFilterSearchPlaceholder')}
                        onChange={(event) =>
                          setFilters((prev) => ({ ...prev, q: event.target.value }))
                        }
                      />
                    </div>
                    <div className="field">
                      <Label htmlFor="survey-filter-path">{t('surveyFilterPath')}</Label>
                      <Input
                        id="survey-filter-path"
                        type="search"
                        value={filters.path}
                        placeholder="/pricing"
                        onChange={(event) =>
                          setFilters((prev) => ({ ...prev, path: event.target.value }))
                        }
                      />
                    </div>
                    {answerOptions.length ? (
                      <div className="field">
                        <Label htmlFor="survey-filter-answer">{t('surveyFilterAnswer')}</Label>
                        <select
                          id="survey-filter-answer"
                          className="select"
                          value={filters.answer}
                          onChange={(event) =>
                            setFilters((prev) => ({ ...prev, answer: event.target.value }))
                          }
                        >
                          <option value="">{t('all')}</option>
                          {answerOptions.map((answer) => (
                            <option key={answer} value={answer}>
                              {answer}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFilters({ q: '', path: '', answer: '' })}
                    >
                      {t('reset')}
                    </Button>
                  </div>

                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('answer')}</th>
                          <th>{t('page')}</th>
                          <th>{t('session')}</th>
                          <th>{t('created')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {responses.length ? (
                          responses.map((response) => (
                            <tr key={response.id}>
                              <td>{response.answer}</td>
                              <td className="text-muted">{response.urlPath ?? '-'}</td>
                              <td>
                                {response.sessionId ? (
                                  <Link
                                    to={`/websites/${websiteId}/sessions/${response.sessionId}`}
                                    className="inline-link"
                                  >
                                    {response.sessionId.slice(0, 8)}
                                    <ExternalLink size={12} strokeWidth={2} aria-hidden />
                                  </Link>
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                              <td className="text-muted">{formatDateTime(response.createdAt)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="text-muted">
                              {responsesQuery.isLoading ? t('loading') : t('surveyNoResponses')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </MasterDetailPane>
              ) : null
            }
          />
        ) : (
          <EmptyState title={t('surveysEmptyTitle')} description={t('surveysEmptyBody')} />
        )}
      </section>

      {editingSurvey ? (
        <SurveyEditDialog
          survey={editingSurvey}
          saving={updateMutation.isPending}
          error={updateMutation.error as Error | null}
          onClose={() => setEditingSurvey(null)}
          onSave={(survey, patch) => updateMutation.mutate({ id: survey.id, patch })}
        />
      ) : null}
      </PageBody>
    </Page>
  );
}
