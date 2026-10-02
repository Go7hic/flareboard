import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { AnnotationDialog, categoryLabel, type AnnotationCategory } from '../components/audience/AnnotationDialog';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { api, type Annotation, type AnnotationsResponse } from '../lib/api';
import { formatNumber, formatShortDateTime, formatTimeOfDay } from '../lib/format';
import { getLocale, t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { cn } from '../lib/utils';

/** Color only where the category signals something: incidents (bad) and releases. */
const CATEGORY_TONE: Record<AnnotationCategory, StatusTone> = {
  incident: 'danger',
  release: 'info',
  campaign: 'neutral',
  experiment: 'neutral',
  note: 'neutral',
};

type MonthGroup = { key: string; label: string; items: Annotation[] };

/** Newest first, grouped by calendar month in the viewer's zone. */
function groupByMonth(annotations: Annotation[]): MonthGroup[] {
  const sorted = [...annotations].sort((a, b) => b.happenedAt - a.happenedAt);
  const groups: MonthGroup[] = [];
  const formatter = new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'long' });
  for (const annotation of sorted) {
    const date = new Date(annotation.happenedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: formatter.format(date), items: [] };
      groups.push(group);
    }
    group.items.push(annotation);
  }
  return groups;
}

function DayLabel({ value }: { value: number }) {
  const date = new Date(value);
  const day = date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
  const weekday = date.toLocaleDateString(getLocale(), { weekday: 'short' });
  return (
    <span className="audience-annotation-date" title={formatShortDateTime(value)}>
      <span className="audience-annotation-day">{day}</span>
      <span className="audience-annotation-time">
        {weekday} {formatTimeOfDay(value)}
      </span>
    </span>
  );
}

export default function WebsiteAnnotationsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<{ open: boolean; annotation?: Annotation }>({ open: false });

  const annotationsQuery = useQuery({
    queryKey: ['annotations', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<AnnotationsResponse>(`/api/websites/${websiteId}/annotations`),
  });

  const deleteMutation = useMutation({
    mutationFn: (annotationId: string) =>
      api(`/api/websites/${websiteId}/annotations/${annotationId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['annotations', websiteId] }),
  });

  const annotations = annotationsQuery.data?.annotations ?? [];
  const groups = useMemo(() => groupByMonth(annotations), [annotations]);

  function remove(annotation: Annotation) {
    confirm({
      title: deleteTitle(annotation.title),
      onConfirm: () => {
        deleteMutation.mutate(annotation.id);
        setDialog({ open: false });
      },
    });
  }

  const createButton = canEdit ? (
    <Button type="button" variant="primary" onClick={() => setDialog({ open: true })}>
      <Plus data-icon="inline-start" aria-hidden />
      {t('newAnnotation')}
    </Button>
  ) : null;

  return (
    <Page className="page-annotations">
      <PageHeader
        title={t('annotations')}
        lead={t('annotationsLead')}
        actions={createButton}
        meta={viewOnly ? <p className="audience-footnote">{t('viewOnlyHint')}</p> : undefined}
      />

      <PageBody className="stack">
        <DataViewState
          loading={annotationsQuery.isLoading}
          loadingFallback={<TimelineSkeleton />}
          error={annotationsQuery.isError ? annotationsQuery.error : null}
          onRetry={() => annotationsQuery.refetch()}
        >
          {groups.length === 0 ? (
            <EmptyState
              variant="rich"
              icon={<CalendarDays />}
              title={t('annotationsEmptyTitle')}
              description={t('annotationsEmptyBody')}
              action={createButton}
            />
          ) : (
            <>
              <p className="audience-footnote">
                {t('audienceAnnotationsCount').replace('{count}', formatNumber(annotations.length))}
              </p>
              {groups.map((group) => (
                <SectionCard
                  key={group.key}
                  flush
                  className="audience-month"
                  title={group.label}
                  actions={
                    <span className="audience-month-count">
                      {t('audienceAnnotationsInMonth').replace('{count}', formatNumber(group.items.length))}
                    </span>
                  }
                >
                  <ol className="audience-timeline">
                    {group.items.map((annotation) => (
                      <li key={annotation.id} className={cn('audience-annotation', canEdit && 'is-editable')}>
                        <button
                          type="button"
                          className="audience-annotation-main"
                          disabled={!canEdit}
                          aria-label={canEdit ? `${t('editAnnotation')}: ${annotation.title}` : undefined}
                          onClick={() => setDialog({ open: true, annotation })}
                        >
                          <DayLabel value={annotation.happenedAt} />
                          <span className="audience-annotation-category">
                            <StatusBadge tone={CATEGORY_TONE[annotation.category]}>
                              {categoryLabel(annotation.category)}
                            </StatusBadge>
                          </span>
                          <span className="audience-annotation-copy">
                            <span className="audience-annotation-title">{annotation.title}</span>
                            {annotation.description ? (
                              <span className="audience-annotation-desc">{annotation.description}</span>
                            ) : null}
                          </span>
                        </button>
                        {canEdit ? (
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="icon-sm"
                            className="audience-annotation-delete"
                            aria-label={`${t('delete')}: ${annotation.title}`}
                            title={t('delete')}
                            onClick={() => remove(annotation)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </SectionCard>
              ))}
            </>
          )}
        </DataViewState>
      </PageBody>

      {websiteId ? (
        <AnnotationDialog
          open={dialog.open}
          websiteId={websiteId}
          annotation={dialog.annotation}
          onClose={() => setDialog({ open: false })}
          onDelete={remove}
        />
      ) : null}
    </Page>
  );
}

function TimelineSkeleton() {
  return (
    <div className="panel-flush" aria-hidden>
      <div className="card-header">
        <Skeleton className="h-4 w-32" />
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="audience-annotation">
          <div className="audience-annotation-main">
            <div className="audience-annotation-date">
              <Skeleton className="h-3.5 w-14" />
              <Skeleton className="mt-1.5 h-3 w-16" />
            </div>
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-3.5 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}
