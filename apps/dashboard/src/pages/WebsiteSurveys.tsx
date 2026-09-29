import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, MessageSquareText, Plus } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import {
  hostedSurveyUrl,
  questionTypeLabel,
  SurveyBuilderDialog,
  type SurveyBody,
  type SurveyTemplateKey,
} from '../components/surveys/SurveyBuilderDialog';
import { SurveyResults } from '../components/surveys/SurveyResults';
import { api, type Survey } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { formatDateTime, formatNumber } from '../lib/format';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';

const TEMPLATES: SurveyTemplateKey[] = ['blank', 'nps', 'csat', 'feedback'];

type BuilderState = { survey: Survey | null; template: SurveyTemplateKey } | null;

function surveyStatus(survey: Survey, now: number) {
  if (!survey.enabled) return t('disabled');
  if (survey.startsAt != null && now < survey.startsAt) return t('surveyStatusScheduled');
  if (survey.endsAt != null && now >= survey.endsAt) return t('surveyStatusEnded');
  if (survey.responseLimit != null && (survey.summary?.responses ?? 0) >= survey.responseLimit) {
    return t('surveyStatusLimitReached');
  }
  return t('enabled');
}

function SurveyOverview({ survey }: { survey: Survey }) {
  const hostedUrl = survey.hostedEnabled ? hostedSurveyUrl(survey) : '';
  const facts: Array<[string, string]> = [
    [t('surveyQuestions'), survey.questions.map((question) => questionTypeLabel(question.type)).join(' → ')],
  ];
  if (survey.triggerPath) facts.push([t('surveyTriggerPath'), survey.triggerPath]);
  if (survey.triggerEvent) facts.push([t('surveyTriggerEvent'), survey.triggerEvent]);
  if (survey.displayDelaySeconds) facts.push([t('surveyDisplayDelay'), `${survey.displayDelaySeconds}s`]);
  if (survey.displayRules?.length) facts.push([t('surveyDisplayRules'), String(survey.displayRules.length)]);
  if (survey.sampleRate < 100) facts.push([t('surveySampleRate'), `${survey.sampleRate}%`]);
  facts.push([
    t('surveyFrequency'),
    survey.repeatIntervalDays
      ? t('surveyRepeatEvery').replace('{days}', String(survey.repeatIntervalDays))
      : t('surveyFrequencyOnce'),
  ]);
  if (survey.responseLimit != null) facts.push([t('surveyResponseLimit'), formatNumber(survey.responseLimit)]);
  if (survey.startsAt != null) facts.push([t('surveyStartsAt'), formatDateTime(survey.startsAt)]);
  if (survey.endsAt != null) facts.push([t('surveyEndsAt'), formatDateTime(survey.endsAt)]);
  return (
    <>
      <dl className="survey-overview">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {hostedUrl ? (
        <p className="survey-hosted-link">
          <span className="text-muted">{t('surveyHostedLink')}</span>
          <a className="inline-link mono" href={hostedUrl} target="_blank" rel="noopener noreferrer">
            {hostedUrl}
            <ExternalLink size={12} strokeWidth={2} aria-hidden />
          </a>
        </p>
      ) : null}
    </>
  );
}

export default function WebsiteSurveysPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId, 'surveys');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [builder, setBuilder] = useState<BuilderState>(null);
  const now = useMemo(() => Date.now(), []);

  const surveysQuery = useQuery({
    queryKey: ['surveys', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Survey[]>(`/api/websites/${websiteId}/surveys`),
  });
  const surveys = useMemo(() => surveysQuery.data ?? [], [surveysQuery.data]);
  const { selectedId: selectedSurveyId, setSelectedId: setSelectedSurveyId, selectedItem: selectedSurvey } =
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
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('survey', nextSurveyId);
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, selectedSurveyId, setSearchParams, setSelectedSurveyId, surveys]);

  function selectSurvey(id: string) {
    setSelectedSurveyId(id);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('survey', id);
      return next;
    });
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['surveys', websiteId] });
    queryClient.invalidateQueries({ queryKey: ['survey-responses', websiteId] });
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: Partial<SurveyBody> }) =>
      api<Survey>(id ? `/api/websites/${websiteId}/surveys/${id}` : `/api/websites/${websiteId}/surveys`, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (survey) => {
      setBuilder(null);
      invalidate();
      selectSurvey(survey.id);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (survey: Survey) =>
      api<Survey>(`/api/websites/${websiteId}/surveys/${survey.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !survey.enabled }),
      }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/surveys/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <Page className="page-surveys">
      <PageHeader
        title={t('surveys')}
        lead={t('surveysLead')}
        actions={
          canEdit ? (
            <Button type="button" variant="primary" onClick={() => setBuilder({ survey: null, template: 'blank' })}>
              <Plus size={14} strokeWidth={2} aria-hidden />
              {t('createSurvey')}
            </Button>
          ) : null
        }
      />

      <PageBody>
        {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

        {canEdit ? (
          <section className="panel section-gap survey-templates">
            <div>
              <h2 className="section-title experiment-title">{t('surveyStartFrom')}</h2>
              <p className="text-muted">{t('surveyStartFromLead')}</p>
            </div>
            <div className="survey-template-list">
              {TEMPLATES.map((template) => (
                <button
                  key={template}
                  type="button"
                  className="survey-template-card"
                  onClick={() => setBuilder({ survey: null, template })}
                >
                  <strong>{t(`surveyTemplateTitle_${template}`)}</strong>
                  <span className="text-muted">{t(`surveyTemplateBody_${template}`)}</span>
                </button>
              ))}
            </div>
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
                  onSelect={() => selectSurvey(survey.id)}
                  icon={<MessageSquareText size={16} strokeWidth={2} aria-hidden />}
                  title={survey.name}
                  subtitle={
                    survey.questions.length > 1
                      ? t('surveyQuestionCount').replace('{count}', String(survey.questions.length))
                      : survey.question
                  }
                  meta={
                    <>
                      <span className="badge">{surveyStatus(survey, now)}</span>
                      {survey.hostedEnabled ? <span className="badge">{t('surveySourceHosted')}</span> : null}
                      <span className="text-muted">
                        {formatNumber(survey.summary?.responses ?? 0)} {t('surveyResponses')}
                      </span>
                    </>
                  }
                />
              ))}
              detail={
                selectedSurvey && websiteId ? (
                  <MasterDetailPane
                    title={selectedSurvey.name}
                    description={<SurveyOverview survey={selectedSurvey} />}
                    actions={
                      canEdit ? (
                        <div className="cohorts-row-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={toggleMutation.isPending}
                            onClick={() => toggleMutation.mutate(selectedSurvey)}
                          >
                            {selectedSurvey.enabled ? t('disable') : t('enable')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setBuilder({ survey: selectedSurvey, template: 'blank' })}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="sm"
                            onClick={() =>
                              confirm({
                                title: deleteTitle(selectedSurvey.name),
                                description: t('surveyDeleteHint'),
                                onConfirm: () => deleteMutation.mutate(selectedSurvey.id),
                              })
                            }
                          >
                            {t('delete')}
                          </Button>
                        </div>
                      ) : null
                    }
                  >
                    <SurveyResults websiteId={websiteId} survey={selectedSurvey} />
                  </MasterDetailPane>
                ) : null
              }
            />
          ) : (
            <EmptyState title={t('surveysEmptyTitle')} description={t('surveysEmptyBody')} />
          )}
        </section>

        {builder ? (
          <SurveyBuilderDialog
            survey={builder.survey}
            template={builder.template}
            saving={saveMutation.isPending}
            error={saveMutation.error as Error | null}
            onClose={() => {
              saveMutation.reset();
              setBuilder(null);
            }}
            onSave={(body) => saveMutation.mutate({ id: builder.survey?.id ?? null, body })}
          />
        ) : null}
      </PageBody>
    </Page>
  );
}
