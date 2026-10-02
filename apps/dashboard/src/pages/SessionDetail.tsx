import { useQuery } from '@tanstack/react-query';
import { CirclePlay, History, UserX } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { KvList } from '../components/KvList';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { SessionAvatar } from '../components/SessionAvatar';
import { countLabel, relativeLabel } from '../components/traffic/format';
import {
  SessionTimeline,
  summarizeVisits,
  type SessionActivityRow,
  type SessionContextItem,
} from '../components/traffic/SessionTimeline';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatDurationSeconds, formatNumber, formatShortDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';
import { countryFlagEmoji, formatDeviceLabel, formatSessionLocation } from '../lib/session-display';

interface SessionDetail {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  screen?: string | null;
  country: string | null;
  region?: string | null;
  city: string | null;
  language: string | null;
  distinctId: string | null;
  createdAt: number;
}

type SessionReplay = { visitId: string; startedAt: number; endedAt: number; eventCount: number; chunks: number };

/** Custom events, link/pixel hits and signals; not pageviews or telemetry (matches the list). */
const NON_EVENT_TYPES = new Set([1, 5, 6, 7]);

function DetailSkeleton() {
  return (
    <div className="stack" aria-hidden>
      <KpiStripSkeleton cells={4} />
      <div className="layout-grid">
        <div className="panel span-8">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="mb-3 h-6 w-full" />
          ))}
        </div>
        <div className="panel span-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="mb-3 h-5 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SessionDetailPage() {
  const { websiteId, sessionId } = useParams<{ websiteId: string; sessionId: string }>();
  const enabled = Boolean(websiteId && sessionId);
  const base = `/api/websites/${websiteId}/sessions/${sessionId}`;

  const sessionQuery = useQuery({
    queryKey: ['session', websiteId, sessionId],
    enabled,
    queryFn: () => api<SessionDetail>(base),
  });

  const activityQuery = useQuery({
    queryKey: ['session-activity', websiteId, sessionId],
    enabled,
    queryFn: () => api<SessionActivityRow[]>(`${base}/activity`),
  });

  const contextQuery = useQuery({
    queryKey: ['session-context', websiteId, sessionId],
    enabled,
    queryFn: () => api<SessionContextItem[]>(`${base}/context`),
  });

  const propsQuery = useQuery({
    queryKey: ['session-props', websiteId, sessionId],
    enabled,
    queryFn: () => api<Array<{ key: string; value: string }>>(`${base}/properties`),
  });

  const replaysQuery = useQuery({
    queryKey: ['session-replays', websiteId, sessionId],
    enabled,
    queryFn: () => api<SessionReplay[]>(`${base}/replays`),
  });

  const session = sessionQuery.data;
  const activity = useMemo(() => activityQuery.data ?? [], [activityQuery.data]);
  const visits = useMemo(() => summarizeVisits(activity), [activity]);

  const stats = useMemo(() => {
    const pageviews = activity.filter((row) => row.eventType === 1);
    return {
      duration: visits.reduce((sum, visit) => sum + (visit.end - visit.start), 0) / 1000,
      pageviews: pageviews.length,
      uniquePages: new Set(pageviews.map((row) => row.urlPath)).size,
      events: activity.filter((row) => row.eventType !== undefined && !NON_EVENT_TYPES.has(row.eventType)).length,
      lastSeen: activity.reduce((max, row) => Math.max(max, row.createdAt), 0),
    };
  }, [activity, visits]);

  const latestReplay = replaysQuery.data?.[0];
  const identity = session?.distinctId || t('trafficVisitorTitle').replace('{id}', (sessionId ?? '').slice(0, 8));
  const location = session ? formatSessionLocation(session.country, session.city) : '';
  const flag = countryFlagEmoji(session?.country);
  const tech = session ? [session.browser, session.os].filter(Boolean).join(' · ') : '';
  const lead = session ? [location, tech, formatDeviceLabel(session.device)].filter(Boolean).join(' · ') : undefined;
  const notFound = sessionQuery.error instanceof ApiError && sessionQuery.error.status === 404;

  const details = session
    ? [
        {
          key: 'location',
          label: t('location'),
          value: (
            <span className="traffic-location-cell">
              {flag ? (
                <span className="traffic-flag" aria-hidden>
                  {flag}
                </span>
              ) : null}
              <span>
                {[
                  session.city,
                  session.region && session.region !== session.city ? session.region : null,
                  session.country ? getCountryLabel(session.country) : t('unknown'),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </span>
          ),
        },
        { key: 'device', label: t('device'), value: formatDeviceLabel(session.device) },
        { key: 'browser', label: t('browser'), value: session.browser || t('unknown') },
        { key: 'os', label: t('os'), value: session.os || t('unknown') },
        ...(session.screen ? [{ key: 'screen', label: t('trafficScreen'), value: session.screen }] : []),
        { key: 'language', label: t('languageLabel'), value: session.language || t('unknown') },
        {
          key: 'distinct',
          label: t('distinctId'),
          value: session.distinctId ? <span className="mono">{session.distinctId}</span> : <span className="text-muted">-</span>,
        },
        {
          key: 'first',
          label: t('firstSeen'),
          value: <span title={formatDateTime(session.createdAt)}>{formatShortDateTime(session.createdAt)}</span>,
        },
        ...(stats.lastSeen
          ? [
              {
                key: 'last',
                label: t('lastSeen'),
                value: (
                  <span title={formatDateTime(stats.lastSeen)}>
                    {formatShortDateTime(stats.lastSeen)} <span className="text-muted">· {relativeLabel(stats.lastSeen)}</span>
                  </span>
                ),
              },
            ]
          : []),
        {
          key: 'session',
          label: t('trafficSessionId'),
          value: <span className="mono traffic-break">{session.id}</span>,
        },
      ]
    : [];

  return (
    <Page className="page-session-detail">
      <PageHeader
        backTo={websiteId ? `/websites/${websiteId}/sessions` : undefined}
        backLabel={t('sessions')}
        title={
          <span className="traffic-visitor-title">
            {sessionId ? <SessionAvatar seed={sessionId} size={32} /> : null}
            <span className={session?.distinctId ? undefined : 'mono'}>{identity}</span>
          </span>
        }
        lead={lead}
        actions={
          latestReplay && websiteId ? (
            <Button asChild variant="outline">
              <Link to={`/websites/${websiteId}/replays?visit=${encodeURIComponent(latestReplay.visitId)}`}>
                <CirclePlay aria-hidden />
                {t('trafficWatchReplay')}
              </Link>
            </Button>
          ) : null
        }
      />

      <PageBody className="stack">
        {notFound ? (
          <EmptyState
            variant="rich"
            icon={<UserX />}
            title={t('trafficSessionNotFound')}
            description={t('trafficSessionNotFoundBody')}
            action={
              <Button asChild variant="outline">
                <Link to={`/websites/${websiteId}/sessions`}>{t('sessions')}</Link>
              </Button>
            }
          />
        ) : (
          <DataViewState
            loading={(sessionQuery.isLoading || activityQuery.isLoading) && !session}
            error={sessionQuery.error ?? activityQuery.error ?? null}
            onRetry={() => {
              sessionQuery.refetch();
              activityQuery.refetch();
            }}
            loadingFallback={<DetailSkeleton />}
          >
            <KpiStrip columns={4}>
              <KpiCell
                label={t('trafficDuration')}
                value={formatDurationSeconds(stats.duration)}
                hint={visits.length > 1 ? countLabel('trafficAcrossVisits', visits.length) : undefined}
              />
              <KpiCell
                label={t('pageviews')}
                value={formatNumber(stats.pageviews)}
                hint={stats.uniquePages ? countLabel('trafficUniquePages', stats.uniquePages) : undefined}
              />
              <KpiCell label={t('events')} value={formatNumber(stats.events)} />
              <KpiCell
                label={t('visits')}
                value={formatNumber(visits.length)}
                hint={
                  visits.length > 1 && session
                    ? t('trafficFirstSeenAgo').replace('{time}', relativeLabel(session.createdAt))
                    : undefined
                }
              />
            </KpiStrip>

            <div className="layout-grid traffic-session-grid">
              <SectionCard
                className="span-8"
                title={t('trafficTimeline')}
                description={t('trafficTimelineLead')}
                actions={
                  visits.length > 1 ? (
                    <span className="toolbar-meta">{countLabel('trafficVisits', visits.length)}</span>
                  ) : undefined
                }
              >
                {contextQuery.isLoading ? (
                  <div className="traffic-skeleton-rows" aria-hidden>
                    {Array.from({ length: 6 }, (_, index) => (
                      <Skeleton key={index} className="h-7 w-full" />
                    ))}
                  </div>
                ) : contextQuery.data?.length && websiteId && sessionId ? (
                  <SessionTimeline
                    websiteId={websiteId}
                    sessionId={sessionId}
                    items={contextQuery.data}
                    activity={activity}
                    visits={visits}
                  />
                ) : (
                  <EmptyState icon={<History />} title={t('sessionContextEmpty')} />
                )}
              </SectionCard>

              <div className="span-4 stack traffic-session-side">
                <SectionCard title={t('trafficVisitor')}>
                  <KvList compact items={details} className="traffic-kv" />
                </SectionCard>
                {propsQuery.data?.length ? (
                  <SectionCard title={t('properties')} description={t('trafficSessionPropertiesLead')}>
                    <KvList
                      compact
                      className="traffic-kv"
                      items={propsQuery.data.map((property) => ({
                        key: property.key,
                        label: <span className="mono">{property.key}</span>,
                        value: property.value,
                      }))}
                    />
                  </SectionCard>
                ) : null}
              </div>
            </div>
          </DataViewState>
        )}
      </PageBody>
    </Page>
  );
}
