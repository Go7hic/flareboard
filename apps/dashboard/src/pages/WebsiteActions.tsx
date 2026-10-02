import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { deleteTitle, useConfirm } from '../components/ConfirmDialog';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { MasterDetailLayout, MasterDetailListItem, ResourceSearchField } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { ActionDetail, ruleSummary } from '../components/traffic/ActionDetail';
import { ActionFormDialog } from '../components/traffic/ActionFormDialog';
import { countLabel, formatCount } from '../components/traffic/format';
import { RelativeTime } from '../components/traffic/RelativeTime';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { api, type ActionDefinition, type WebsiteStats } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

/** Show a search box once the list is long enough to need one. */
const SEARCH_THRESHOLD = 8;

type DialogState = { mode: 'create' } | { mode: 'edit'; action: ActionDefinition } | null;

function ListSkeleton() {
  return (
    <div className="master-detail-layout" aria-hidden>
      <div className="master-detail-list">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="traffic-list-skeleton">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
        ))}
      </div>
      <div className="master-detail-pane">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <Skeleton className="mt-6 h-[72px] w-full" />
        <Skeleton className="mt-6 h-[180px] w-full" />
      </div>
    </div>
  );
}

export default function WebsiteActionsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { canEdit, viewOnly } = useWebsitePermissions(websiteId, 'analytics');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '30d');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const selectedId = searchParams.get('action');

  const actionsQuery = useQuery({
    queryKey: ['actions', websiteId, rangeQs],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousData,
    queryFn: () => api<ActionDefinition[]>(`/api/websites/${websiteId}/actions?${rangeQs}`),
  });

  const statsQuery = useQuery({
    queryKey: ['website-stats', websiteId, rangeQs],
    enabled: Boolean(websiteId),
    queryFn: () => api<WebsiteStats>(`/api/websites/${websiteId}/stats?${rangeQs}`),
  });

  const actions = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return actions;
    return actions.filter(
      (action) => action.name.toLowerCase().includes(query) || action.rules.some((rule) => rule.value.toLowerCase().includes(query)),
    );
  }, [actions, search]);
  const selected = visible.find((action) => action.id === selectedId) ?? visible[0] ?? null;

  const select = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('action', id);
          else next.delete('action');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const deleteMutation = useMutation({
    mutationFn: (actionId: string) => api(`/api/websites/${websiteId}/actions/${actionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      select(null);
      queryClient.invalidateQueries({ queryKey: ['actions', websiteId] });
    },
  });

  function requestDelete(action: ActionDefinition) {
    confirm({ title: deleteTitle(action.name), onConfirm: () => deleteMutation.mutate(action.id) });
  }

  const newButton = canEdit ? (
    <Button type="button" variant="primary" onClick={() => setDialog({ mode: 'create' })}>
      <Plus aria-hidden />
      {t('newActionDefinition')}
    </Button>
  ) : null;

  const initialLoading = actionsQuery.isLoading && !actionsQuery.data;

  return (
    <Page className="page-actions">
      <PageHeader
        title={t('actionDefinitions')}
        lead={t('actionDefinitionsLead')}
        meta={viewOnly ? <p className="traffic-view-only">{t('viewOnlyHint')}</p> : undefined}
        actions={
          <>
            <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
            {newButton}
          </>
        }
      />

      <PageBody>
        <DataViewState
          loading={initialLoading}
          error={actionsQuery.isError && !actionsQuery.data ? actionsQuery.error : null}
          onRetry={() => actionsQuery.refetch()}
          loadingFallback={<ListSkeleton />}
        >
          {!actions.length ? (
            <EmptyState
              variant="rich"
              icon={<ListChecks />}
              title={t('actionsEmptyTitle')}
              description={t('actionsEmptyBody')}
              action={newButton}
            />
          ) : (
            <MasterDetailLayout
              listHeader={
                <>
                  {actions.length > SEARCH_THRESHOLD ? (
                    <ResourceSearchField
                      value={search}
                      onChange={setSearch}
                      placeholder={t('trafficSearchActions')}
                      aria-label={t('trafficSearchActions')}
                      className="traffic-list-search"
                    />
                  ) : null}
                  <span className="master-detail-list-count">{countLabel('trafficActionsCount', actions.length)}</span>
                </>
              }
              list={
                visible.length ? (
                  visible.map((action) => (
                    <MasterDetailListItem
                      key={action.id}
                      selected={action.id === selected?.id}
                      onSelect={() => select(action.id)}
                      title={action.name}
                      subtitle={action.rules.map(ruleSummary).join(' · ')}
                      meta={
                        <>
                          <span className="traffic-list-metric" title={formatNumber(action.summary?.events ?? 0)}>
                            {formatCount(action.summary?.events ?? 0)}
                          </span>
                          {action.summary?.lastSeenAt ? <RelativeTime value={action.summary.lastSeenAt} /> : null}
                        </>
                      }
                    />
                  ))
                ) : (
                  <EmptyState
                    icon={<SearchX />}
                    title={t('trafficNoMatchTitle')}
                    description={t('trafficNoMatchBody').replace('{query}', search.trim())}
                  />
                )
              }
              detail={
                selected && websiteId ? (
                  <ActionDetail
                    key={selected.id}
                    websiteId={websiteId}
                    action={selected}
                    startAt={range.startAt}
                    endAt={range.endAt}
                    totalVisits={statsQuery.data?.visits.value}
                    refreshing={actionsQuery.isPlaceholderData}
                    canEdit={canEdit}
                    onEdit={() => setDialog({ mode: 'edit', action: selected })}
                    onDelete={() => requestDelete(selected)}
                  />
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState icon={<ListChecks />} title={t('trafficSelectAction')} />
                  </div>
                )
              }
            />
          )}
        </DataViewState>
      </PageBody>

      {dialog && websiteId ? (
        <ActionFormDialog
          websiteId={websiteId}
          action={dialog.mode === 'edit' ? dialog.action : null}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            select(saved.id);
          }}
        />
      ) : null}
    </Page>
  );
}
