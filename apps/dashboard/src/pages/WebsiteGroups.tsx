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
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/ui/stat-card';
import { api, type GroupDetailResponse, type GroupRow, type GroupsResponse } from '../lib/api';
import { formatDateOnly, formatDateTime, formatNumber, identityPrimary } from '../lib/format';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';

function groupLabel(group: GroupRow) {
  return identityPrimary([group.latestName], group.groupKey);
}

function groupDetailMeta(group: GroupRow, type: string) {
  const lastSeen = group.lastSeenAt
    ? `${t('lastSeen')} ${formatDateTime(group.lastSeenAt)}`
    : null;
  return [`${type}: ${group.groupKey}`, lastSeen].filter(Boolean).join(' · ');
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
    <Page className="page-groups">
      <PageHeader title={t('groups')} lead={t('groupsLead')} />

      <PageBody>

      <section className="panel section-gap">
        <header className="panel-header">
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

      <section className="section-gap">
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
                      {formatNumber(group.people)} {t('people')}
                    </span>
                    <span className="text-muted">{formatDateOnly(group.lastSeenAt)}</span>
                  </>
                }
              />
            ))}
            detail={
              selectedGroup ? (
                <MasterDetailPane
                  title={groupLabel(selectedGroup)}
                  description={groupDetailMeta(selectedGroup, activeType)}
                >
                  <div className="experiment-summary-grid">
                    <StatCard label={t('people')} value={formatNumber(selectedGroup.people)} />
                    <StatCard label={t('sessions')} value={formatNumber(selectedGroup.sessions)} />
                    <StatCard label={t('events')} value={formatNumber(selectedGroup.events)} />
                  </div>

                  <div className="workflow-insights-grid">
                    <div className="detail-section">
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

                    <div className="detail-section">
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
                            <span className="badge">{formatNumber(session.events)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="detail-section">
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
                                <td className="text-muted">{formatDateTime(event.createdAt)}</td>
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
      </PageBody>
    </Page>
  );
}
