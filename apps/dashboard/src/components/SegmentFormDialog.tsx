import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Plus, X } from 'lucide-react';
import { propertyFiltersSchema, type PropertyFilter } from '@flareboard/shared/insight-query';
import { ModalDialog } from './ModalDialog';
import { PropertyFilterBuilder } from './PropertyFilterBuilder';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { Textarea } from './ui/textarea';
import { api, type Segment } from '../lib/api';
import { t } from '../lib/i18n';
import { completeFilters } from '../lib/websiteReportApi';
import {
  conditionsToParams,
  defaultSegmentCondition,
  paramsToConditions,
  SEGMENT_FIELD_OPTIONS,
  type SegmentCondition,
} from '../lib/segment-utils';

/** Property filters saved under `parameters.properties` (invalid entries are dropped). */
function readProperties(params: Record<string, unknown> | null | undefined): PropertyFilter[] {
  const parsed = propertyFiltersSchema.safeParse(params?.properties ?? []);
  return parsed.success ? parsed.data : [];
}

/** Create or edit a segment: conditions (all must match), property filters, raw JSON. */
export function SegmentFormDialog({
  open,
  onClose,
  websiteId,
  segmentId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  websiteId: string;
  segmentId?: string;
  /** Called with the saved segment's id (select it in the list). */
  onSaved?: (id: string | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(segmentId);
  const [name, setName] = useState('');
  const [showJson, setShowJson] = useState(false);
  // The JSON editor keeps its own text so invalid JSON can be typed; valid JSON updates the form.
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState(false);
  const [conditions, setConditions] = useState<SegmentCondition[]>([defaultSegmentCondition()]);
  const [properties, setProperties] = useState<PropertyFilter[]>([]);

  const paramsPreview = useMemo(() => {
    const params = conditionsToParams(conditions);
    const complete = completeFilters(properties);
    return complete.length ? { ...params, properties: complete } : params;
  }, [conditions, properties]);
  const paramsJson = useMemo(() => JSON.stringify(paramsPreview, null, 2), [paramsPreview]);

  const jsonRef = useRef<HTMLTextAreaElement>(null);
  // Edits made with the controls show up in the open JSON editor (unless it is being typed in).
  useEffect(() => {
    if (showJson && document.activeElement !== jsonRef.current) {
      setJsonDraft(paramsJson);
      setJsonError(false);
    }
  }, [paramsJson, showJson]);

  function toggleJson() {
    setJsonDraft(paramsJson);
    setJsonError(false);
    setShowJson((open) => !open);
  }

  function editJson(text: string) {
    setJsonDraft(text);
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      setConditions(paramsToConditions(parsed as Record<string, unknown>));
      setProperties(readProperties(parsed as Record<string, unknown>));
      setJsonError(false);
    } catch {
      setJsonError(true);
    }
  }

  const segmentQuery = useQuery({
    queryKey: ['segment', websiteId, segmentId],
    enabled: open && Boolean(segmentId),
    queryFn: () => api<Segment & { createdAt?: string }>(`/api/websites/${websiteId}/segments/${segmentId}`),
  });

  useEffect(() => {
    if (!open) return;
    setShowJson(false);
    if (segmentQuery.data) {
      const row = segmentQuery.data;
      setName(row.name);
      setConditions(paramsToConditions(row.parameters ?? {}));
      setProperties(readProperties(row.parameters));
      return;
    }
    if (!isEdit) {
      setName('');
      setConditions([defaultSegmentCondition()]);
      setProperties([]);
    }
  }, [open, segmentQuery.data, isEdit]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!Object.keys(paramsPreview).length) {
        throw new Error(t('segmentNoConditions'));
      }
      const body = { name, type: 'filter', parameters: paramsPreview };
      if (isEdit && segmentId) {
        return api<{ id?: string }>(`/api/websites/${websiteId}/segments/${segmentId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      return api<{ id?: string }>(`/api/websites/${websiteId}/segments`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['segments', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['segment-stats', websiteId] });
      if (segmentId) {
        queryClient.invalidateQueries({ queryKey: ['segment', websiteId, segmentId] });
      }
      onSaved?.(saved?.id ?? segmentId);
      onClose();
    },
  });

  if (!open) return null;

  const canSave =
    name.trim() &&
    Object.keys(paramsPreview).length > 0 &&
    !saveMutation.isPending &&
    !(isEdit && segmentQuery.isLoading);

  function updateCondition(index: number, next: Partial<SegmentCondition>) {
    setConditions((current) => current.map((cond, i) => (i === index ? { ...cond, ...next } : cond)));
  }

  return (
    <ModalDialog className="segment-dialog" aria-label={isEdit ? t('segmentEdit') : t('createSegment')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{isEdit ? t('segmentEdit') : t('createSegment')}</h2>
        <p className="dialog-description">{t('audienceSegmentDialogLead')}</p>
      </header>

      {isEdit && segmentQuery.isLoading ? (
        <div className="dialog-body" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <form
          className="dialog-body"
          id="segment-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) saveMutation.mutate();
          }}
        >
          <div className="field">
            <Label htmlFor="segment-dialog-name">{t('name')}</Label>
            <Input
              id="segment-dialog-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('audienceSegmentNamePlaceholder')}
              autoFocus
            />
          </div>

          <fieldset className="field audience-fieldset">
            <legend className="audience-legend">{t('segmentConditions')}</legend>
            <div className="audience-condition-editor">
              {conditions.map((cond, idx) => (
                <div key={idx} className="audience-condition-edit-row">
                  <select
                    className="select"
                    aria-label={t('audienceConditionField')}
                    value={cond.field}
                    onChange={(e) => {
                      const field = e.target.value as SegmentCondition['field'];
                      // Only paths support "contains"; other fields always match exactly.
                      updateCondition(idx, { field, operator: field === 'path' ? cond.operator : 'equals' });
                    }}
                  >
                    {SEGMENT_FIELD_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {t(`segmentField_${f}`)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select"
                    aria-label={t('audienceConditionOperator')}
                    value={cond.operator}
                    onChange={(e) => updateCondition(idx, { operator: e.target.value as SegmentCondition['operator'] })}
                    disabled={cond.field !== 'path'}
                  >
                    <option value="equals">{t('cohortEquals')}</option>
                    <option value="contains">{t('cohortContains')}</option>
                  </select>
                  <Input
                    value={cond.value}
                    aria-label={t('audienceConditionValue')}
                    onChange={(e) => updateCondition(idx, { value: e.target.value })}
                    placeholder={t('segmentValuePlaceholder')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('cohortRemoveCondition')}
                    title={t('cohortRemoveCondition')}
                    disabled={conditions.length <= 1}
                    onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setConditions([...conditions, defaultSegmentCondition()])}
            >
              <Plus data-icon="inline-start" aria-hidden />
              {t('cohortAddCondition')}
            </Button>
          </fieldset>

          <fieldset className="field audience-fieldset">
            <legend className="audience-legend">{t('segmentPropertyFilters')}</legend>
            <PropertyFilterBuilder
              websiteId={websiteId}
              value={properties}
              onChange={setProperties}
              allowedTypes={['event', 'person']}
            />
          </fieldset>

          <div className="audience-json-editor">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              aria-expanded={showJson}
              onClick={toggleJson}
            >
              <Braces data-icon="inline-start" aria-hidden />
              {showJson ? t('segmentHideAdvanced') : t('segmentShowAdvanced')}
            </Button>
            {showJson ? (
              <>
                <Textarea
                  ref={jsonRef}
                  className="textarea-mono"
                  aria-label={t('segmentJsonPreview')}
                  aria-invalid={jsonError || undefined}
                  rows={8}
                  value={jsonDraft}
                  onChange={(e) => editJson(e.target.value)}
                />
                {jsonError ? (
                  <p className="text-danger audience-form-note" role="status">
                    {t('audienceJsonInvalid')}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          {saveMutation.error ? (
            <p className="text-danger audience-form-note" role="alert">
              {(saveMutation.error as Error).message}
            </p>
          ) : null}
        </form>
      )}

      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" form="segment-form" variant="primary" disabled={!canSave}>
          {t('save')}
        </Button>
      </footer>
    </ModalDialog>
  );
}
