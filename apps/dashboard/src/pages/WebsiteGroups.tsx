import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { Building2, SearchX } from 'lucide-react';
import { keepPreviousForWebsite } from '../components/audience/keepPrevious';
import { RelativeTime } from '../components/audience/ActivityLists';
import {
  SortHeader,
  TableSkeletonRows,
  type SortState,
} from '../components/audience/DataTableParts';
import { GroupSheet, groupLabel } from '../components/audience/GroupSheet';
import { IdentityAvatar } from '../components/audience/IdentityAvatar';
import { Segmented } from '../components/audience/Segmented';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { ResourceSearchField } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';
import { api, type GroupRow, type GroupsResponse } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { cn } from '../lib/utils';

/** Group types beyond this many switch from a segmented control to a select. */
const MAX_SEGMENTED_TYPES = 4;

type GroupSortKey = 'people' | 'sessions' | 'pageviews' | 'events' | 'lastSeen';

const SORT_VALUE: Record<GroupSortKey, (group: GroupRow) => number> = {
  people: (group) => group.people,
  sessions: (group) => group.sessions,
  pageviews: (group) => group.pageviews,
  events: (group) => group.events,
  lastSeen: (group) => group.lastSeenAt ?? 0,
};

/** "company" → "Company" for headers; keys stay as typed elsewhere. */
function typeLabel(type: string) {
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : type;
}

export default function WebsiteGroupsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '30d');
  const [groupType, setGroupType] = useState(() => searchParams.get('type') ?? '');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState<GroupSortKey>>({ key: 'lastSeen', direction: 'desc' });
  const debouncedSearch = useDebouncedValue(search, 300);
  const openGroupKey = searchParams.get('group');

  const typesQuery = useQuery({
    queryKey: ['group-types', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<{ types: string[] }>(`/api/websites/${websiteId}/groups/types`),
  });

  const availableTypes = typesQuery.data?.types ?? [];
  const activeType = availableTypes.includes(groupType) ? groupType : (availableTypes[0] ?? '');

  const groupsQuery = useQuery({
    queryKey: ['groups', websiteId, activeType, rangeQs, debouncedSearch],
    enabled: Boolean(websiteId && activeType),
    placeholderData: keepPreviousForWebsite(websiteId),
    queryFn: () => {
      const params = new URLSearchParams(rangeQs);
      params.set('type', activeType);
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
      return api<GroupsResponse>(`/api/websites/${websiteId}/groups?${params.toString()}`);
    },
  });

  const groups = groupsQuery.data?.groups ?? [];
  const rows = useMemo(() => {
    const value = SORT_VALUE[sort.key];
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...groups].sort((a, b) => sign * (value(a) - value(b)));
  }, [groups, sort]);

  const noTypes = typesQuery.isSuccess && availableTypes.length === 0;
  const initialLoading =
    typesQuery.isLoading || (Boolean(activeType) && groupsQuery.isLoading && !groupsQuery.data);
  const refreshing = groupsQuery.isFetching && groupsQuery.isPlaceholderData;
  const openSummary = openGroupKey ? groups.find((group) => group.groupKey === openGroupKey) : undefined;
  const error = typesQuery.isError
    ? typesQuery.error
    : groupsQuery.isError && !groupsQuery.data
      ? groupsQuery.error
      : null;

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function changeType(next: string) {
    setGroupType(next);
    const params = new URLSearchParams(searchParams);
    params.set('type', next);
    params.delete('group');
    setSearchParams(params, { replace: true });
  }

  const sortHeader = (key: GroupSortKey, label: string, className?: string) => (
    <SortHeader label={label} sortKey={key} sort={sort} onSort={setSort} numeric className={className} />
  );

  const typeSwitcher =
    availableTypes.length > MAX_SEGMENTED_TYPES ? (
      <select
        className="select audience-type-select"
        value={activeType}
        onChange={(event) => changeType(event.target.value)}
        aria-label={t('groupType')}
      >
        {availableTypes.map((type) => (
          <option key={type} value={type}>
            {typeLabel(type)}
          </option>
        ))}
      </select>
    ) : availableTypes.length > 1 ? (
      <Segmented
        aria-label={t('groupType')}
        value={activeType}
        onChange={changeType}
        options={availableTypes.map((type) => ({ id: type, label: typeLabel(type) }))}
      />
    ) : null;

  return (
    <Page className="page-groups">
      <PageHeader
        title={t('groups')}
        lead={t('groupsLead')}
        actions={<DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />}
        toolbar={
          noTypes ? undefined : (
            <>
              {typeSwitcher}
              <ResourceSearchField
                value={search}
                onChange={setSearch}
                placeholder={t('groupsSearchPlaceholder')}
                aria-label={t('groupsSearchPlaceholder')}
                className="audience-search"
              />
              <span className="toolbar-spacer" />
              {!initialLoading && !error ? (
                <span className="toolbar-meta" aria-live="polite">
                  {t('audienceGroupCount').replace('{count}', formatNumber(rows.length))}
                </span>
              ) : null}
            </>
          )
        }
      />

      <PageBody>
        <DataViewState
          error={error}
          onRetry={() => (typesQuery.isError ? typesQuery.refetch() : groupsQuery.refetch())}
        >
          {noTypes ? (
            <EmptyState
              variant="rich"
              icon={<Building2 />}
              title={t('groupsEmptyTitle')}
              description={t('groupsEmptyBody')}
            />
          ) : !initialLoading && rows.length === 0 ? (
            debouncedSearch.trim() ? (
              <EmptyState
                variant="rich"
                icon={<SearchX />}
                title={t('audienceNoMatchTitle')}
                description={t('audienceNoMatchBody')}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => setSearch('')}>
                    {t('reset')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                variant="rich"
                icon={<Building2 />}
                title={t('groupsEmptyTitle')}
                description={t('audienceGroupsEmptyPeriod')}
              />
            )
          ) : (
            <SectionCard flush>
              <div className={cn('table-scroll', refreshing && 'audience-refreshing')} aria-busy={refreshing || undefined}>
                <table className="data-table data-table--interactive audience-table">
                  <thead>
                    <tr>
                      <th className="audience-col-identity">{typeLabel(activeType) || t('groups')}</th>
                      {sortHeader('people', t('people'))}
                      {sortHeader('sessions', t('sessions'))}
                      {sortHeader('pageviews', t('pageviews'), 'audience-hide-sm')}
                      {sortHeader('events', t('events'), 'audience-hide-sm')}
                      {sortHeader('lastSeen', t('lastSeen'))}
                    </tr>
                  </thead>
                  <tbody>
                    {initialLoading ? (
                      <TableSkeletonRows columns={6} hideOnPhone={[3, 4]} />
                    ) : (
                      rows.map((group) => {
                        const label = groupLabel(group);
                        return (
                          <tr
                            key={group.groupKey}
                            className={group.groupKey === openGroupKey ? 'active-row' : undefined}
                            onClick={() => setParam('group', group.groupKey)}
                          >
                            <td>
                              <button
                                type="button"
                                className="audience-row-button"
                                aria-label={label}
                                aria-haspopup="dialog"
                              >
                                <span className="audience-identity">
                                  <IdentityAvatar label={label} kind="group" />
                                  <span className="audience-identity-copy">
                                    <span className="audience-identity-title">{label}</span>
                                    {label !== group.groupKey ? (
                                      <span className="audience-identity-sub mono">{group.groupKey}</span>
                                    ) : null}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td className="num">{formatNumber(group.people)}</td>
                            <td className="num">{formatNumber(group.sessions)}</td>
                            <td className="num audience-hide-sm">{formatNumber(group.pageviews)}</td>
                            <td className="num audience-hide-sm">{formatNumber(group.events)}</td>
                            <td className="num text-muted">
                              <RelativeTime value={group.lastSeenAt} />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </DataViewState>
      </PageBody>

      {websiteId && activeType ? (
        <GroupSheet
          websiteId={websiteId}
          groupType={activeType}
          groupKey={openGroupKey}
          summary={openSummary}
          onClose={() => setParam('group', null)}
        />
      ) : null}
    </Page>
  );
}
