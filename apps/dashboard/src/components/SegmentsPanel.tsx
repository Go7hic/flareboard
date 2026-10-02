import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Braces, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { RelativeTime } from './audience/ActivityLists';
import { DetailSection } from './audience/DetailSheet';
import { ConditionList, conditionSummary, segmentConditionRows } from './audience/ConditionChips';
import { MasterDetailSkeleton } from './audience/MasterDetailSkeleton';
import { useConfirm, deleteTitle } from './ConfirmDialog';
import { DataViewState } from './DataViewState';
import { DateRangePicker } from './DateRangePicker';
import { EmptyState } from './EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from './KpiStrip';
import { MasterDetailLayout, MasterDetailListItem, MasterDetailPane, ResourceSearchField } from './master-detail';
import { PageBody } from './Page';
import { PageHeader } from './PageHeader';
import { SegmentFormDialog } from './SegmentFormDialog';
import { StatChangeDelta } from './StatChangeDelta';
import { Button } from './ui/button';
import { api, type Segment, type WebsiteStats } from '../lib/api';
import { formatNumber, formatPercent, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

type SegmentRow = Segment & { createdAt?: string; updatedAt?: string };

/** Bounce rate and its change from the counts (the raw bounce total means little alone). */
function bounceRate(stats: WebsiteStats) {
  const visits = stats.visits.value;
  const rate = visits > 0 ? (stats.bounces.value / visits) * 100 : 0;
  const factor = (change: number | undefined) => (change === undefined ? undefined : 1 + change / 100);
  const prevVisits = factor(stats.visits.change);
  const prevBounces = factor(stats.bounces.change);
  let change: number | undefined;
  if (prevVisits && prevBounces && visits > 0) {
    const previous = ((stats.bounces.value / prevBounces) / (visits / prevVisits)) * 100;
    change = previous > 0 ? ((rate - previous) / previous) * 100 : undefined;
  }
  return { rate, change };
}

function SegmentTraffic({ websiteId, segmentId, rangeQs }: { websiteId: string; segmentId: string; rangeQs: string }) {
  const statsQuery = useQuery({
    queryKey: ['segment-stats', websiteId, segmentId, rangeQs],
    // A new date range keeps this segment's numbers until the new ones land (not another segment's).
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === segmentId ? previous : undefined),
    queryFn: () =>
      api<WebsiteStats>(`/api/websites/${websiteId}/stats?${rangeQs}&segmentId=${encodeURIComponent(segmentId)}`),
  });
  const stats = statsQuery.data;
  if (statsQuery.isLoading) return <KpiStripSkeleton cells={4} inline />;
  if (statsQuery.isError || !stats) {
    return (
      <p className="audience-inline-error" role="alert">
        {t('dataLoadFailed')}
        <Button type="button" variant="link" size="sm" onClick={() => statsQuery.refetch()}>
          {t('retry')}
        </Button>
      </p>
    );
  }
  const bounce = bounceRate(stats);
  const delta = (change: number | undefined, invert = false) =>
    change === undefined || !Number.isFinite(change) ? undefined : <StatChangeDelta change={change} invertColors={invert} />;
  return (
    <KpiStrip inline columns={4}>
      <KpiCell
        label={t('audienceMatchingVisitors')}
        value={formatNumber(stats.visitors.value)}
        delta={delta(stats.visitors.change)}
      />
      <KpiCell label={t('visits')} value={formatNumber(stats.visits.value)} delta={delta(stats.visits.change)} />
      <KpiCell label={t('pageviews')} value={formatNumber(stats.pageviews.value)} delta={delta(stats.pageviews.change)} />
      <KpiCell
        label={t('bounceRate')}
        value={formatPercent(bounce.rate, { digits: bounce.rate < 10 ? 1 : 0 })}
        delta={delta(bounce.change, true)}
      />
    </KpiStrip>
  );
}

/** Segments catalog (console v2 master–detail): saved filters, their traffic and definition. */
export function SegmentsPanel({ websiteId }: { websiteId: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  // View-only members (and the demo) see the list without create, edit or delete.
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '30d');
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ open: boolean; editId?: string }>({ open: false });
  const [showJson, setShowJson] = useState(false);

  const segmentsQuery = useQuery({
    queryKey: ['segments', websiteId],
    queryFn: () => api<SegmentRow[]>(`/api/websites/${websiteId}/segments`),
  });

  const deleteMutation = useMutation({
    mutationFn: (segmentId: string) => api(`/api/websites/${websiteId}/segments/${segmentId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments', websiteId] }),
  });

  const all = segmentsQuery.data ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? all.filter((row) => row.name.toLowerCase().includes(query)) : all;
  }, [all, search]);

  const requestedId = searchParams.get('id');
  const selected = filtered.find((row) => row.id === requestedId) ?? filtered[0] ?? null;
  const rows = useMemo(() => (selected ? segmentConditionRows(selected.parameters) : []), [selected]);

  function select(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set('id', id);
    setSearchParams(next, { replace: true });
    setShowJson(false);
  }

  function remove(row: SegmentRow) {
    confirm({ title: deleteTitle(row.name), onConfirm: () => deleteMutation.mutate(row.id) });
  }

  const createButton = canEdit ? (
    <Button type="button" variant="primary" onClick={() => setForm({ open: true })}>
      <Plus data-icon="inline-start" aria-hidden />
      {t('createSegment')}
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title={t('segments')}
        lead={t('segmentsLead')}
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />
            {createButton}
          </>
        }
      />

      <PageBody>
        <DataViewState
          loading={segmentsQuery.isLoading}
          loadingFallback={<MasterDetailSkeleton />}
          error={segmentsQuery.isError ? segmentsQuery.error : null}
          onRetry={() => segmentsQuery.refetch()}
        >
          {all.length === 0 ? (
            <EmptyState
              variant="rich"
              icon={<Layers />}
              title={t('audienceSegmentsEmptyTitle')}
              description={t('audienceSegmentsEmptyBody')}
              action={createButton}
            />
          ) : (
            <MasterDetailLayout
              listHeader={
                <>
                  <ResourceSearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t('segmentSearch')}
                    aria-label={t('segmentSearch')}
                    className="audience-list-search"
                  />
                  <span className="master-detail-list-count">
                    {t('audienceSegmentCount').replace('{count}', formatNumber(filtered.length))}
                  </span>
                </>
              }
              list={
                filtered.length ? (
                  filtered.map((row) => (
                    <MasterDetailListItem
                      key={row.id}
                      selected={row.id === selected?.id}
                      onSelect={() => select(row.id)}
                      icon={<Layers size={16} strokeWidth={2} aria-hidden />}
                      title={row.name}
                      subtitle={conditionSummary(segmentConditionRows(row.parameters)) || undefined}
                      meta={<RelativeTime value={row.updatedAt ?? row.createdAt} />}
                    />
                  ))
                ) : (
                  <p className="audience-list-empty">{t('audienceNoMatchTitle')}</p>
                )
              }
              detail={
                selected ? (
                  <MasterDetailPane
                    title={selected.name}
                    meta={
                      <>
                        <span>{t('audienceConditionCount').replace('{count}', formatNumber(rows.length))}</span>
                        {selected.createdAt ? (
                          <span>{t('audienceCreatedOn').replace('{date}', formatShortDate(selected.createdAt))}</span>
                        ) : null}
                        {selected.updatedAt && selected.updatedAt !== selected.createdAt ? (
                          <span>
                            {t('audienceUpdated')} <RelativeTime value={selected.updatedAt} />
                          </span>
                        ) : null}
                      </>
                    }
                    actions={
                      <>
                        <Button type="button" variant="secondary" size="sm" asChild>
                          <Link to={`/websites/${websiteId}?segment=${encodeURIComponent(selected.id)}`}>
                            <ArrowUpRight data-icon="inline-start" aria-hidden />
                            {t('audienceOpenInOverview')}
                          </Link>
                        </Button>
                        {canEdit ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setForm({ open: true, editId: selected.id })}
                            >
                              <Pencil data-icon="inline-start" aria-hidden />
                              {t('edit')}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive-ghost"
                              size="icon-sm"
                              aria-label={t('delete')}
                              title={t('delete')}
                              onClick={() => remove(selected)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </>
                        ) : null}
                      </>
                    }
                  >
                    <div className="audience-pane-kpis">
                      <SegmentTraffic websiteId={websiteId} segmentId={selected.id} rangeQs={rangeQs} />
                    </div>

                    <DetailSection
                      title={t('segmentConditions')}
                      description={t('audienceSegmentConditionsLead')}
                      actions={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-pressed={showJson}
                          onClick={() => setShowJson((open) => !open)}
                        >
                          <Braces data-icon="inline-start" aria-hidden />
                          {showJson ? t('audienceHideJson') : t('audienceViewJson')}
                        </Button>
                      }
                    >
                      {rows.length ? (
                        <ConditionList rows={rows} />
                      ) : (
                        <p className="audience-section-empty">{t('audienceNoConditions')}</p>
                      )}
                      {showJson ? (
                        <pre className="code-block audience-json">{JSON.stringify(selected.parameters, null, 2)}</pre>
                      ) : null}
                    </DetailSection>
                  </MasterDetailPane>
                ) : (
                  <div className="master-detail-pane">
                    <EmptyState
                      icon={<Layers />}
                      title={t('audienceSelectSegment')}
                      description={t('audienceNoMatchBody')}
                    />
                  </div>
                )
              }
            />
          )}
        </DataViewState>
      </PageBody>

      <SegmentFormDialog
        open={form.open}
        onClose={() => setForm({ open: false })}
        websiteId={websiteId}
        segmentId={form.editId}
        onSaved={(id) => (id ? select(id) : undefined)}
      />
    </>
  );
}
