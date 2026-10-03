import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { Copy, ExternalLink, MessageSquareText, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KvList, type KvItem } from '../components/KvList';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { countMeta, tf } from '../components/product/format';
import { ProductListHeader, ProductMasterDetailSkeleton, ProductNoMatches } from '../components/product/ProductList';
import { ProductSection } from '../components/product/ProductSection';
import { ShortDate } from '../components/product/ProductTime';
import { surveyKind, surveyKindLabel, surveyStatus } from '../components/product/status';
import { StatusBadge } from '../components/StatusBadge';
import {
  hostedSurveyUrl,
  questionTypeLabel,
  SurveyBuilderDialog,
  type SurveyBody,
} from '../components/surveys/SurveyBuilderDialog';
import { SurveyResults } from '../components/surveys/SurveyResults';
import { Button } from '../components/ui/button';
import { api, type Survey } from '../lib/api';
import { formatNumber } from '../lib/format';
import { pluralKey, t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

/** "NPS · 3 questions" */
function surveySubtitle(survey: Survey) {
  const kind = surveyKindLabel(surveyKind(survey.questions));
  return survey.questions.length > 1
    ? `${kind} · ${t('surveyQuestionCount').replace('{count}', String(survey.questions.length))}`
    : kind;
}

/** List subtitle: the survey type as a chip, then the question count. */
function SurveyListSubtitle({ survey }: { survey: Survey }) {
  return (
    <>
      <span className="product-type-chip">{surveyKindLabel(surveyKind(survey.questions))}</span>
      {survey.questions.length > 1 ? t('surveyQuestionCount').replace('{count}', String(survey.questions.length)) : null}
    </>
  );
}

function HostedLink({ survey }: { survey: Survey }) {
  const [copied, setCopied] = useState(false);
  const url = hostedSurveyUrl(survey);
  if (!url) return null;
  return (
    <span className="product-copy-row">
      <a className="product-id-link mono product-copy-value" href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t('copyToClipboard')}
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Copy size={14} strokeWidth={2} aria-hidden />
      </Button>
      {copied ? <span className="product-copy-done">{t('copied')}</span> : null}
    </span>
  );
}

/** Setup tab: where and how often the survey shows, as label / value rows. */
function SurveySetup({ survey }: { survey: Survey }) {
  const items: KvItem[] = [
    {
      key: 'questions',
      label: t('surveyQuestions'),
      value: survey.questions.map((question) => questionTypeLabel(question.type)).join(' → '),
    },
    {
      key: 'trigger-path',
      label: t('surveyTriggerPath'),
      value: survey.triggerPath ? <span className="mono">{survey.triggerPath}</span> : t('productSurveyAnyPage'),
    },
    {
      key: 'trigger-event',
      label: t('surveyTriggerEvent'),
      value: survey.triggerEvent ? <span className="mono">{survey.triggerEvent}</span> : t('productSurveyOnPageView'),
    },
    {
      key: 'delay',
      label: t('productSurveyDelay'),
      value: survey.displayDelaySeconds
        ? tf('productSeconds', { count: formatNumber(survey.displayDelaySeconds) })
        : t('productSurveyNoDelay'),
    },
    {
      key: 'rules',
      label: t('surveyDisplayRules'),
      value: survey.displayRules?.length ? (
        <span className="product-chips">
          {survey.displayRules.map((rule, index) => (
            <span key={index} className="product-chip mono">
              {`${rule.key ? `${rule.field}.${rule.key}` : rule.field} ${rule.operator} ${rule.value}`.trim()}
            </span>
          ))}
        </span>
      ) : (
        t('productNone')
      ),
    },
    { key: 'sample', label: t('surveySampleRate'), value: `${survey.sampleRate}%` },
    {
      key: 'frequency',
      label: t('surveyFrequency'),
      value: survey.repeatIntervalDays
        ? t('surveyRepeatEvery').replace('{days}', String(survey.repeatIntervalDays))
        : t('surveyFrequencyOnce'),
    },
    {
      key: 'limit',
      label: t('surveyResponseLimit'),
      value: survey.responseLimit != null ? formatNumber(survey.responseLimit) : t('surveyNoLimit'),
    },
    {
      key: 'schedule',
      label: t('productSurveySchedule'),
      value:
        survey.startsAt != null || survey.endsAt != null ? (
          <>
            {survey.startsAt != null ? <ShortDate value={survey.startsAt} withTime /> : t('productSurveyNow')}
            {' – '}
            {survey.endsAt != null ? <ShortDate value={survey.endsAt} withTime /> : t('productSurveyNoEnd')}
          </>
        ) : (
          t('productSurveyAlways')
        ),
    },
    {
      key: 'hosted',
      label: t('surveyHostedLink'),
      value: survey.hostedEnabled ? <HostedLink survey={survey} /> : t('productSurveyHostedOff'),
    },
  ];
  return (
    <ProductSection title={t('productSurveySetupTitle')} description={t('surveyTargetingLead')}>
      <KvList items={items} />
    </ProductSection>
  );
}

function SurveyDetail({
  websiteId,
  survey,
  canEdit,
  now,
  toggling,
  error,
  onToggle,
  onEdit,
  onDelete,
}: {
  websiteId: string;
  survey: Survey;
  canEdit: boolean;
  now: number;
  toggling: boolean;
  error: Error | null;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = surveyStatus(survey, now);
  const hostedUrl = survey.hostedEnabled ? hostedSurveyUrl(survey) : '';
  return (
    <MasterDetailPane
      title={survey.name}
      meta={
        <>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <span>{surveySubtitle(survey)}</span>
          {survey.hostedEnabled ? <span>{t('surveySourceHosted')}</span> : null}
          {survey.createdAt ? (
            <span>
              {t('created')} <ShortDate value={survey.createdAt} />
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          {hostedUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              render={<a href={hostedUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink strokeWidth={2} aria-hidden />
              {t('productSurveyOpenHosted')}
            </Button>
          ) : null}
          {canEdit ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onEdit}>
                <Pencil strokeWidth={2} aria-hidden />
                {t('edit')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={toggling} onClick={onToggle}>
                <Power strokeWidth={2} aria-hidden />
                {survey.enabled ? t('disable') : t('enable')}
              </Button>
              <Button type="button" variant="destructive-ghost" size="sm" onClick={onDelete}>
                <Trash2 strokeWidth={2} aria-hidden />
                {t('delete')}
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {error ? (
        <p className="text-danger product-inline-error" role="alert">
          {error.message}
        </p>
      ) : null}
      <SurveyResults websiteId={websiteId} survey={survey} setup={<SurveySetup survey={survey} />} />
    </MasterDetailPane>
  );
}

type BuilderState = { survey: Survey | null } | null;

export default function WebsiteSurveysPage() {
  const confirm = useConfirm();
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'surveys');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [builder, setBuilder] = useState<BuilderState>(null);
  const [search, setSearch] = useState('');
  const now = useMemo(() => Date.now(), []);

  const surveysQuery = useQuery({
    queryKey: ['surveys', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Survey[]>(`/api/websites/${websiteId}/surveys`),
  });
  const surveys = useMemo(() => surveysQuery.data ?? [], [surveysQuery.data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return surveys;
    return surveys.filter(
      (survey) =>
        survey.name.toLowerCase().includes(needle) ||
        survey.questions.some((question) => question.question.toLowerCase().includes(needle)),
    );
  }, [surveys, search]);
  const requestedId = searchParams.get('survey');
  const selected = rows.find((survey) => survey.id === requestedId) ?? rows[0] ?? null;
  const active = surveys.filter((survey) => surveyStatus(survey, now).tone === 'success').length;

  function selectSurvey(id: string, replace = false) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('survey', id);
        return next;
      },
      { replace },
    );
  }

  function invalidate() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['surveys', websiteId] }),
      queryClient.invalidateQueries({ queryKey: ['survey-responses', websiteId] }),
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: Partial<SurveyBody> }) =>
      api<Survey>(id ? `/api/websites/${websiteId}/surveys/${id}` : `/api/websites/${websiteId}/surveys`, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (survey) => {
      setBuilder(null);
      setSearch('');
      void invalidate();
      selectSurvey(survey.id, true);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (survey: Survey) =>
      api<Survey>(`/api/websites/${websiteId}/surveys/${survey.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !survey.enabled }),
      }),
    // Pending until the list has refetched, so the toggle cannot fire twice on stale data.
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/surveys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void invalidate();
    },
  });

  const createButton = canEdit ? (
    <Button
      type="button"
      variant="primary"
      onClick={() => {
        saveMutation.reset();
        setBuilder({ survey: null });
      }}
    >
      <Plus strokeWidth={2} aria-hidden />
      {t('createSurvey')}
    </Button>
  ) : null;

  return (
    <Page className="page-surveys product-page">
      <PageHeader title={t('surveys')} lead={t('surveysLead')} actions={createButton} />

      <PageBody>
        {viewOnly ? <p className="product-view-only">{t('viewOnlyHint')}</p> : null}

        <DataViewState
          loading={surveysQuery.isLoading}
          loadingFallback={<ProductMasterDetailSkeleton rows={3} />}
          error={surveysQuery.isError ? surveysQuery.error : null}
          onRetry={() => surveysQuery.refetch()}
        >
          {surveys.length ? (
            <MasterDetailLayout
              listHeader={
                <ProductListHeader
                  search={search}
                  onSearch={setSearch}
                  placeholder={t('productSurveySearch')}
                  summary={tf(pluralKey('productSurveyListSummary', surveys.length), {
                    count: formatNumber(surveys.length),
                    active: formatNumber(active),
                  })}
                />
              }
              list={
                rows.length ? (
                  rows.map((survey) => {
                    const status = surveyStatus(survey, now);
                    const responses = countMeta(t('productResponsesCount'), survey.summary?.responses ?? 0);
                    return (
                      <MasterDetailListItem
                        key={survey.id}
                        selected={survey.id === selected?.id}
                        onSelect={() => selectSurvey(survey.id)}
                        title={survey.name}
                        subtitle={<SurveyListSubtitle survey={survey} />}
                        meta={
                          <>
                            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                            <span title={responses.title}>{responses.text}</span>
                          </>
                        }
                      />
                    );
                  })
                ) : (
                  <ProductNoMatches query={search} onClear={() => setSearch('')} />
                )
              }
              detail={
                selected && websiteId ? (
                  <SurveyDetail
                    key={selected.id}
                    websiteId={websiteId}
                    survey={selected}
                    canEdit={canEdit}
                    now={now}
                    toggling={toggleMutation.isPending}
                    error={(toggleMutation.error ?? deleteMutation.error) as Error | null}
                    onToggle={() => toggleMutation.mutate(selected)}
                    onEdit={() => {
                      saveMutation.reset();
                      setBuilder({ survey: selected });
                    }}
                    onDelete={() =>
                      confirm({
                        title: deleteTitle(selected.name),
                        description: t('surveyDeleteHint'),
                        onConfirm: () => deleteMutation.mutate(selected.id),
                      })
                    }
                  />
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState icon={<MessageSquareText strokeWidth={2} />} title={t('productSelectSurvey')} />
                  </div>
                )
              }
            />
          ) : (
            <EmptyState
              variant="rich"
              icon={<MessageSquareText strokeWidth={2} />}
              title={t('surveysEmptyTitle')}
              description={t('surveysEmptyBody')}
              action={createButton}
            />
          )}
        </DataViewState>

        {builder ? (
          <SurveyBuilderDialog
            survey={builder.survey}
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
