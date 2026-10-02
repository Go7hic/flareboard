import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { SearchX, UsersRound } from 'lucide-react';
import { keepPreviousForWebsite } from '../components/audience/keepPrevious';
import { LocationLabel, RelativeTime } from '../components/audience/ActivityLists';
import {
  SortHeader,
  TableSkeletonRows,
  type SortState,
} from '../components/audience/DataTableParts';
import { IdentityAvatar } from '../components/audience/IdentityAvatar';
import { PersonSheet } from '../components/audience/PersonSheet';
import { isIdentified, personIdentity } from '../components/audience/person-identity';
import { Segmented } from '../components/audience/Segmented';
import { DataViewState } from '../components/DataViewState';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { ResourceSearchField } from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { Button } from '../components/ui/button';
import { api, type PeopleResponse, type PersonSummary } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';
import { cn } from '../lib/utils';

/** The people endpoint returns the most recently active people, up to this many. */
const PEOPLE_LIMIT = 100;

type IdentityFilter = 'all' | 'identified' | 'anonymous';
type PeopleSortKey = 'sessions' | 'pageviews' | 'events' | 'lastSeen';

const SORT_VALUE: Record<PeopleSortKey, (person: PersonSummary) => number> = {
  sessions: (person) => person.sessions,
  pageviews: (person) => person.pageviews,
  events: (person) => person.events,
  lastSeen: (person) => person.lastSeenAt ?? 0,
};

function PersonCell({ person }: { person: PersonSummary }) {
  const identity = personIdentity(person);
  return (
    <span className="audience-identity">
      <IdentityAvatar label={identity.avatarLabel} anonymous={!identity.avatarLabel} />
      <span className="audience-identity-copy">
        <span className={cn('audience-identity-title', !identity.identified && 'is-anonymous')}>
          {identity.title}
        </span>
        {identity.subtitle ? (
          <span
            className={cn('audience-identity-sub', identity.subtitleIsId && 'mono')}
            title={person.personId}
          >
            {identity.subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export default function WebsitePeoplePage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '30d');
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const [search, setSearch] = useState('');
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>('all');
  const [sort, setSort] = useState<SortState<PeopleSortKey>>({ key: 'lastSeen', direction: 'desc' });
  const debouncedSearch = useDebouncedValue(search, 300);
  const openPersonId = searchParams.get('person');

  const peopleQuery = useQuery({
    queryKey: ['people', websiteId, rangeQs, debouncedSearch],
    enabled: Boolean(websiteId),
    // Typing a search or changing the range keeps the current rows until the new ones arrive.
    placeholderData: keepPreviousForWebsite(websiteId),
    queryFn: () => {
      const params = new URLSearchParams(rangeQs);
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
      return api<PeopleResponse>(`/api/websites/${websiteId}/people?${params.toString()}`);
    },
  });

  const people = peopleQuery.data?.people ?? [];
  const rows = useMemo(() => {
    const filtered =
      identityFilter === 'all'
        ? people
        : people.filter((person) => isIdentified(person) === (identityFilter === 'identified'));
    const value = SORT_VALUE[sort.key];
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => sign * (value(a) - value(b)));
  }, [people, identityFilter, sort]);

  const filtersActive = Boolean(debouncedSearch.trim()) || identityFilter !== 'all';
  const initialLoading = peopleQuery.isLoading && !peopleQuery.data;
  const refreshing = peopleQuery.isFetching && peopleQuery.isPlaceholderData;
  const openSummary = openPersonId ? people.find((person) => person.personId === openPersonId) : undefined;

  function openPerson(personId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('person', personId);
    setSearchParams(next, { replace: true });
  }

  function closePerson() {
    const next = new URLSearchParams(searchParams);
    next.delete('person');
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setSearch('');
    setIdentityFilter('all');
  }

  const sortHeader = (key: PeopleSortKey, label: string, className?: string) => (
    <SortHeader label={label} sortKey={key} sort={sort} onSort={setSort} numeric className={className} />
  );

  return (
    <Page className="page-people">
      <PageHeader
        title={t('people')}
        lead={t('peopleLead')}
        actions={<DateRangePicker value={range} onChange={setRange} popover timezone={timezone} />}
        toolbar={
          <>
            <ResourceSearchField
              value={search}
              onChange={setSearch}
              placeholder={t('peopleSearchPlaceholder')}
              aria-label={t('peopleSearchPlaceholder')}
              className="audience-search"
            />
            <Segmented
              aria-label={t('audienceIdentityFilter')}
              value={identityFilter}
              onChange={setIdentityFilter}
              options={[
                { id: 'all', label: t('all') },
                { id: 'identified', label: t('audienceFilterIdentified') },
                { id: 'anonymous', label: t('audienceFilterAnonymous') },
              ]}
            />
            <span className="toolbar-spacer" />
            {!initialLoading && !peopleQuery.isError ? (
              <span className="toolbar-meta" aria-live="polite">
                {t('audiencePeopleCount').replace('{count}', formatNumber(rows.length))}
              </span>
            ) : null}
          </>
        }
      />

      <PageBody>
        <DataViewState
          error={peopleQuery.isError && !peopleQuery.data ? peopleQuery.error : null}
          onRetry={() => peopleQuery.refetch()}
        >
          {!initialLoading && rows.length === 0 ? (
            filtersActive ? (
              <EmptyState
                variant="rich"
                icon={<SearchX />}
                title={t('audienceNoMatchTitle')}
                description={t('audienceNoMatchBody')}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                    {t('reset')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                variant="rich"
                icon={<UsersRound />}
                title={t('peopleEmptyTitle')}
                description={t('peopleEmptyBody')}
              />
            )
          ) : (
            <SectionCard
              flush
              footer={
                people.length >= PEOPLE_LIMIT ? (
                  <span>{t('audiencePeopleLimitHint').replace('{count}', formatNumber(PEOPLE_LIMIT))}</span>
                ) : undefined
              }
            >
              <div className={cn('table-scroll', refreshing && 'audience-refreshing')} aria-busy={refreshing || undefined}>
                <table className="data-table data-table--interactive audience-table">
                  <thead>
                    <tr>
                      <th className="audience-col-identity">{t('audiencePerson')}</th>
                      <th className="audience-col-location audience-hide-sm">{t('location')}</th>
                      {sortHeader('sessions', t('sessions'))}
                      {sortHeader('pageviews', t('pageviews'), 'audience-hide-sm')}
                      {sortHeader('events', t('events'), 'audience-hide-sm')}
                      {sortHeader('lastSeen', t('lastSeen'))}
                    </tr>
                  </thead>
                  <tbody>
                    {initialLoading ? (
                      <TableSkeletonRows columns={6} hideOnPhone={[1, 3, 4]} />
                    ) : (
                      rows.map((person) => (
                        <tr
                          key={person.personId}
                          className={person.personId === openPersonId ? 'active-row' : undefined}
                          onClick={() => openPerson(person.personId)}
                        >
                          <td>
                            <button
                              type="button"
                              className="audience-row-button"
                              aria-label={personIdentity(person).title}
                              aria-haspopup="dialog"
                            >
                              <PersonCell person={person} />
                            </button>
                          </td>
                          <td className="audience-col-location audience-hide-sm">
                            <LocationLabel country={person.country} city={person.city} />
                          </td>
                          <td className="num">{formatNumber(person.sessions)}</td>
                          <td className="num audience-hide-sm">{formatNumber(person.pageviews)}</td>
                          <td className="num audience-hide-sm">{formatNumber(person.events)}</td>
                          <td className="num text-muted">
                            <RelativeTime value={person.lastSeenAt} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </DataViewState>
      </PageBody>

      {websiteId ? (
        <PersonSheet
          websiteId={websiteId}
          personId={openPersonId}
          summary={openSummary}
          canEdit={canEdit}
          onClose={closePerson}
        />
      ) : null}
    </Page>
  );
}
