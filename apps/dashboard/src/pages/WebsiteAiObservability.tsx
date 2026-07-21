import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Bot, ExternalLink } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  useMasterDetailSelection,
} from '../components/master-detail';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { api, type AiObservabilityResponse } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { StatCard } from '../components/ui/stat-card';
import { DataViewState } from '../components/DataViewState';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function money(value: number | null | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function formatTrendDate(value: string) {
  return formatDateTime(`${value}T00:00:00Z`);
}

export default function WebsiteAiObservabilityPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [quality, setQuality] = useState('');
  const [releaseFilter, setReleaseFilter] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const qs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    if (model) params.set('model', model);
    if (status) params.set('status', status);
    if (provider) params.set('provider', provider);
    if (quality) params.set('quality', quality);
    if (releaseFilter) params.set('release', releaseFilter);
    if (environmentFilter) params.set('environment', environmentFilter);
    return params.toString();
  }, [environmentFilter, model, provider, quality, rangeQs, releaseFilter, status]);

  const aiQuery = useQuery({
    queryKey: ['ai-observability', websiteId, range, model, status, provider, quality, releaseFilter, environmentFilter],
    enabled: Boolean(websiteId),
    queryFn: () => api<AiObservabilityResponse>(`/api/websites/${websiteId}/ai-observability?${qs}`),
  });

  const stats = aiQuery.data?.stats;
  const events = aiQuery.data?.events ?? [];
  const {
    selectedId: selectedEventId,
    setSelectedId: setSelectedEventId,
    selectedItem: selectedEvent,
  } = useMasterDetailSelection(events, (event) => event.id);

  useEffect(() => {
    if (!events.length) {
      setSelectedEventId(null);
      return;
    }
    if (!selectedEventId || !events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(events[0].id);
    }
  }, [events, selectedEventId, setSelectedEventId]);

  const models = stats?.models ?? [];
  const statuses = stats?.statuses ?? [];
  const providers = stats?.providers ?? [];
  const qualities = stats?.qualities ?? [];
  const releases = stats?.releases ?? [];
  const environments = stats?.environments ?? [];
  const trendRows = stats?.trend ?? [];
  const hasFilters = Boolean(model || status || provider || quality || releaseFilter || environmentFilter);

  function resetFilters() {
    setModel('');
    setStatus('');
    setProvider('');
    setQuality('');
    setReleaseFilter('');
    setEnvironmentFilter('');
  }

  return (
    <Page className="page-ai-observability">
      <PageHeader
        title={t('aiObservability')}
        lead={t('aiObservabilityLead')}
        actions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
        }
      />

      <PageBody>
      <section className="analytics-hero-stats section-gap" aria-label={t('aiObservability')}>
        <DataViewState
          loading={aiQuery.isLoading}
          error={aiQuery.error}
          onRetry={() => void aiQuery.refetch()}
        >
          <StatCard label={t('aiCalls')} value={formatNumber(stats?.calls ?? 0)} />
          <StatCard label={t('aiTokens')} value={formatNumber(stats?.tokens ?? 0)} />
          <StatCard label={t('aiCost')} value={money(stats?.costUsd)} />
          <StatCard label={t('aiAvgLatency')} value={`${formatNumber(stats?.avgLatencyMs ?? 0)}ms`} />
        </DataViewState>
      </section>

      {(trendRows.length || statuses.length) ? (
        <section className="panel section-gap">
          <div className="error-insights-grid">
            <div>
              <header className="compact-panel-header">
                <h2 className="section-title">{t('aiTrend')}</h2>
                <p className="text-muted">{t('aiTrendLead')}</p>
              </header>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('date')}</th>
                      <th>{t('aiCalls')}</th>
                      <th>{t('aiTokens')}</th>
                      <th>{t('aiCost')}</th>
                      <th>{t('aiErrors')}</th>
                      <th>{t('aiAvgLatency')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendRows.map((row) => (
                      <tr key={row.date}>
                        <td>{formatTrendDate(row.date)}</td>
                        <td className="num">{formatNumber(row.calls)}</td>
                        <td className="num">{formatNumber(row.tokens)}</td>
                        <td className="num">{money(row.costUsd)}</td>
                        <td className="num">{formatNumber(row.errors)}</td>
                        <td className="num">{formatNumber(row.avgLatencyMs ?? 0)}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="detail-section error-severity-panel">
              <header className="compact-panel-header">
                <h2 className="section-title">{t('aiStatusBreakdown')}</h2>
                <p className="text-muted">{t('aiStatusBreakdownLead')}</p>
              </header>
              <div className="breakdown-list">
                {statuses.map((row) => {
                  const share = stats?.calls ? Math.round((row.calls / stats.calls) * 100) : 0;
                  return (
                    <div key={row.status} className="breakdown-row">
                      <div className="breakdown-meta">
                        <strong>{row.status}</strong>
                        <span className="text-muted">
                          {formatNumber(row.calls)} ({share}%)
                        </span>
                      </div>
                      <div className="breakdown-track" aria-hidden>
                        <span style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {(providers.length || qualities.length) ? (
        <section className="panel section-gap">
          <div className="workflow-insights-grid">
            <div className="detail-section error-severity-panel">
              <header className="compact-panel-header">
                <h2 className="section-title">{t('aiProviderBreakdown')}</h2>
                <p className="text-muted">{t('aiProviderBreakdownLead')}</p>
              </header>
              <div className="breakdown-list">
                {providers.map((row) => {
                  const share = stats?.calls ? Math.round((row.calls / stats.calls) * 100) : 0;
                  return (
                    <div key={row.provider} className="breakdown-row">
                      <div className="breakdown-meta">
                        <strong>{row.provider}</strong>
                        <span className="text-muted">
                          {formatNumber(row.calls)} · {money(row.costUsd)}
                        </span>
                      </div>
                      <div className="breakdown-track" aria-hidden>
                        <span style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="detail-section error-severity-panel">
              <header className="compact-panel-header">
                <h2 className="section-title">{t('aiQualityBreakdown')}</h2>
                <p className="text-muted">{t('aiQualityBreakdownLead')}</p>
              </header>
              <div className="breakdown-list">
                {qualities.map((row) => {
                  const share = stats?.calls ? Math.round((row.calls / stats.calls) * 100) : 0;
                  return (
                    <div key={row.quality} className="breakdown-row">
                      <div className="breakdown-meta">
                        <strong>{row.quality}</strong>
                        <span className="text-muted">
                          {formatNumber(row.calls)} ({share}%)
                        </span>
                      </div>
                      <div className="breakdown-track" aria-hidden>
                        <span style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {(releases.length || environments.length) ? (
        <section className="panel section-gap">
          <div className="workflow-insights-grid">
            <div className="detail-section error-severity-panel">
              <header className="compact-panel-header">
                <h2 className="section-title">{t('aiReleaseBreakdown')}</h2>
                <p className="text-muted">{t('aiReleaseBreakdownLead')}</p>
              </header>
              <div className="breakdown-list">
                {releases.map((row) => {
                  const share = stats?.calls ? Math.round((row.calls / stats.calls) * 100) : 0;
                  return (
                    <div key={row.release} className="breakdown-row">
                      <div className="breakdown-meta">
                        <strong>{row.release}</strong>
                        <span className="text-muted">
                          {formatNumber(row.calls)} · {money(row.costUsd)}
                        </span>
                      </div>
                      <div className="breakdown-track" aria-hidden>
                        <span style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="detail-section error-severity-panel">
              <header className="compact-panel-header">
                <h2 className="section-title">{t('aiEnvironmentBreakdown')}</h2>
                <p className="text-muted">{t('aiEnvironmentBreakdownLead')}</p>
              </header>
              <div className="breakdown-list">
                {environments.map((row) => {
                  const share = stats?.calls ? Math.round((row.calls / stats.calls) * 100) : 0;
                  return (
                    <div key={row.environment} className="breakdown-row">
                      <div className="breakdown-meta">
                        <strong>{row.environment}</strong>
                        <span className="text-muted">
                          {formatNumber(row.calls)} · {money(row.costUsd)}
                        </span>
                      </div>
                      <div className="breakdown-track" aria-hidden>
                        <span style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('aiModels')}</h2>
            <p className="text-muted">{t('aiModelsLead')}</p>
          </div>
        </header>

        {models.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('aiModel')}</th>
                  <th>{t('aiCalls')}</th>
                  <th>{t('aiTokens')}</th>
                  <th>{t('aiCost')}</th>
                  <th>{t('aiErrors')}</th>
                  <th>{t('aiErrorRate')}</th>
                  <th>{t('aiAvgLatency')}</th>
                </tr>
              </thead>
              <tbody>
                {models.map((row) => (
                  <tr key={row.model}>
                    <td>{row.model}</td>
                    <td className="num">{formatNumber(row.calls)}</td>
                    <td className="num">{formatNumber(row.tokens)}</td>
                    <td className="num">{money(row.costUsd)}</td>
                    <td className="num">{formatNumber(row.errors)}</td>
                    <td className="num">{formatNumber(row.errorRate)}%</td>
                    <td className="num">{row.avgLatencyMs ?? 0}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t('aiEmptyTitle')} description={t('aiEmptyBody')} />
        )}
      </section>

      <section className="section-gap">
        <header className="panel-header panel-header--filters">
          <div>
            <h2 className="section-title">{t('aiRecentCalls')}</h2>
            <p className="text-muted">{t('aiRecentCallsLead')}</p>
          </div>
          <div className="logs-filter-row">
            <select
              className="select logs-level-select"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              aria-label={t('aiModel')}
            >
              <option value="">{t('allModels')}</option>
              {models.map((item) => (
                <option key={item.model} value={item.model}>
                  {item.model}
                </option>
              ))}
            </select>
            <select
              className="select logs-level-select"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label={t('status')}
            >
              <option value="">{t('allStatuses')}</option>
              {statuses.map((item) => (
                <option key={item.status} value={item.status}>
                  {item.status}
                </option>
              ))}
            </select>
            <select
              className="select logs-level-select"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              aria-label={t('aiProvider')}
            >
              <option value="">{t('allProviders')}</option>
              {providers.map((item) => (
                <option key={item.provider} value={item.provider}>
                  {item.provider}
                </option>
              ))}
            </select>
            <select
              className="select logs-level-select"
              value={quality}
              onChange={(event) => setQuality(event.target.value)}
              aria-label={t('aiQuality')}
            >
              <option value="">{t('allQualities')}</option>
              {qualities.map((item) => (
                <option key={item.quality} value={item.quality}>
                  {item.quality}
                </option>
              ))}
            </select>
            <select
              className="select logs-level-select"
              value={releaseFilter}
              onChange={(event) => setReleaseFilter(event.target.value)}
              aria-label={t('release')}
            >
              <option value="">{t('allReleases')}</option>
              {releases.map((item) => (
                <option key={item.release} value={item.release}>
                  {item.release}
                </option>
              ))}
            </select>
            <select
              className="select logs-level-select"
              value={environmentFilter}
              onChange={(event) => setEnvironmentFilter(event.target.value)}
              aria-label={t('environment')}
            >
              <option value="">{t('allEnvironments')}</option>
              {environments.map((item) => (
                <option key={item.environment} value={item.environment}>
                  {item.environment}
                </option>
              ))}
            </select>
            {hasFilters ? (
              <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>
                {t('reset')}
              </Button>
            ) : null}
          </div>
        </header>

        {aiQuery.isLoading ? <div className="skeleton" style={{ height: '8rem' }} /> : null}

        {!aiQuery.isLoading && events.length ? (
          <MasterDetailLayout
            list={events.map((event) => (
              <MasterDetailListItem
                key={event.id}
                selected={event.id === selectedEventId}
                onSelect={() => setSelectedEventId(event.id)}
                icon={<Bot size={16} strokeWidth={2} aria-hidden />}
                title={event.model ?? t('unknown')}
                subtitle={[event.provider, event.release, event.environment].filter(Boolean).join(' · ') || '-'}
                meta={
                  <span
                    className={`badge ${event.status === 'error' ? 'log-level-error' : 'badge-accent'}`}
                  >
                    {event.status ?? t('aiStatus_success')}
                  </span>
                }
              />
            ))}
            detail={
              selectedEvent ? (
                <MasterDetailPane
                  title={selectedEvent.model ?? t('unknown')}
                  description={
                    <p className="text-muted">
                      {[selectedEvent.provider, selectedEvent.release, selectedEvent.environment]
                        .filter(Boolean)
                        .join(' · ') || '-'}
                    </p>
                  }
                  actions={
                    <Link
                      to={`/websites/${websiteId}/sessions/${selectedEvent.sessionId}`}
                      className="inline-link"
                    >
                      {selectedEvent.sessionId.slice(0, 8)}
                      <ExternalLink size={12} strokeWidth={2} aria-hidden />
                    </Link>
                  }
                >
                  <div className="detail-stats">
                    <div>
                      <span className="stat-label">{t('status')}</span>
                      <strong className="stat-value">{selectedEvent.status ?? t('aiStatus_success')}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('aiTokens')}</span>
                      <strong className="stat-value">
                        {formatNumber((selectedEvent.totalTokens ?? 0))}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('aiCost')}</span>
                      <strong className="stat-value">{money(selectedEvent.costUsd)}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('aiLatency')}</span>
                      <strong className="stat-value">{selectedEvent.latencyMs ?? 0}ms</strong>
                    </div>
                  </div>
                  <div className="detail-section">
                    <p className="text-muted">
                      {t('aiQuality')}: {selectedEvent.quality ?? '—'}
                    </p>
                    <p className="text-muted">
                      {t('page')}: {selectedEvent.urlPath || '/'}
                    </p>
                    <p className="text-muted">
                      {t('created')}: {formatDateTime(selectedEvent.createdAt)}
                    </p>
                  </div>
                </MasterDetailPane>
              ) : null
            }
          />
        ) : null}

        {!aiQuery.isLoading && !events.length ? (
          <EmptyState title={t('aiEmptyTitle')} description={t('aiEmptyBody')} />
        ) : null}
      </section>
      </PageBody>
    </Page>
  );
}
