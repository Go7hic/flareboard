import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Waypoints } from 'lucide-react';
import { DataViewState } from '../DataViewState';
import { EmptyState } from '../EmptyState';
import { SectionCard } from '../SectionCard';
import { StatusBadge } from '../StatusBadge';
import { FilterSelect } from '../quality/FilterSelect';
import { RelativeTime } from '../quality/RelativeTime';
import { TableSkeleton } from '../quality/TableSkeleton';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api, type AiTraceSummary } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { formatMs, formatUsd } from './llm-format';

export type TraceFilters = {
  model: string;
  distinctId: string;
  error: '' | 'true' | 'false';
  minCost: string;
  maxCost: string;
};

export const EMPTY_TRACE_FILTERS: TraceFilters = { model: '', distinctId: '', error: '', minCost: '', maxCost: '' };

export function LlmTraces({
  websiteId,
  rangeQs,
  rangeKey,
  models,
  filters,
  onFiltersChange,
}: {
  websiteId: string;
  rangeQs: string;
  rangeKey: unknown;
  models: string[];
  filters: TraceFilters;
  onFiltersChange: (next: TraceFilters) => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(filters);
  const debounced = useDebouncedValue(draft, 350);
  // Selects apply at once; typed fields apply after a pause.
  const applied = { ...debounced, model: draft.model, error: draft.error };

  const qs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    if (applied.model) params.set('model', applied.model);
    if (applied.distinctId.trim()) params.set('distinctId', applied.distinctId.trim());
    if (applied.error) params.set('error', applied.error);
    if (applied.minCost.trim()) params.set('minCost', applied.minCost.trim());
    if (applied.maxCost.trim()) params.set('maxCost', applied.maxCost.trim());
    params.set('limit', '200');
    return params.toString();
  }, [rangeQs, applied.model, applied.distinctId, applied.error, applied.minCost, applied.maxCost]);

  const query = useQuery({
    queryKey: ['ai-traces', websiteId, rangeKey, qs],
    queryFn: () => api<{ traces: AiTraceSummary[]; total: number; truncated: boolean }>(`/api/websites/${websiteId}/ai-observability/traces?${qs}`),
    placeholderData: keepPreviousData,
  });

  const update = (patch: Partial<TraceFilters>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onFiltersChange(next);
  };
  const hasFilters = Object.values(draft).some(Boolean);
  const traces = query.data?.traces ?? [];
  const total = query.data?.total ?? traces.length;

  return (
    <>
      <div className="q-toolbar">
        <div className="q-search q-search--narrow">
          <Search className="q-search-icon" size={15} strokeWidth={2} aria-hidden />
          <Input
            type="search"
            className="q-search-input"
            value={draft.distinctId}
            placeholder={t('aiDistinctIdPlaceholder')}
            aria-label={t('aiDistinctId')}
            onChange={(event) => update({ distinctId: event.target.value })}
          />
        </div>
        <FilterSelect
          label={t('aiModel')}
          value={draft.model}
          onChange={(model) => update({ model })}
          allLabel={t('allModels')}
          options={models.map((model) => ({ value: model, label: model }))}
        />
        <FilterSelect
          label={t('status')}
          value={draft.error}
          onChange={(error) => update({ error: error as TraceFilters['error'] })}
          allLabel={t('aiAnyErrorState')}
          options={[
            { value: 'true', label: t('aiErrorsOnly') },
            { value: 'false', label: t('aiNoErrors') },
          ]}
        />
        <div className="q-cost-range" role="group" aria-label={t('aiCost')}>
          <Input
            className="q-cost-input"
            type="number"
            min={0}
            step="0.0001"
            value={draft.minCost}
            placeholder={t('aiMinCost')}
            aria-label={t('aiMinCost')}
            onChange={(event) => update({ minCost: event.target.value })}
          />
          <span className="q-cost-sep" aria-hidden>
            –
          </span>
          <Input
            className="q-cost-input"
            type="number"
            min={0}
            step="0.0001"
            value={draft.maxCost}
            placeholder={t('aiMaxCost')}
            aria-label={t('aiMaxCost')}
            onChange={(event) => update({ maxCost: event.target.value })}
          />
        </div>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => update(EMPTY_TRACE_FILTERS)}>
            {t('reset')}
          </Button>
        ) : null}
      </div>

      <SectionCard
        flush
        title={t('aiTabTraces')}
        description={t('aiTracesLead')}
        actions={
          traces.length ? (
            <span className="q-card-count">
              {t('qualityShownOf').replace('{shown}', formatNumber(traces.length)).replace('{total}', formatNumber(total))}
            </span>
          ) : null
        }
      >
        <DataViewState
          loading={query.isLoading}
          error={query.isError && !query.data ? query.error : null}
          onRetry={() => void query.refetch()}
          loadingFallback={<TableSkeleton rows={8} columns={6} />}
        >
          {traces.length ? (
            <div className="table-scroll">
              <table className="data-table data-table--interactive">
                <thead>
                  <tr>
                    <th>{t('aiTraceName')}</th>
                    <th>{t('aiTraceStarted')}</th>
                    <th className="num">{t('aiLatency')}</th>
                    <th className="num">{t('aiGenerations')}</th>
                    <th className="num">{t('aiTokens')}</th>
                    <th className="num">{t('aiCost')}</th>
                    <th>{t('aiDistinctId')}</th>
                    <th>{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map((trace) => {
                    const href = `/websites/${websiteId}/ai-observability/traces/${encodeURIComponent(trace.traceId)}?at=${trace.startedAt}`;
                    return (
                      <tr
                        key={trace.traceId}
                        tabIndex={0}
                        onClick={() => navigate(href)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') navigate(href);
                        }}
                      >
                        <td>
                          <div className="q-issue-copy">
                            <span className="q-trace-root">{trace.name ?? t('unknown')}</span>
                            <span className="q-issue-meta">
                              <span className="mono">{trace.traceId.slice(0, 13)}</span>
                              {trace.models.length ? (
                                <span className="mono q-issue-location" title={trace.models.join(', ')}>
                                  {trace.models.join(', ')}
                                </span>
                              ) : null}
                            </span>
                          </div>
                        </td>
                        <td className="q-col-when">
                          <RelativeTime value={trace.startedAt} />
                        </td>
                        <td className="num">{formatMs(trace.latencyMs)}</td>
                        <td className="num">
                          {formatNumber(trace.generations)}
                          {trace.spans ? (
                            <span className="q-cell-sub">{t('qualitySpanCount').replace('{count}', formatNumber(trace.spans))}</span>
                          ) : null}
                        </td>
                        <td className="num">{formatNumber(trace.tokens)}</td>
                        <td className="num">
                          {formatUsd(trace.costUsd)}
                          {trace.unpricedCalls ? <span className="q-cell-sub">{t('aiUnpriced')}</span> : null}
                        </td>
                        <td className="mono q-col-user">
                          {trace.distinctId ?? <span className="q-col-muted">{t('aiAnonymous')}</span>}
                        </td>
                        <td>
                          {trace.errors ? (
                            <StatusBadge tone="danger">
                              {t('aiErrors')} {formatNumber(trace.errors)}
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="success">{t('logsTraceStatusOk')}</StatusBadge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Waypoints />} title={t('aiNoTraces')} description={t('aiSetupBody')} />
          )}
        </DataViewState>
      </SectionCard>
    </>
  );
}
