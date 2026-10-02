import { useQuery } from '@tanstack/react-query';
import { api, type GroupDetailResponse, type GroupRow } from '../../lib/api';
import { formatNumber, formatShortDate, identityPrimary } from '../../lib/format';
import { t } from '../../lib/i18n';
import { DataViewState } from '../DataViewState';
import { KpiCell, KpiStrip } from '../KpiStrip';
import { KvList } from '../KvList';
import { EventList, RelativeTime, SessionList } from './ActivityLists';
import { DetailSection, DetailSectionSkeleton, DetailSheet, DetailSheetHeader } from './DetailSheet';
import { IdentityAvatar } from './IdentityAvatar';

export function groupLabel(group: Pick<GroupRow, 'latestName' | 'groupKey'>) {
  return identityPrimary([group.latestName], group.groupKey);
}

/** Group detail in a side sheet: period numbers, group properties, sessions, activity. */
export function GroupSheet({
  websiteId,
  groupType,
  groupKey,
  summary,
  onClose,
}: {
  websiteId: string;
  groupType: string;
  groupKey: string | null;
  /** The group's row from the list (period counts); absent for a deep link outside the list. */
  summary?: GroupRow;
  onClose: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ['group-detail', websiteId, groupType, groupKey],
    enabled: Boolean(groupKey && groupType),
    queryFn: () =>
      api<GroupDetailResponse>(
        `/api/websites/${websiteId}/groups/${encodeURIComponent(groupType)}/${encodeURIComponent(groupKey!)}`,
      ),
  });

  const title = summary ? groupLabel(summary) : groupKey ?? '';
  const properties = detailQuery.data?.properties ?? [];
  const sessions = detailQuery.data?.sessions ?? [];
  const events = detailQuery.data?.events ?? [];
  const loading = detailQuery.isLoading;

  return (
    <DetailSheet open={Boolean(groupKey)} onClose={onClose} label={title}>
      <DetailSheetHeader
        leading={<IdentityAvatar label={title} kind="group" size="lg" />}
        title={title}
        subtitle={
          <span>
            {groupType} · <span className="mono">{groupKey}</span>
          </span>
        }
        meta={
          summary ? (
            <>
              {summary.firstSeenAt ? (
                <span>{t('audienceFirstSeenOn').replace('{date}', formatShortDate(summary.firstSeenAt))}</span>
              ) : null}
              {summary.lastSeenAt ? (
                <span>
                  {t('lastSeen')} <RelativeTime value={summary.lastSeenAt} />
                </span>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="audience-sheet-body">
        {summary ? (
          <KpiStrip inline columns={4}>
            <KpiCell label={t('people')} value={formatNumber(summary.people)} />
            <KpiCell label={t('sessions')} value={formatNumber(summary.sessions)} />
            <KpiCell label={t('pageviews')} value={formatNumber(summary.pageviews)} />
            <KpiCell label={t('events')} value={formatNumber(summary.events)} />
          </KpiStrip>
        ) : null}

        <DataViewState
          error={detailQuery.isError ? detailQuery.error : null}
          onRetry={() => detailQuery.refetch()}
        >
          <DetailSection title={t('groupProperties')} description={t('groupPropertiesLead')}>
            {loading ? (
              <DetailSectionSkeleton lines={3} />
            ) : properties.length ? (
              <KvList
                compact
                className="audience-kv"
                items={properties.map((property) => ({
                  key: property.key,
                  label: (
                    <span className="mono" title={property.key}>
                      {property.key}
                    </span>
                  ),
                  value: property.value ?? <span className="text-muted">-</span>,
                }))}
              />
            ) : (
              <p className="audience-section-empty">{t('groupsNoProperties')}</p>
            )}
          </DetailSection>

          <DetailSection title={t('audienceRecentSessions')}>
            {loading ? (
              <DetailSectionSkeleton lines={3} />
            ) : sessions.length ? (
              <SessionList websiteId={websiteId} sessions={sessions} showDistinctId />
            ) : (
              <p className="audience-section-empty">{t('audienceNoSessions')}</p>
            )}
          </DetailSection>

          <DetailSection title={t('audienceRecentActivity')}>
            {loading ? (
              <DetailSectionSkeleton lines={5} />
            ) : (
              <EventList
                websiteId={websiteId}
                events={events}
                empty={<p className="audience-section-empty">{t('groupsNoEvents')}</p>}
              />
            )}
          </DetailSection>
        </DataViewState>
      </div>
    </DetailSheet>
  );
}
