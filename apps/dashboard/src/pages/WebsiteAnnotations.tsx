import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Annotation, type AnnotationsResponse } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

type AnnotationCategory = Annotation['category'];

const CATEGORIES: AnnotationCategory[] = ['note', 'release', 'campaign', 'incident', 'experiment'];

function formatDate(value: string | number | null | undefined) {
  return formatDateTime(value);
}

function toInputDateTime(value: number) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromInputDateTime(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function emptyDraft() {
  return {
    title: '',
    description: '',
    category: 'note' as AnnotationCategory,
    happenedAt: toInputDateTime(Date.now()),
  };
}

function categoryLabel(category: AnnotationCategory) {
  return t(`annotationCategory_${category}`);
}

export default function WebsiteAnnotationsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit } = useWebsitePermissions(websiteId);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);

  const annotationsQuery = useQuery({
    queryKey: ['annotations', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<AnnotationsResponse>(`/api/websites/${websiteId}/annotations`),
  });

  const annotations = annotationsQuery.data?.annotations ?? [];
  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedId) ?? null,
    [annotations, selectedId],
  );

  const saveMutation = useMutation({
    mutationFn: (payload: typeof draft) => {
      const body = JSON.stringify({
        title: payload.title.trim(),
        description: payload.description.trim(),
        category: payload.category,
        happenedAt: fromInputDateTime(payload.happenedAt),
      });
      if (selectedId) {
        return api<Annotation>(`/api/websites/${websiteId}/annotations/${selectedId}`, {
          method: 'PATCH',
          body,
        });
      }
      return api<Annotation>(`/api/websites/${websiteId}/annotations`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: (annotation) => {
      setSelectedId(annotation.id);
      setDraft({
        title: annotation.title,
        description: annotation.description,
        category: annotation.category,
        happenedAt: toInputDateTime(annotation.happenedAt),
      });
      queryClient.invalidateQueries({ queryKey: ['annotations', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (annotationId: string) =>
      api(`/api/websites/${websiteId}/annotations/${annotationId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelectedId(null);
      setDraft(emptyDraft());
      queryClient.invalidateQueries({ queryKey: ['annotations', websiteId] });
    },
  });

  function selectAnnotation(annotation: Annotation) {
    setSelectedId(annotation.id);
    setDraft({
      title: annotation.title,
      description: annotation.description,
      category: annotation.category,
      happenedAt: toInputDateTime(annotation.happenedAt),
    });
  }

  function newAnnotation() {
    setSelectedId(null);
    setDraft(emptyDraft());
  }

  const canSave = Boolean(draft.title.trim() && draft.happenedAt) && !saveMutation.isPending;

  return (
    <Page className="page-annotations">
      <PageHeader title={t('annotations')} lead={t('annotationsLead')} />

      <PageBody>

      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      {canEdit ? (
        <section className="panel section-gap">
          <header className="panel-header">
            <Button type="button" variant="secondary" onClick={newAnnotation}>
              <Plus size={16} strokeWidth={2} aria-hidden />
              {t('newAnnotation')}
            </Button>
          </header>
        </section>
      ) : null}

      <section className="panel section-gap">
        {annotationsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : annotations.length || !selectedId ? (
          <MasterDetailLayout
            list={
              <>
                {annotations.map((annotation) => (
                  <MasterDetailListItem
                    key={annotation.id}
                    selected={annotation.id === selectedAnnotation?.id}
                    onSelect={() => selectAnnotation(annotation)}
                    icon={<CalendarDays size={16} strokeWidth={2} aria-hidden />}
                    title={annotation.title}
                    subtitle={formatDate(annotation.happenedAt)}
                    meta={
                      <span className={`badge annotation-badge-${annotation.category}`}>
                        {categoryLabel(annotation.category)}
                      </span>
                    }
                  />
                ))}
                {!annotations.length ? (
                  <EmptyState title={t('annotationsEmptyTitle')} description={t('annotationsEmptyBody')} />
                ) : null}
              </>
            }
            detail={
              <MasterDetailPane
                title={selectedId ? t('editAnnotation') : t('createAnnotation')}
                description={t('annotationFormLead')}
                actions={
                  canEdit && selectedId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(selectedId)}
                      disabled={deleteMutation.isPending}
                      aria-label={t('delete')}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden />
                    </Button>
                  ) : null
                }
              >
                {canEdit ? (
                  <div className="detail-section">
                    <div className="field">
                      <Label htmlFor="annotation-title">{t('title')}</Label>
                      <Input
                        id="annotation-title"
                        value={draft.title}
                        onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                        placeholder={t('annotationTitlePlaceholder')}
                      />
                    </div>
                    <div className="field">
                      <Label htmlFor="annotation-category">{t('category')}</Label>
                      <select
                        id="annotation-category"
                        className="select"
                        value={draft.category}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, category: event.target.value as AnnotationCategory }))
                        }
                      >
                        {CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {categoryLabel(category)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <Label htmlFor="annotation-time">{t('annotationHappenedAt')}</Label>
                      <Input
                        id="annotation-time"
                        type="datetime-local"
                        value={draft.happenedAt}
                        onChange={(event) => setDraft((prev) => ({ ...prev, happenedAt: event.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <Label htmlFor="annotation-description">{t('description')}</Label>
                      <textarea
                        id="annotation-description"
                        className="textarea"
                        rows={5}
                        value={draft.description}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, description: event.target.value }))
                        }
                      />
                    </div>
                    <div className="form-actions">
                      <Button type="button" variant="primary" onClick={() => saveMutation.mutate(draft)} disabled={!canSave}>
                        {selectedId ? t('saveChanges') : t('createAnnotation')}
                      </Button>
                    </div>
                    {saveMutation.error ? <p className="text-danger">{saveMutation.error.message}</p> : null}
                  </div>
                ) : null}
              </MasterDetailPane>
            }
          />
        ) : (
          <EmptyState title={t('annotationsEmptyTitle')} description={t('annotationsEmptyBody')} />
        )}
      </section>
      </PageBody>
    </Page>
  );
}
