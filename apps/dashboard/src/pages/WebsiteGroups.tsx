import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, UsersRound } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
  ResourceSearchField,
  useMasterDetailSelection,
} from '../components/master-detail';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { api, type GroupDetailResponse, type GroupRow, type GroupsResponse } from '../lib/api';
import { formatDate } from '../lib/formatDate';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';

function groupLabel(group: GroupRow) {
  return group.latestName || group.groupKey;
}

export default function WebsiteGroupsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const [groupType, setGroupType] = useState('account');
  const [search, setSearch] = useState('');

  const typesQuery = useQuery({
    queryKey: ['group-types', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<{ types: string[] }>(`/api/websites/${websiteId}/groups/types`),
  });

  const availableTypes = typesQuery.data?.types ?? [];
  const activeType = availableTypes.includes(groupType) ? groupType : availableTypes[0] || groupType;
  const debouncedSearch = useDebouncedValue(search, 300);

  const groupsQuery = useQuery({
    queryKey: ['groups', websiteId, activeType, debouncedSearch],
    enabled: Boolean(websiteId && activeType),
    queryFn: () =>
      api<GroupsResponse>(
        `/api/websites/${websiteId}/groups?type=${encodeURIComponent(activeType)}${debouncedSearch.trim() ? `&q=${encodeURIComponent(debouncedSearch.trim())}` : ''}`,
      ),
  });

  const groups = groupsQuery.data?.groups ?? [];
  const { setSelectedId: setSelectedGroupKey, selectedItem: selectedGroup } =
    useMasterDetailSelection(groups, (group) => group.groupKey, { defaultToFirst: true });

  const detailQuery = useQuery({
    queryKey: ['group-detail', websiteId, activeType, selectedGroup?.groupKey],
    enabled: Boolean(websiteId && activeType && selectedGroup?.groupKey),
    queryFn: () =>
      api<GroupDetailResponse>(
        `/api/websites/${websiteId}/groups/${encodeURIComponent(activeType)}/${encodeURIComponent(selectedGroup!.groupKey)}`,
      ),
  });

  return (
    <div className="page page-groups">
      <WebsitePageShell websiteId={websiteId} />

      <section className="panel section-gap">
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('groups')}</h2>
            <p className="text-muted">{t('groupsLead')}</p>
          </div>
          <select
            className="select"
            value={activeType}
            onChange={(event) => {
              setGroupType(event.target.value);
              setSelectedGroupKey(null);
            }}
            aria-label={t('groupType')}
          >
            {availableTypes.length ? (
              availableTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))
            ) : (
              <option value="account">account</option>
            )}
          </select>
        </header>

        <ResourceSearchField
          value={search}
          onChange={setSearch}
          placeholder={t('groupsSearchPlaceholder')}
          aria-label={t('groupsSearchPlaceholder')}
          className="people-search"
        />
      </section>

      <section className="panel section-gap">
        {groupsQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : groups.length ? (
          <MasterDetailLayout
            list={groups.map((group) => (
              <MasterDetailListItem
                key={group.groupKey}
                selected={group.groupKey === selectedGroup?.groupKey}
                onSelect={() => setSelectedGroupKey(group.groupKey)}
                icon={<UsersRound size={16} strokeWidth={2} aria-hidden />}
                title={groupLabel(group)}
                subtitle={group.groupKey}
                meta={
                  <>
                    <span className="badge">
                      {group.people.toLocaleString()} {t('people')}
                    </span>
                    <span className="text-muted">{formatDate(group.lastSeenAt)}</span>
                  </>
                }
              />
            ))}
            detail={
              selectedGroup ? (
                <MasterDetailPane
                  title={groupLabel(selectedGroup)}
                  description={`${activeType}: ${selectedGroup.groupKey}`}
                >
                  <div className="surveys-stats">
                    <div>
                      <span className="stat-label">{t('people')}</span>
                      <strong className="stat-value">{selectedGroup.people.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('sessions')}</span>
                      <strong className="stat-value">{selectedGroup.sessions.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('events')}</span>
                      <strong className="stat-value">{selectedGroup.events.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="stat-label">{t('lastSeen')}</span>
                      <strong className="stat-value">{formatDate(selectedGroup.lastSeenAt)}</strong>
                    </div>
                  </div>

                  <div className="workflow-insights-grid">
                    <div className="survey-breakdown">
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h3 className="section-title experiment-title">{t('groupProperties')}</h3>
                          <p className="text-muted">{t('groupPropertiesLead')}</p>
                        </div>
                      </div>
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
                                <td className="text-muted">
                                  {detailQuery.isLoading ? t('loading') : t('groupsNoProperties')}
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
                          <h3 className="section-title experiment-title">{t('groupSessions')}</h3>
                          <p className="text-muted">{t('groupSessionsLead')}</p>
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
                                {[session.distinctId, session.browser, session.country].filter(Boolean).join(' · ') || '-'}
                              </p>
                            </div>
                            <span className="badge">{session.events.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="survey-breakdown">
                    <div className="panel-header compact-panel-header">
                      <div>
                        <h3 className="section-title experiment-title">{t('groupRecentEvents')}</h3>
                        <p className="text-muted">{t('groupRecentEventsLead')}</p>
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
                                <td className="text-muted">{formatDate(event.createdAt)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="text-muted">
                                {detailQuery.isLoading ? t('loading') : t('groupsNoEvents')}
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
          <EmptyState title={t('groupsEmptyTitle')} description={t('groupsEmptyBody')} />
        )}
      </section>
    </div>
  );
}
