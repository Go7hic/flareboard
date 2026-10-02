import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { DateRangePicker } from './DateRangePicker';
import { PropertyFilterBuilder } from './PropertyFilterBuilder';
import { ModalDialog } from './ModalDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { api, type Website } from '../lib/api';
import { type DateRangePreset, presetToRange } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { completeFilters } from '../lib/websiteReportApi';

type CohortCondition = {
  field: 'event_name' | 'url_path' | 'any_event';
  operator: 'equals' | 'contains';
  value: string;
  /** Property filters the matching events must also satisfy. */
  filters?: PropertyFilter[];
};

function conditionReady(condition: CohortCondition) {
  return condition.field === 'any_event'
    ? completeFilters(condition.filters ?? []).length > 0
    : Boolean(condition.value.trim());
}

type CohortRow = {
  id: string;
  name: string;
  definition: {
    conditions: CohortCondition[];
    windowStart?: number;
    windowEnd?: number;
  };
};

function defaultWindow(timezone = 'UTC') {
  return { preset: '30d' as DateRangePreset, ...presetToRange('30d', undefined, undefined, timezone) };
}

const EMPTY_CONDITION: CohortCondition = { field: 'event_name', operator: 'equals', value: '' };

/** Create or edit a cohort: a primary action with property filters, extra conditions, a window. */
export function CohortFormDialog({
  open,
  onClose,
  websiteId,
  cohortId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  websiteId: string;
  cohortId?: string;
  /** Called with the saved cohort's id (select it in the list). */
  onSaved?: (id: string | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(cohortId);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
    staleTime: 60_000,
  });
  const timezone = websiteQuery.data?.timezone ?? 'UTC';

  const [name, setName] = useState('');
  const [conditions, setConditions] = useState<CohortCondition[]>([EMPTY_CONDITION]);
  const [dateWindow, setDateWindow] = useState(() => defaultWindow());

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
      setConditions(row.definition.conditions.length ? row.definition.conditions : [EMPTY_CONDITION]);
      if (row.definition.windowStart != null && row.definition.windowEnd != null) {
        setDateWindow({
          preset: 'custom' as DateRangePreset,
          startAt: row.definition.windowStart,
          endAt: row.definition.windowEnd,
        });
      } else {
        setDateWindow(defaultWindow(timezone));
      }
      return;
    }
    if (!isEdit) {
      setName('');
      setConditions([EMPTY_CONDITION]);
      setDateWindow(defaultWindow(timezone));
    }
  }, [open, cohortQuery.data, isEdit, timezone]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const definition = {
        conditions: conditions.filter(conditionReady).map((c) => {
          const filters = completeFilters(c.filters ?? []);
          return { ...c, filters: filters.length ? filters : undefined };
        }),
        windowStart: dateWindow.startAt,
        windowEnd: dateWindow.endAt,
      };
      if (isEdit && cohortId) {
        return api<{ id?: string }>(`/api/websites/${websiteId}/cohorts/${cohortId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, definition }),
        });
      }
      return api<{ id?: string }>(`/api/websites/${websiteId}/cohorts`, {
        method: 'POST',
        body: JSON.stringify({ name, definition }),
      });
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['cohorts', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['cohort-report'] });
      if (cohortId) {
        queryClient.invalidateQueries({ queryKey: ['cohort', websiteId, cohortId] });
      }
      onSaved?.(saved?.id ?? cohortId);
      onClose();
    },
  });

  if (!open) return null;

  const canSave = name.trim() && conditions.some(conditionReady) && !saveMutation.isPending;
  const primary = conditions[0] ?? EMPTY_CONDITION;

  function update(index: number, next: Partial<CohortCondition>) {
    setConditions((current) => current.map((cond, i) => (i === index ? { ...cond, ...next } : cond)));
  }

  return (
    <ModalDialog className="cohort-dialog" aria-label={isEdit ? t('cohortEdit') : t('createCohort')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{isEdit ? t('cohortEdit') : t('createCohort')}</h2>
        <p className="dialog-description">{t('audienceCohortDialogLead')}</p>
      </header>

      {isEdit && cohortQuery.isLoading ? (
        <div className="dialog-body" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <form
          className="dialog-body"
          id="cohort-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) saveMutation.mutate();
          }}
        >
          <div className="field">
            <Label htmlFor="cohort-dialog-name">{t('name')}</Label>
            <Input
              id="cohort-dialog-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('audienceCohortNamePlaceholder')}
              autoFocus
            />
          </div>

          <fieldset className="field audience-fieldset">
            <legend className="audience-legend">{t('cohortConditions')}</legend>
            <div className="audience-condition-editor">
              <div className="audience-condition-edit-row">
                <select
                  className="select"
                  aria-label={t('audienceConditionField')}
                  value={primary.field}
                  onChange={(e) => update(0, { field: e.target.value as CohortCondition['field'] })}
                >
                  <option value="event_name">{t('cohortEvent')}</option>
                  <option value="url_path">{t('cohortPath')}</option>
                  <option value="any_event">{t('cohortAnyEvent')}</option>
                </select>
                {primary.field === 'any_event' ? (
                  <span className="audience-condition-hint">{t('audienceAnyEventHint')}</span>
                ) : (
                  <>
                    <select
                      className="select"
                      aria-label={t('audienceConditionOperator')}
                      value={primary.operator}
                      onChange={(e) => update(0, { operator: e.target.value as CohortCondition['operator'] })}
                    >
                      <option value="equals">{t('cohortEquals')}</option>
                      <option value="contains">{t('cohortContains')}</option>
                    </select>
                    <Input
                      aria-label={t('audienceConditionValue')}
                      value={primary.value}
                      onChange={(e) => update(0, { value: e.target.value })}
                      placeholder={primary.field === 'event_name' ? 'signup' : '/pricing'}
                    />
                  </>
                )}
                <span aria-hidden />
              </div>
              <div className="audience-condition-filters">
                <PropertyFilterBuilder
                  websiteId={websiteId}
                  value={primary.filters ?? []}
                  onChange={(filters) => update(0, { filters })}
                  addLabel={t('cohortAddPropertyFilter')}
                />
              </div>

              {conditions.slice(1).map((cond, idx) => {
                const index = idx + 1;
                return (
                  <div key={index} className="audience-condition-edit-row">
                    <select
                      className="select"
                      aria-label={t('audienceConditionField')}
                      value={cond.field}
                      onChange={(e) => update(index, { field: e.target.value as CohortCondition['field'] })}
                    >
                      <option value="event_name">{t('cohortEvent')}</option>
                      <option value="url_path">{t('cohortPath')}</option>
                    </select>
                    <select
                      className="select"
                      aria-label={t('audienceConditionOperator')}
                      value={cond.operator}
                      onChange={(e) => update(index, { operator: e.target.value as CohortCondition['operator'] })}
                    >
                      <option value="equals">{t('cohortEquals')}</option>
                      <option value="contains">{t('cohortContains')}</option>
                    </select>
                    <Input
                      aria-label={t('audienceConditionValue')}
                      value={cond.value}
                      onChange={(e) => update(index, { value: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('cohortRemoveCondition')}
                      title={t('cohortRemoveCondition')}
                      onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setConditions([...conditions, EMPTY_CONDITION])}
            >
              <Plus data-icon="inline-start" aria-hidden />
              {t('cohortAddCondition')}
            </Button>
          </fieldset>

          <fieldset className="field audience-fieldset">
            <legend className="audience-legend">{t('cohortDateWindow')}</legend>
            <p className="audience-field-hint">{t('audienceCohortWindowHint')}</p>
            <DateRangePicker value={dateWindow} onChange={setDateWindow} timezone={timezone} />
          </fieldset>

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
        <Button type="submit" form="cohort-form" variant="primary" disabled={!canSave}>
          {t('save')}
        </Button>
      </footer>
    </ModalDialog>
  );
}
