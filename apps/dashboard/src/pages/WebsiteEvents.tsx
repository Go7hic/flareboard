import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, MousePointerClick } from 'lucide-react';
import { EventDataPanel } from '../components/EventDataPanel';
import { EmptyState } from '../components/EmptyState';
import { MetricsTable } from '../components/MetricsTable';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
  useMasterDetailSelection,
} from '../components/master-detail';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { api, type EventCatalogDetailResponse, type EventCatalogResponse, type MetricRow } from '../lib/api';
import { t } from '../lib/i18n';

function formatDate(value: number | null | undefined) {
  if (value == null) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WebsiteEventsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const [search, setSearch] = useState('');

  const catalogQuery = useQuery({
    queryKey: ['event-catalog', websiteId, search],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<EventCatalogResponse>(
        `/api/websites/${websiteId}/events/catalog${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`,
      ),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<MetricRow[]>(`/api/websites/${websiteId}/events`),
  });

  const catalog = catalogQuery.data?.events ?? [];
  const { selectedId: selectedEventName, setSelectedId: setSelectedEventName, selectedItem: selectedEvent } =
    useMasterDetailSelection(catalog, (event) => event.eventName, { defaultToFirst: true });

  const detailQuery = useQuery({
    queryKey: ['event-catalog-detail', websiteId, selectedEvent?.eventName],
    enabled: Boolean(websiteId && selectedEvent?.eventName),
    queryFn: () =>
      api<EventCatalogDetailResponse>(
        `/api/websites/${websiteId}/events/catalog/${encodeURIComponent(selectedEvent!.eventName)}`,
      ),
  });

  const detail = detailQuery.data;
  const summary = detail?.summary ?? selectedEvent;

  return (
    <div className="page page-events">
      <WebsitePageShell websiteId={websiteId} />

      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('eventCatalog')}</h2>
            <p className="text-muted">{t('eventCatalogLead')}</p>
          </div>
        </header>

        <ResourceSearchField
          value={search}
          onChange={setSearch}
          placeholder={t('eventCatalogSearchPlaceholder')}
          aria-label={t('eventCatalogSearchPlaceholder')}
        />
      </section>

      <section className="panel section-gap">
        {catalogQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : catalog.length ? (
          <MasterDetailLayout
            list={catalog.map((event) => (
              <MasterDetailListItem
                key={event.eventName}
                selected={event.eventName === selectedEvent?.eventName}
                onSelect={() => setSelectedEventName(event.eventName)}
                icon={<MousePointerClick size={16} strokeWidth={2} aria-hidden />}
                title={event.eventName}
                subtitle={`${event.paths.toLocaleString()} ${t('eventCatalogPathsCount')}`}
                meta={
                  <>
                    <span className="badge">
                      {event.events.toLocaleString()} {t('events')}
                    </span>
                    <span className="text-muted">{formatDate(event.lastSeenAt)}</span>
                  </>
                }
              />
            ))}
            detail={
              selectedEvent && summary ? (
                <MasterDetailPane
                  title={selectedEvent.eventName}
                  description={
                    selectedEvent.propertyKeys.length
                      ? selectedEvent.propertyKeys.slice(0, 5).join(', ')
                      : t('eventCatalogNoProperties')
                  }
                >
                  <div className="surveys-stats">
                    <div>
                      <span className="stat-label">{t('events')}</span>
                      <strong className="stat-value">{summary.events.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('sessions')}</span>
                      <strong className="stat-value">{summary.sessions.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('visits')}</span>
                      <strong className="stat-value">{summary.visits.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('eventLastSeen')}</span>
                      <strong className="stat-value">{formatDate(summary.lastSeenAt)}</strong>
                    </div>
                  </div>

                  <div className="workflow-insights-grid">
                    <div className="survey-breakdown">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('eventCatalogProperties')}</h3>
                          <p className="text-muted">{t('eventCatalogPropertiesLead')}</p>
                        </div>
                      </div>
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>{t('key')}</th>
                              <th className="num">{t('events')}</th>
                              <th className="num">{t('eventPropertyValues')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(detail?.properties ?? []).length ? (
                              detail!.properties.map((property) => (
                                <tr key={property.key}>
                                  <td>{property.key}</td>
                                  <td className="num">{property.count.toLocaleString()}</td>
                                  <td className="num">{property.valuesCount.toLocaleString()}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={3} className="text-muted">
                                  {detailQuery.isLoading ? t('loading') : t('eventCatalogNoProperties')}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="survey-breakdown">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('eventCatalogPaths')}</h3>
                          <p className="text-muted">{t('eventCatalogPathsLead')}</p>
                        </div>
                      </div>
                      <div className="workflow-event-list">
                        {(detail?.paths ?? []).length ? (
                          detail!.paths.map((path) => (
                            <div key={path.path ?? 'unknown'} className="workflow-event-row">
                              <div>
                                <strong>{path.path ?? '-'}</strong>
                                <p className="text-muted">{formatDate(path.lastSeenAt)}</p>
                              </div>
                              <span className="badge">{path.events.toLocaleString()}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-muted">{detailQuery.isLoading ? t('loading') : t('eventCatalogNoPaths')}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="survey-breakdown">
                    <div className="panel-header compact-panel-header">
                      <div>
                        <h3 className="section-title experiment-title">{t('eventCatalogRecent')}</h3>
                        <p className="text-muted">{t('eventCatalogRecentLead')}</p>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t('page')}</th>
                            <th>{t('session')}</th>
                            <th>{t('created')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail?.recent ?? []).length ? (
                            detail!.recent.map((event) => (
                              <tr key={event.id}>
                                <td className="text-muted">{event.urlPath ?? '-'}</td>
                                <td>
                                  <Link to={`/websites/${websiteId}/sessions/${event.sessionId}`} className="inline-link">
                                    {event.sessionId.slice(0, 8)}
                                    <ExternalLink size={12} strokeWidth={2} aria-hidden />
                                  </Link>
                                </td>
                                <td className="text-muted">{formatDate(event.createdAt)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3} className="text-muted">
                                {detailQuery.isLoading ? t('loading') : t('eventCatalogNoRecent')}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </MasterDetailPane>
              ) : null
            }
          />
        ) : (
          <EmptyState title={t('eventCatalogEmptyTitle')} description={t('eventCatalogEmptyBody')} />
        )}
      </section>

      <section className="panel section-gap custom-events-panel">
        <MetricsTable
          embedded
          title={t('customEvents')}
          rows={eventsQuery.data ?? []}
          loading={eventsQuery.isLoading}
        />
      </section>
      {websiteId ? <EventDataPanel websiteId={websiteId} /> : null}
    </div>
  );
}
