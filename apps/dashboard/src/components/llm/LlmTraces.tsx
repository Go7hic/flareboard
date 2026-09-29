import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DataViewState } from '../DataViewState';
import { EmptyState } from '../EmptyState';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { api, type AiTraceSummary } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
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

  return (
    <section className="section-gap">
      <header className="panel-header panel-header--filters">
        <div>
          <h2 className="section-title">{t('aiTabTraces')}</h2>
          <p className="text-muted">{t('aiTracesLead')}</p>
        </div>
        <div className="logs-filter-row">
          <select className="select logs-level-select" value={draft.model} onChange={(event) => update({ model: event.target.value })} aria-label={t('aiModel')}>
            <option value="">{t('allModels')}</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <select
            className="select logs-level-select"
            value={draft.error}
            onChange={(event) => update({ error: event.target.value as TraceFilters['error'] })}
            aria-label={t('status')}
          >
            <option value="">{t('aiAnyErrorState')}</option>
            <option value="true">{t('aiErrorsOnly')}</option>
            <option value="false">{t('aiNoErrors')}</option>
          </select>
          <Input
            className="w-44"
            value={draft.distinctId}
            placeholder={t('aiDistinctIdPlaceholder')}
            aria-label={t('aiDistinctId')}
            onChange={(event) => update({ distinctId: event.target.value })}
          />
          <Input
            className="w-28"
            type="number"
            min={0}
            step="0.0001"
            value={draft.minCost}
            placeholder={t('aiMinCost')}
            aria-label={t('aiMinCost')}
            onChange={(event) => update({ minCost: event.target.value })}
          />
          <Input
            className="w-28"
            type="number"
            min={0}
            step="0.0001"
            value={draft.maxCost}
            placeholder={t('aiMaxCost')}
            aria-label={t('aiMaxCost')}
            onChange={(event) => update({ maxCost: event.target.value })}
          />
          {hasFilters ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => update(EMPTY_TRACE_FILTERS)}>
              {t('reset')}
            </Button>
          ) : null}
        </div>
      </header>

      <DataViewState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {traces.length ? (
          <div className="table-scroll">
            <table className="data-table llm-trace-table">
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
                      className="llm-clickable-row"
                      tabIndex={0}
                      onClick={() => navigate(href)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') navigate(href);
                      }}
                    >
                      <td>
                        <strong>{trace.name ?? t('unknown')}</strong>
                        <div className="text-muted mono llm-subtle">{trace.traceId.slice(0, 18)}</div>
                      </td>
                      <td className="text-muted">{formatDateTime(trace.startedAt)}</td>
                      <td className="num">{formatMs(trace.latencyMs)}</td>
                      <td className="num">
                        {formatNumber(trace.generations)}
                        {trace.spans ? <span className="text-muted"> · {formatNumber(trace.spans)}</span> : null}
                      </td>
                      <td className="num">{formatNumber(trace.tokens)}</td>
                      <td className="num">
                        {formatUsd(trace.costUsd)}
                        {trace.unpricedCalls ? <span className="badge ml-1">{t('aiUnpriced')}</span> : null}
                      </td>
                      <td className="mono">{trace.distinctId ?? <span className="text-muted">{t('aiAnonymous')}</span>}</td>
                      <td>
                        {trace.errors ? (
                          <span className="badge log-level-error">
                            {t('aiErrors')}: {formatNumber(trace.errors)}
                          </span>
                        ) : (
                          <span className="badge">ok</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t('aiNoTraces')} description={t('aiSetupBody')} />
        )}
      </DataViewState>
    </section>
  );
}
