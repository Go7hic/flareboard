import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, UserRound } from 'lucide-react';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
  useMasterDetailSelection,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { StatCard } from '../components/ui/stat-card';
import { api, type PeopleResponse, type PersonDetailResponse, type PersonSummary } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

function personLabel(person: PersonSummary | null | undefined) {
  if (!person) return '-';
  return person.latestName || person.latestEmail || person.latestAlias || person.personId;
}

function propertiesToJson(properties: Array<{ key: string; value: string | null }>) {
  const record: Record<string, string> = {};
  for (const row of properties) {
    if (row.value != null) record[row.key] = row.value;
  }
  return JSON.stringify(record, null, 2);
}

export default function WebsitePeoplePage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const { rangeQs } = useWebsiteRange(websiteId, '30d');
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingProperties, setEditingProperties] = useState(false);
  const [propertiesDraft, setPropertiesDraft] = useState('');
  const [propertiesError, setPropertiesError] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const peopleQuery = useQuery({
    queryKey: ['people', websiteId, rangeQs, debouncedSearch],
    enabled: Boolean(websiteId),
    queryFn: () => {
      const params = new URLSearchParams(rangeQs);
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
      return api<PeopleResponse>(`/api/websites/${websiteId}/people?${params.toString()}`);
    },
  });

  const people = peopleQuery.data?.people ?? [];
  const { setSelectedId: setSelectedPersonId, selectedItem: selectedPerson } =
    useMasterDetailSelection(people, (person) => person.personId, { defaultToFirst: true });

  const detailQuery = useQuery({
    queryKey: ['person-detail', websiteId, selectedPerson?.personId],
    enabled: Boolean(websiteId && selectedPerson?.personId),
    queryFn: () =>
      api<PersonDetailResponse>(
        `/api/websites/${websiteId}/people/${encodeURIComponent(selectedPerson!.personId)}`,
      ),
  });

  const savePropertiesMutation = useMutation({
    mutationFn: ({ personId, properties }: { personId: string; properties: Record<string, unknown> }) =>
      api<PersonDetailResponse>(
        `/api/websites/${websiteId}/people/${encodeURIComponent(personId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ properties }),
        },
      ),
    onSuccess: (data, variables) => {
      // Use the personId from the mutation, not the current selection — the
      // selected person may have changed by the time the request completes.
      const personId = data?.personId ?? variables.personId;
      queryClient.setQueryData(['person-detail', websiteId, personId], data);
      setEditingProperties(false);
      setPropertiesError('');
    },
  });

  function startEditingProperties() {
    const rows = detailQuery.data?.properties ?? [];
    setPropertiesDraft(propertiesToJson(rows));
    setPropertiesError('');
    setEditingProperties(true);
  }

  function cancelEditingProperties() {
    setEditingProperties(false);
    setPropertiesError('');
  }

  function saveProperties() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(propertiesDraft);
    } catch {
      setPropertiesError(t('peoplePropertiesInvalid'));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setPropertiesError(t('peoplePropertiesInvalid'));
      return;
    }
    if (!selectedPerson?.personId) return;
    savePropertiesMutation.mutate({
      personId: selectedPerson.personId,
      properties: parsed as Record<string, unknown>,
    });
  }

  return (
    <Page className="page-people">
      <PageHeader title={t('people')} lead={t('peopleLead')} />

      <PageBody>

      <section className="panel section-gap">
        <ResourceSearchField
          value={search}
          onChange={setSearch}
          placeholder={t('peopleSearchPlaceholder')}
          aria-label={t('peopleSearchPlaceholder')}
          className="people-search"
        />
      </section>

      <section className="panel section-gap">
        <DataViewState
          loading={peopleQuery.isLoading && !peopleQuery.data}
          error={peopleQuery.isError ? peopleQuery.error : null}
          onRetry={() => peopleQuery.refetch()}
          isEmpty={!peopleQuery.isLoading && !people.length}
          emptyTitle={t('peopleEmptyTitle')}
          emptyDescription={t('peopleEmptyBody')}
        >
          <MasterDetailLayout
            list={people.map((person) => (
              <MasterDetailListItem
                key={person.personId}
                selected={person.personId === selectedPerson?.personId}
                onSelect={() => {
                  setSelectedPersonId(person.personId);
                  setEditingProperties(false);
                }}
                icon={<UserRound size={16} strokeWidth={2} aria-hidden />}
                title={personLabel(person)}
                subtitle={
                  person.latestAlias && person.latestAlias !== person.personId
                    ? `${person.latestAlias} · ${person.personId}`
                    : person.personId
                }
                meta={
                  <>
                    <span className="badge">
                      {formatNumber(person.sessions)} {t('sessions')}
                    </span>
                    <span className="text-muted">{formatDateTime(person.lastSeenAt)}</span>
                  </>
                }
              />
            ))}
            detail={
              selectedPerson ? (
                <MasterDetailPane
                  title={personLabel(selectedPerson)}
                  description={
                    selectedPerson.latestAlias ? (
                      <>
                        {t('peopleAlias')}: {selectedPerson.latestAlias} · {selectedPerson.personId}
                      </>
                    ) : (
                      selectedPerson.personId
                    )
                  }
                >
                  <div className="experiment-summary-grid">
                    <StatCard label={t('peopleSessions')} value={formatNumber(selectedPerson.sessions)} />
                    <StatCard label={t('visits')} value={formatNumber(selectedPerson.visits)} />
                    <StatCard label={t('pageviews')} value={formatNumber(selectedPerson.pageviews)} />
                    <StatCard label={t('peopleLastSeen')} value={formatDateTime(selectedPerson.lastSeenAt)} />
                  </div>

                  <div className="workflow-insights-grid">
                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('peopleProperties')}</h3>
                          <p className="text-muted">{t('peoplePropertiesLead')}</p>
                        </div>
                        {canEdit ? (
                          <div className="page-header-actions">
                            {editingProperties ? (
                              <>
                                <Button type="button" variant="ghost" size="sm" onClick={cancelEditingProperties}>
                                  {t('cancel')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  onClick={saveProperties}
                                  disabled={savePropertiesMutation.isPending}
                                >
                                  {t('peopleSaveProperties')}
                                </Button>
                              </>
                            ) : (
                              <Button type="button" variant="secondary" size="sm" onClick={startEditingProperties}>
                                {t('peopleEditProperties')}
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </div>
                      {editingProperties ? (
                        <div className="field">
                          <label className="field-label" htmlFor="people-properties-json">
                            {t('peoplePropertiesJson')}
                          </label>
                          <textarea
                            id="people-properties-json"
                            className="textarea"
                            rows={8}
                            value={propertiesDraft}
                            onChange={(event) => setPropertiesDraft(event.target.value)}
                          />
                          {propertiesError ? <p className="text-danger">{propertiesError}</p> : null}
                          {savePropertiesMutation.isSuccess && !propertiesError ? (
                            <p className="text-muted">{t('peoplePropertiesSaved')}</p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="table-scroll">
                          <table className="data-table">
                            <tbody>
                              {(detailQuery.data?.properties ?? []).length ? (
                                detailQuery.data!.properties.map((property) => (
                                  <tr key={property.key}>
                                    <th>{property.key}</th>
                                    <td>{property.value ?? '-'}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td className="text-muted">{t('peopleNoProperties')}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="detail-section">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('peopleSessions')}</h3>
                          <p className="text-muted">{t('peopleSessionsLead')}</p>
                        </div>
                      </div>
                      <div className="workflow-event-list">
                        {(detailQuery.data?.sessions ?? []).slice(0, 8).map((session) => (
                          <div key={session.id} className="workflow-event-row">
                            <div>
                              <Link to={`/websites/${websiteId}/sessions/${session.id}`} className="inline-link">
                                {session.id.slice(0, 10)}
                                <ExternalLink size={12} strokeWidth={2} aria-hidden />
                              </Link>
                              <p className="text-muted">
                                {[session.browser, session.os, session.country].filter(Boolean).join(' · ') || '-'}
                              </p>
                            </div>
                            <span className="badge">{formatNumber(session.events)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="panel-header compact-panel-header">
                      <div>
                        <h3 className="section-title experiment-title">{t('peopleRecentEvents')}</h3>
                        <p className="text-muted">{t('peopleRecentEventsLead')}</p>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t('event')}</th>
                            <th>{t('page')}</th>
                            <th>{t('session')}</th>
                            <th>{t('created')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detailQuery.data?.events ?? []).length ? (
                            detailQuery.data!.events.slice(0, 25).map((event) => (
                              <tr key={event.id}>
                                <td>{event.eventName ?? (event.eventType === 1 ? t('pageview') : '-')}</td>
                                <td className="text-muted">{event.urlPath ?? '-'}</td>
                                <td>
                                  <Link to={`/websites/${websiteId}/sessions/${event.sessionId}`} className="inline-link">
                                    {event.sessionId.slice(0, 8)}
                                    <ExternalLink size={12} strokeWidth={2} aria-hidden />
                                  </Link>
                                </td>
                                <td className="text-muted">{formatDateTime(event.createdAt)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="text-muted">
                                {detailQuery.isLoading ? t('loading') : t('peopleNoEvents')}
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
        </DataViewState>
      </section>
      </PageBody>
    </Page>
  );
}
