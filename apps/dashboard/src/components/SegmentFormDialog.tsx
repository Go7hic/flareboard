import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { api, type Segment } from '../lib/api';
import { t } from '../lib/i18n';
import {
  conditionsToParams,
  defaultSegmentCondition,
  paramsToConditions,
  SEGMENT_FIELD_OPTIONS,
  type SegmentCondition,
} from '../lib/segment-utils';

export function SegmentFormDialog({
  open,
  onClose,
  websiteId,
  segmentId,
}: {
  open: boolean;
  onClose: () => void;
  websiteId: string;
  segmentId?: string;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(segmentId);
  const [name, setName] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [conditions, setConditions] = useState<SegmentCondition[]>([defaultSegmentCondition()]);

  const paramsPreview = useMemo(() => conditionsToParams(conditions), [conditions]);
  const paramsJson = useMemo(() => JSON.stringify(paramsPreview, null, 2), [paramsPreview]);

  const segmentQuery = useQuery({
    queryKey: ['segment', websiteId, segmentId],
    enabled: open && Boolean(segmentId),
    queryFn: () => api<Segment & { createdAt?: string }>(`/api/websites/${websiteId}/segments/${segmentId}`),
  });

  useEffect(() => {
    if (!open) return;
    if (segmentQuery.data) {
      const row = segmentQuery.data;
      setName(row.name);
      setConditions(paramsToConditions(row.parameters ?? {}));
      return;
    }
    if (!isEdit) {
      setName('');
      setConditions([defaultSegmentCondition()]);
      setShowJson(false);
    }
  }, [open, segmentQuery.data, isEdit]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!Object.keys(paramsPreview).length) {
        throw new Error(t('segmentNoConditions'));
      }
      const body = { name, type: 'filter', parameters: paramsPreview };
      if (isEdit && segmentId) {
        return api(`/api/websites/${websiteId}/segments/${segmentId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      return api(`/api/websites/${websiteId}/segments`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments', websiteId] });
      if (segmentId) {
        queryClient.invalidateQueries({ queryKey: ['segment', websiteId, segmentId] });
      }
      onClose();
    },
  });

  if (!open) return null;

  const canSave =
    name.trim() &&
    Object.keys(paramsPreview).length > 0 &&
    !saveMutation.isPending &&
    !(isEdit && segmentQuery.isLoading);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-panel segment-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? t('segmentEdit') : t('createSegment')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{isEdit ? t('segmentEdit') : t('createSegment')}</h2>
        </header>

        {isEdit && segmentQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : (
          <div className="dialog-body">
            <div className="field">
              <Label htmlFor="segment-dialog-name">{t('name')}</Label>
              <Input
                id="segment-dialog-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="field">
              <Label>{t('segmentConditions')}</Label>
              {conditions.map((cond, idx) => (
                <div key={idx} className="segment-condition-row">
                  <select
                    className="select"
                    value={cond.field}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = { ...cond, field: e.target.value as SegmentCondition['field'] };
                      setConditions(next);
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
                    value={cond.operator}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = {
                        ...cond,
                        operator: e.target.value as SegmentCondition['operator'],
                      };
                      setConditions(next);
                    }}
                    disabled={cond.field !== 'path'}
                  >
                    <option value="equals">{t('cohortEquals')}</option>
                    <option value="contains">{t('cohortContains')}</option>
                  </select>
                  <Input
                    value={cond.value}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = { ...cond, value: e.target.value };
                      setConditions(next);
                    }}
                    placeholder={t('segmentValuePlaceholder')}
                  />
                  {conditions.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}
                    >
                      {t('cohortRemoveCondition')}
                    </Button>
                  ) : null}
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConditions([...conditions, defaultSegmentCondition()])}
              >
                {t('cohortAddCondition')}
              </Button>
            </div>

            <div className="field">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowJson(!showJson)}>
                {showJson ? t('segmentHideAdvanced') : t('segmentShowAdvanced')}
              </Button>
            </div>

            {showJson ? (
              <div className="field">
                <Label>{t('segmentJsonPreview')}</Label>
                <Textarea
                  className="textarea-mono"
                  value={paramsJson}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                      setConditions(paramsToConditions(parsed));
                    } catch {
                      /* ignore while typing */
                    }
                  }}
                />
              </div>
            ) : (
              <pre className="code-block segment-params-preview">{paramsJson}</pre>
            )}

            {saveMutation.error ? (
              <p className="text-danger">{(saveMutation.error as Error).message}</p>
            ) : null}
          </div>
        )}

        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={!canSave} onClick={() => saveMutation.mutate()}>
            {t('save')}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
