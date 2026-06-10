import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateRangePicker } from './DateRangePicker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { api } from '../lib/api';
import { type DateRangePreset, presetToRange } from '../lib/dateRange';
import { t } from '../lib/i18n';

type CohortCondition = {
  field: 'event_name' | 'url_path';
  operator: 'equals' | 'contains';
  value: string;
};

type CohortRow = {
  id: string;
  name: string;
  definition: {
    conditions: CohortCondition[];
    windowStart?: number;
    windowEnd?: number;
  };
};

function defaultWindow() {
  return { preset: '30d' as DateRangePreset, ...presetToRange('30d') };
}

export function CohortFormDialog({
  open,
  onClose,
  websiteId,
  cohortId,
}: {
  open: boolean;
  onClose: () => void;
  websiteId: string;
  cohortId?: string;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(cohortId);
  const [name, setName] = useState('');
  const [conditions, setConditions] = useState<CohortCondition[]>([
    { field: 'event_name', operator: 'equals', value: '' },
  ]);
  const [dateWindow, setDateWindow] = useState(defaultWindow);

  const cohortQuery = useQuery({
    queryKey: ['cohort', websiteId, cohortId],
    enabled: open && Boolean(cohortId),
    queryFn: () => api<CohortRow>(`/api/websites/${websiteId}/cohorts/${cohortId}`),
  });

  useEffect(() => {
    if (!open) return;
    if (cohortQuery.data) {
      const row = cohortQuery.data;
      setName(row.name);
      setConditions(
        row.definition.conditions.length
          ? row.definition.conditions
          : [{ field: 'event_name', operator: 'equals', value: '' }],
      );
      if (row.definition.windowStart != null && row.definition.windowEnd != null) {
        setDateWindow({
          preset: 'custom' as DateRangePreset,
          startAt: row.definition.windowStart,
          endAt: row.definition.windowEnd,
        });
      } else {
        setDateWindow(defaultWindow());
      }
      return;
    }
    if (!isEdit) {
      setName('');
      setConditions([{ field: 'event_name', operator: 'equals', value: '' }]);
      setDateWindow(defaultWindow());
    }
  }, [open, cohortQuery.data, isEdit]);

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
      const definition = {
        conditions: conditions.filter((c) => c.value.trim()),
        windowStart: dateWindow.startAt,
        windowEnd: dateWindow.endAt,
      };
      if (isEdit && cohortId) {
        return api(`/api/websites/${websiteId}/cohorts/${cohortId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, definition }),
        });
      }
      return api(`/api/websites/${websiteId}/cohorts`, {
        method: 'POST',
        body: JSON.stringify({ name, definition }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cohorts', websiteId] });
      if (cohortId) {
        queryClient.invalidateQueries({ queryKey: ['cohort', websiteId, cohortId] });
      }
      onClose();
    },
  });

  if (!open) return null;

  const canSave = name.trim() && conditions.some((c) => c.value.trim()) && !saveMutation.isPending;

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-panel cohort-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? t('cohortEdit') : t('createCohort')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{isEdit ? t('cohortEdit') : t('createCohort')}</h2>
        </header>

        {isEdit && cohortQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : (
          <div className="dialog-body">
            <div className="field">
              <Label htmlFor="cohort-dialog-name">{t('name')}</Label>
              <Input
                id="cohort-dialog-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="field">
              <Label>{t('cohortAction')}</Label>
              <div className="cohort-action-row">
                <select
                  className="select"
                  value={conditions[0]?.field ?? 'event_name'}
                  onChange={(e) => {
                    const next = [...conditions];
                    next[0] = {
                      ...next[0]!,
                      field: e.target.value as CohortCondition['field'],
                    };
                    setConditions(next);
                  }}
                >
                  <option value="event_name">{t('cohortEvent')}</option>
                  <option value="url_path">{t('cohortPath')}</option>
                </select>
                <Input
                  value={conditions[0]?.value ?? ''}
                  onChange={(e) => {
                    const next = [...conditions];
                    next[0] = { ...next[0]!, value: e.target.value };
                    setConditions(next);
                  }}
                  placeholder={
                    conditions[0]?.field === 'event_name' ? 'signup' : '/pricing'
                  }
                />
              </div>
            </div>

            <div className="field">
              <Label>{t('cohortDateWindow')}</Label>
              <DateRangePicker value={dateWindow} onChange={setDateWindow} />
            </div>

            {conditions.length > 1 ? (
              <div className="field">
                <Label>{t('cohortConditions')}</Label>
                {conditions.slice(1).map((cond, idx) => {
                  const realIdx = idx + 1;
                  return (
                    <div key={realIdx} className="cohort-condition-row">
                      <select
                        className="select"
                        value={cond.field}
                        onChange={(e) => {
                          const next = [...conditions];
                          next[realIdx] = {
                            ...cond,
                            field: e.target.value as CohortCondition['field'],
                          };
                          setConditions(next);
                        }}
                      >
                        <option value="event_name">{t('cohortEvent')}</option>
                        <option value="url_path">{t('cohortPath')}</option>
                      </select>
                      <select
                        className="select"
                        value={cond.operator}
                        onChange={(e) => {
                          const next = [...conditions];
                          next[realIdx] = {
                            ...cond,
                            operator: e.target.value as CohortCondition['operator'],
                          };
                          setConditions(next);
                        }}
                      >
                        <option value="equals">{t('cohortEquals')}</option>
                        <option value="contains">{t('cohortContains')}</option>
                      </select>
                      <Input
                        value={cond.value}
                        onChange={(e) => {
                          const next = [...conditions];
                          next[realIdx] = { ...cond, value: e.target.value };
                          setConditions(next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConditions(conditions.filter((_, i) => i !== realIdx))}
                      >
                        {t('cohortRemoveCondition')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setConditions([
                  ...conditions,
                  { field: 'event_name', operator: 'equals', value: '' },
                ])
              }
            >
              {t('cohortAddCondition')}
            </Button>
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
