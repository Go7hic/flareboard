import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EventCatalogDetailResponse, type EventCatalogRow } from '../../lib/api';
import { describeBuiltinEvent, eventDisplayName } from '../../lib/autocapture';
import { formatDateTime, formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { BreakdownList } from '../BreakdownList';
import { EmptyState } from '../EmptyState';
import { KpiCell, KpiStrip } from '../KpiStrip';
import { MasterDetailPane } from '../master-detail';
import { Skeleton } from '../ui/skeleton';
import { DetailSection } from './DetailSection';
import { formatShare, relativeLabel } from './format';
import { RelativeTime } from './RelativeTime';
import { ShowMoreToggle } from './ShowMoreToggle';
import { bucketKeys, bucketLabel, fillSeries, seriesUnitForRange, type SeriesPoint } from './series';
import { TrendAreaChart } from './TrendAreaChart';

type RecentEvent = EventCatalogDetailResponse['recent'][number];

const SAMPLE_VALUES = 3;
const PATH_ROWS = 8;
const RECENT_ROWS = 10;

/** Readable text for built-in events; otherwise the first few properties, people's keys before `$` ones. */
function recentDetails(eventName: string, properties: RecentEvent['properties']) {
  const builtin = describeBuiltinEvent(eventName, properties);
  if (builtin) return builtin;
  const filled = (properties ?? []).filter((p) => p.value != null && p.value !== '');
  const own = filled.filter((p) => !p.key.startsWith('$'));
  const shown = (own.length ? own : filled).slice(0, 3).map((p) => `${p.key}: ${p.value}`);
  return shown.length ? shown.join(' · ') : '-';
}

/** Most frequent values per property among the recent examples (data the detail call already returns). */
function sampleValues(recent: RecentEvent[] | undefined) {
  const byKey = new Map<string, Map<string, number>>();
  for (const event of recent ?? []) {
    for (const property of event.properties ?? []) {
      if (property.value == null || property.value === '') continue;
      const counts = byKey.get(property.key) ?? new Map<string, number>();
      counts.set(property.value, (counts.get(property.value) ?? 0) + 1);
      byKey.set(property.key, counts);
    }
  }
  const result = new Map<string, { values: string[]; more: number }>();
  for (const [key, counts] of byKey) {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    result.set(key, {
      values: sorted.slice(0, SAMPLE_VALUES).map(([value]) => value),
      more: Math.max(0, sorted.length - SAMPLE_VALUES),
    });
  }
  return result;
}

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="traffic-skeleton-rows" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function EventDetail({
  websiteId,
  event,
  rangeQs,
  startAt,
  endAt,
  timezone,
  totalVisits,
}: {
  websiteId: string;
  event: EventCatalogRow;
  rangeQs: string;
  startAt: number;
  endAt: number;
  timezone: string;
  totalVisits: number | undefined;
}) {
  const eventName = event.eventName;
  const unit = seriesUnitForRange(startAt, endAt) === 'hour' ? 'hour' : 'day';

  const detailQuery = useQuery({
    queryKey: ['event-catalog-detail', websiteId, eventName, rangeQs],
    // A new range keeps this event's numbers on screen; another event remounts (key) instead.
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<EventCatalogDetailResponse>(
        `/api/websites/${websiteId}/events/catalog/${encodeURIComponent(eventName)}?${rangeQs}`,
      ),
  });

  const seriesQuery = useQuery({
    queryKey: ['event-series', websiteId, eventName, rangeQs, unit],
    queryFn: () =>
      api<SeriesPoint[]>(
        `/api/websites/${websiteId}/events/series?event=${encodeURIComponent(eventName)}&${rangeQs}&unit=${unit}`,
      ),
  });

  const detail = detailQuery.data;
  const summary = detail?.summary ?? event;
  const builtin = eventDisplayName(eventName) !== eventName;
  const share = totalVisits ? summary.visits / totalVisits : null;

  const trend = useMemo(() => {
    if (!seriesQuery.data) return [];
    const keys = bucketKeys(startAt, endAt, unit, timezone);
    return fillSeries(seriesQuery.data, keys).map((point) => ({
      label: bucketLabel(point.x, unit, timezone),
      value: point.y,
    }));
  }, [seriesQuery.data, startAt, endAt, unit, timezone]);

  const samples = useMemo(() => sampleValues(detail?.recent), [detail?.recent]);
  const [allPaths, setAllPaths] = useState(false);
  const [allRecent, setAllRecent] = useState(false);
  const paths = detail?.paths ?? [];
  const recentRows = detail?.recent ?? [];
  const maxPathEvents = Math.max(1, ...(detail?.paths ?? []).map((path) => path.events));

  return (
    <MasterDetailPane
      title={<span className={cn(!builtin && 'traffic-mono-title')}>{eventDisplayName(eventName)}</span>}
      meta={
        <>
          {builtin ? <span className="mono">{eventName}</span> : null}
          {summary.firstSeenAt ? (
            <span title={formatDateTime(summary.firstSeenAt)}>
              {t('trafficFirstSeenAgo').replace('{time}', relativeLabel(summary.firstSeenAt))}
            </span>
          ) : null}
          {summary.lastSeenAt ? (
            <span title={formatDateTime(summary.lastSeenAt)}>
              {t('trafficLastSeenAgo').replace('{time}', relativeLabel(summary.lastSeenAt))}
            </span>
          ) : null}
        </>
      }
    >
      <KpiStrip inline columns={4}>
        <KpiCell label={t('events')} value={formatNumber(summary.events)} />
        <KpiCell label={t('sessions')} value={formatNumber(summary.sessions)} />
        <KpiCell label={t('visits')} value={formatNumber(summary.visits)} />
        <KpiCell
          label={t('trafficShareOfVisits')}
          value={formatShare(share)}
          hint={
            totalVisits
              ? t('trafficShareOfVisitsHint')
                  .replace('{visits}', formatNumber(summary.visits))
                  .replace('{total}', formatNumber(totalVisits))
              : undefined
          }
        />
      </KpiStrip>

      <DetailSection
        title={t('trafficEventsOverTime')}
        description={unit === 'hour' ? t('trafficPerHour') : t('trafficPerDay')}
      >
        {seriesQuery.isLoading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : trend.length > 1 ? (
          <TrendAreaChart data={trend} name={t('events')} height={180} />
        ) : (
          <EmptyState title={t('noDataInPeriod')} />
        )}
      </DetailSection>

      <DetailSection title={t('eventCatalogProperties')} description={t('eventCatalogPropertiesLead')}>
        {detailQuery.isLoading ? (
          <SectionSkeleton />
        ) : detail?.properties.length ? (
          <div className="table-scroll">
            <table className="data-table traffic-compact-table traffic-properties-table">
              <thead>
                <tr>
                  <th>{t('trafficProperty')}</th>
                  <th className="num">{t('trafficCoverage')}</th>
                  <th className="num">{t('trafficDistinctValues')}</th>
                  <th>{t('trafficRecentValues')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.properties.map((property) => {
                  const coverage = summary.events ? Math.min(1, property.count / summary.events) : 0;
                  const sample = samples.get(property.key);
                  return (
                    <tr key={property.key}>
                      <td>
                        <span className="mono traffic-cell-truncate" title={property.key}>
                          {property.key}
                        </span>
                      </td>
                      <td className="num">
                        <span className="traffic-coverage">
                          <span className="traffic-coverage-track" aria-hidden>
                            <span className="traffic-coverage-fill" style={{ width: `${coverage * 100}%` }} />
                          </span>
                          {formatShare(coverage)}
                        </span>
                      </td>
                      <td className="num">{formatNumber(property.valuesCount)}</td>
                      <td>
                        {sample?.values.length ? (
                          <span className="traffic-chips" title={sample.values.join(', ')}>
                            {sample.values.map((value) => (
                              <span key={value} className="traffic-chip mono">
                                {value}
                              </span>
                            ))}
                            {sample.more ? <span className="traffic-chip-more">+{formatNumber(sample.more)}</span> : null}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="traffic-section-empty">{t('eventCatalogNoProperties')}</p>
        )}
      </DetailSection>

      <DetailSection title={t('eventCatalogPaths')} description={t('eventCatalogPathsLead')}>
        {detailQuery.isLoading ? (
          <SectionSkeleton />
        ) : paths.length ? (
          <>
          <BreakdownList
            labelHeader={t('page')}
            columns={[{ label: t('events') }, { label: t('sessions') }]}
            items={(allPaths ? paths : paths.slice(0, PATH_ROWS)).map((path) => ({
              id: path.path ?? '(none)',
              label: path.path || '-',
              title: path.path || undefined,
              mono: true,
              share: path.events / maxPathEvents,
              values: [formatNumber(path.events), formatNumber(path.sessions)],
            }))}
          />
          {paths.length > PATH_ROWS ? (
            <ShowMoreToggle expanded={allPaths} total={paths.length} onToggle={() => setAllPaths((value) => !value)} />
          ) : null}
          </>
        ) : (
          <p className="traffic-section-empty">{t('eventCatalogNoPaths')}</p>
        )}
      </DetailSection>

      <DetailSection title={t('eventCatalogRecent')} description={t('eventCatalogRecentLead')}>
        {detailQuery.isLoading ? (
          <SectionSkeleton rows={4} />
        ) : recentRows.length ? (
          <>
          <div className="table-scroll">
            <table className="data-table traffic-compact-table">
              <thead>
                <tr>
                  <th className="traffic-col-time">{t('trafficTime')}</th>
                  <th>{t('eventCatalogDetails')}</th>
                  <th>{t('page')}</th>
                  <th className="traffic-col-session">{t('session')}</th>
                </tr>
              </thead>
              <tbody>
                {(allRecent ? recentRows : recentRows.slice(0, RECENT_ROWS)).map((recent) => (
                  <tr key={recent.id}>
                    <td className="traffic-col-time">
                      <RelativeTime value={recent.createdAt} format="short" className="text-muted" />
                    </td>
                    <td>
                      <span className="traffic-cell-truncate" title={recentDetails(eventName, recent.properties)}>
                        {recentDetails(eventName, recent.properties)}
                      </span>
                    </td>
                    <td>
                      <span className="mono traffic-cell-truncate text-muted" title={recent.urlPath || undefined}>
                        {recent.urlPath || '-'}
                      </span>
                    </td>
                    <td className="traffic-col-session">
                      <Link
                        to={`/websites/${websiteId}/sessions/${recent.sessionId}`}
                        className="traffic-id-link mono"
                        title={recent.sessionId}
                      >
                        {recent.sessionId.slice(0, 8)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recentRows.length > RECENT_ROWS ? (
            <ShowMoreToggle expanded={allRecent} total={recentRows.length} onToggle={() => setAllRecent((value) => !value)} />
          ) : null}
          </>
        ) : (
          <p className="traffic-section-empty">{t('eventCatalogNoRecent')}</p>
        )}
      </DetailSection>
    </MasterDetailPane>
  );
}
