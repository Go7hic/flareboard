import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, type Annotation } from '../../lib/api';
import { t } from '../../lib/i18n';
import { ModalDialog } from '../ModalDialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';

export type AnnotationCategory = Annotation['category'];

export const ANNOTATION_CATEGORIES: AnnotationCategory[] = ['note', 'release', 'campaign', 'incident', 'experiment'];

export function categoryLabel(category: AnnotationCategory) {
  return t(`annotationCategory_${category}`);
}

/** `datetime-local` value in the browser's zone. */
function toInputDateTime(value: number) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromInputDateTime(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

type Draft = { title: string; description: string; category: AnnotationCategory; happenedAt: string };

function draftFor(annotation: Annotation | undefined): Draft {
  return annotation
    ? {
        title: annotation.title,
        description: annotation.description,
        category: annotation.category,
        happenedAt: toInputDateTime(annotation.happenedAt),
      }
    : { title: '', description: '', category: 'note', happenedAt: toInputDateTime(Date.now()) };
}

/** Create or edit an annotation; editing also offers delete (confirmed by the caller). */
export function AnnotationDialog({
  open,
  websiteId,
  annotation,
  onClose,
  onDelete,
}: {
  open: boolean;
  websiteId: string;
  /** The annotation being edited; absent to create one. */
  annotation?: Annotation;
  onClose: () => void;
  onDelete?: (annotation: Annotation) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFor(annotation));

  useEffect(() => {
    if (open) setDraft(draftFor(annotation));
  }, [open, annotation]);

  const saveMutation = useMutation({
    mutationFn: (payload: Draft) => {
      const body = JSON.stringify({
        title: payload.title.trim(),
        description: payload.description.trim(),
        category: payload.category,
        happenedAt: fromInputDateTime(payload.happenedAt),
      });
      if (annotation) {
        return api<Annotation>(`/api/websites/${websiteId}/annotations/${annotation.id}`, { method: 'PATCH', body });
      }
      return api<Annotation>(`/api/websites/${websiteId}/annotations`, { method: 'POST', body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annotations', websiteId] });
      onClose();
    },
  });

  if (!open) return null;

  const canSave = Boolean(draft.title.trim() && draft.happenedAt) && !saveMutation.isPending;
  const title = annotation ? t('editAnnotation') : t('createAnnotation');

  return (
    <ModalDialog className="audience-dialog" aria-label={title} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{title}</h2>
        <p className="dialog-description">{t('annotationFormLead')}</p>
      </header>

      <form
        id="annotation-form"
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) saveMutation.mutate(draft);
        }}
      >
        <div className="field">
          <Label htmlFor="annotation-title">{t('title')}</Label>
          <Input
            id="annotation-title"
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            placeholder={t('annotationTitlePlaceholder')}
            autoFocus
          />
        </div>
        <div className="audience-form-grid">
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
              {ANNOTATION_CATEGORIES.map((category) => (
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
        </div>
        <div className="field">
          <Label htmlFor="annotation-description">{t('description')}</Label>
          <Textarea
            id="annotation-description"
            rows={4}
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
        {saveMutation.error ? (
          <p className="text-danger audience-form-note" role="alert">
            {saveMutation.error.message}
          </p>
        ) : null}
      </form>

      <footer className="dialog-footer">
        {annotation && onDelete ? (
          <>
            <Button
              type="button"
              variant="destructive-ghost"
              onClick={() => onDelete(annotation)}
              disabled={saveMutation.isPending}
            >
              <Trash2 data-icon="inline-start" aria-hidden />
              {t('delete')}
            </Button>
            <span className="toolbar-spacer" />
          </>
        ) : null}
        <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" form="annotation-form" variant="primary" disabled={!canSave}>
          {annotation ? t('saveChanges') : t('createAnnotation')}
        </Button>
      </footer>
    </ModalDialog>
  );
}
