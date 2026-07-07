import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Bot, ExternalLink } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Button } from '../components/ui/button';
import { api, type AiObservabilityResponse } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function formatDate(value: number | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function money(value: number | null | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function formatTrendDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString();
}

function AiStatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}

export default function WebsiteAiObservabilityPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { range, setRange, rangeQs } = useWebsiteRange(websiteId, '24h');
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
    <div className="page page-ai-observability">
      <WebsitePageShell websiteId={websiteId} />

      <div className="stats-header-row section-gap">
        <div>
          <h2 className="page-title">{t('aiObservability')}</h2>
          <p className="text-muted">{t('aiObservabilityLead')}</p>
        </div>
        <WebsiteDateExportControls range={range} onRangeChange={setRange} />
      </div>

      <section className="analytics-hero-stats section-gap" aria-label={t('aiObservability')}>
        <AiStatCard label={t('aiCalls')} value={stats?.calls ?? 0} />
        <AiStatCard label={t('aiTokens')} value={stats?.tokens ?? 0} />
        <AiStatCard label={t('aiCost')} value={money(stats?.costUsd)} />
        <AiStatCard label={t('aiAvgLatency')} value={`${stats?.avgLatencyMs ?? 0}ms`} />
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
                        <td className="num">{row.calls.toLocaleString()}</td>
                        <td className="num">{row.tokens.toLocaleString()}</td>
                        <td className="num">{money(row.costUsd)}</td>
                        <td className="num">{row.errors.toLocaleString()}</td>
                        <td className="num">{row.avgLatencyMs ?? 0}ms</td>
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
                          {row.calls.toLocaleString()} ({share}%)
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
                          {row.calls.toLocaleString()} · {money(row.costUsd)}
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
                          {row.calls.toLocaleString()} ({share}%)
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
                          {row.calls.toLocaleString()} · {money(row.costUsd)}
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
                          {row.calls.toLocaleString()} · {money(row.costUsd)}
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

      <section className="panel section-gap">
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
                    <td className="num">{row.calls.toLocaleString()}</td>
                    <td className="num">{row.tokens.toLocaleString()}</td>
                    <td className="num">{money(row.costUsd)}</td>
                    <td className="num">{row.errors.toLocaleString()}</td>
                    <td className="num">{row.errorRate.toLocaleString()}%</td>
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

      <section className="panel section-gap">
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
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('aiModel')}</th>
                  <th>{t('status')}</th>
                  <th>{t('aiTokens')}</th>
                  <th>{t('aiCost')}</th>
                  <th>{t('aiLatency')}</th>
                  <th>{t('session')}</th>
                  <th>{t('created')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <div className="errors-name-cell">
                        <Bot size={16} strokeWidth={2} aria-hidden />
                        <div>
                          <div className="errors-message">{event.model ?? t('unknown')}</div>
                          <div className="text-muted">
                            {[event.provider, event.release, event.environment].filter(Boolean).join(' · ') || '-'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${event.status === 'error' ? 'log-level-error' : 'badge-accent'}`}>
                        {event.status ?? t('aiStatus_success')}
                      </span>
                    </td>
                    <td className="num">{(event.totalTokens ?? 0).toLocaleString()}</td>
                    <td className="num">{money(event.costUsd)}</td>
                    <td className="num">{event.latencyMs ?? 0}ms</td>
                    <td>
                      <Link to={`/websites/${websiteId}/sessions/${event.sessionId}`} className="inline-link">
                        {event.sessionId.slice(0, 8)}
                        <ExternalLink size={12} strokeWidth={2} aria-hidden />
                      </Link>
                    </td>
                    <td className="text-muted">{formatDate(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!aiQuery.isLoading && !events.length ? (
          <EmptyState title={t('aiEmptyTitle')} description={t('aiEmptyBody')} />
        ) : null}
      </section>
    </div>
  );
}
