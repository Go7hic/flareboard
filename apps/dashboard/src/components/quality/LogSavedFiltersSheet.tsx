import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark } from 'lucide-react';
import { deleteTitle, useConfirm } from '../ConfirmDialog';
import { EmptyState } from '../EmptyState';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { describeSavedFilter, filtersToSaved, hasLogFilters, type LogFilterState } from '../logs/log-filters';
import { api, type LogSavedFilter } from '../../lib/api';
import { t } from '../../lib/i18n';
import { SideSheet } from './SideSheet';

/** Saved log filters: save the current filters under a name, apply or delete saved ones. */
export function LogSavedFiltersSheet({
  websiteId,
  canEdit,
  filters,
  open,
  onOpenChange,
  onApply,
}: {
  websiteId: string;
  canEdit: boolean;
  filters: LogFilterState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (saved: LogSavedFilter['filters']) => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const filtered = hasLogFilters(filters);

  const query = useQuery({
    queryKey: ['log-filters', websiteId],
    enabled: open && Boolean(websiteId),
    queryFn: () => api<{ filters: LogSavedFilter[] }>(`/api/websites/${websiteId}/logs/filters`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<LogSavedFilter>(`/api/websites/${websiteId}/logs/filters`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), filters: filtersToSaved(filters) }),
      }),
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['log-filters', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/logs/filters/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['log-filters', websiteId] }),
  });

  const saved = query.data?.filters ?? [];

  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title={t('logsSavedFilters')} description={t('logsSavedFiltersLead')}>
      {canEdit ? (
        <form
          className="q-form q-save-filter"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && filtered) createMutation.mutate();
          }}
        >
          <div className="q-field">
            <Label htmlFor="log-filter-name">{t('qualitySaveCurrentFilters')}</Label>
            <div className="q-inline-form">
              <Input
                id="log-filter-name"
                value={name}
                placeholder={t('name')}
                disabled={!filtered}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" variant="primary" disabled={!name.trim() || !filtered || createMutation.isPending}>
                {createMutation.isPending ? t('saving') : t('saveFilter')}
              </Button>
            </div>
            <p className="q-field-hint">
              {filtered ? <span className="mono">{describeSavedFilter(filtersToSaved(filters))}</span> : t('logsSaveFilterHint')}
            </p>
            {createMutation.error ? (
              <p className="q-form-error" role="alert">
                {(createMutation.error as Error).message}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      {query.isLoading ? (
        <div className="q-list" aria-hidden>
          {[0, 1].map((index) => (
            <div key={index} className="q-list-row">
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : saved.length ? (
        <ul className="q-list">
          {saved.map((filter) => (
            <li key={filter.id} className="q-list-row">
              <div className="q-list-main">
                <span className="q-list-title">{filter.name}</span>
                <span className="mono q-list-mono" title={describeSavedFilter(filter.filters)}>
                  {describeSavedFilter(filter.filters)}
                </span>
              </div>
              <div className="q-list-actions">
                <Button type="button" variant="outline" size="sm" onClick={() => onApply(filter.filters)}>
                  {t('applyFilter')}
                </Button>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    size="sm"
                    onClick={() => confirm({ title: deleteTitle(filter.name), onConfirm: () => deleteMutation.mutate(filter.id) })}
                  >
                    {t('delete')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Bookmark />} title={t('noSavedFilters')} description={t('logsSaveFilterHint')} />
      )}
    </SideSheet>
  );
}
