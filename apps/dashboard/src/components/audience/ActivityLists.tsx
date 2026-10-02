import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { eventDisplayName } from '../../lib/autocapture';
import { formatNumber, formatRelativeTime, formatShortDateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { countryFlagEmoji, deviceIconKind, formatSessionLocation } from '../../lib/session-display';

export type ActivitySession = {
  id: string;
  distinctId?: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
  createdAt: number | null;
  events: number;
  lastSeenAt: number | null;
};

export type ActivityEvent = {
  id: string;
  sessionId: string;
  urlPath: string | null;
  eventName: string | null;
  eventType: number;
  createdAt: number;
};

function DeviceIcon({ device }: { device: string | null }) {
  const kind = deviceIconKind(device);
  if (kind === 'mobile') return <Smartphone aria-hidden />;
  if (kind === 'tablet') return <Tablet aria-hidden />;
  return <Monitor aria-hidden />;
}

/** Flag + "City, Country" (or the country alone). */
export function LocationLabel({ country, city }: { country: string | null; city: string | null }) {
  if (!country && !city) return <span className="text-muted">{t('unknown')}</span>;
  const flag = countryFlagEmoji(country);
  return (
    <span className="audience-location">
      {flag ? (
        <span className="audience-flag" aria-hidden>
          {flag}
        </span>
      ) : null}
      <span className="truncate-1">{formatSessionLocation(country, city)}</span>
    </span>
  );
}

/** Relative time ("3 min ago") with the full timestamp on hover. */
export function RelativeTime({ value }: { value: number | string | null | undefined }) {
  if (value == null) return <span className="text-muted">-</span>;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return <span className="text-muted">-</span>;
  return (
    <time dateTime={new Date(time).toISOString()} title={formatShortDateTime(time)}>
      {formatRelativeTime(time)}
    </time>
  );
}

/** Recent sessions as hairline rows; each opens the session. */
export function SessionList({
  websiteId,
  sessions,
  limit = 8,
  showDistinctId = false,
}: {
  websiteId: string;
  sessions: ActivitySession[];
  limit?: number;
  showDistinctId?: boolean;
}) {
  return (
    <ul className="audience-rows">
      {sessions.slice(0, limit).map((session) => {
        const tech = [session.browser, session.os].filter(Boolean).join(' · ') || t('unknown');
        return (
          <li key={session.id}>
            <Link to={`/websites/${websiteId}/sessions/${session.id}`} className="audience-row">
              <span className="audience-row-icon">
                <DeviceIcon device={session.device} />
              </span>
              <span className="audience-row-main">
                <span className="audience-row-title">{tech}</span>
                <span className="audience-row-sub">
                  <LocationLabel country={session.country} city={session.city} />
                  {showDistinctId && session.distinctId ? (
                    <span className="mono truncate-1" title={session.distinctId}>
                      {session.distinctId}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="audience-row-meta">
                <span className="num">{t('audienceEventCount').replace('{count}', formatNumber(session.events))}</span>
                <RelativeTime value={session.lastSeenAt ?? session.createdAt} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function eventLabel(event: ActivityEvent): { label: string; mono: boolean } {
  if (event.eventType === 1) return { label: t('audienceEventPageview'), mono: false };
  if (event.eventType === 6) return { label: t('audienceEventClick'), mono: false };
  if (event.eventType === 7) return { label: t('audienceEventScroll'), mono: false };
  if (event.eventType === 8) return { label: t('error'), mono: false };
  const name = eventDisplayName(event.eventName);
  return name ? { label: name, mono: name === event.eventName } : { label: t('unknown'), mono: false };
}

/** Performance beacons repeat every pageview; they are measurements, not activity. */
const PERFORMANCE_EVENT = 5;

/** Recent events, newest first: what happened, where, when. Each opens its session. */
export function EventList({
  websiteId,
  events,
  limit = 25,
  empty,
}: {
  websiteId: string;
  events: ActivityEvent[];
  limit?: number;
  /** Shown when nothing but performance beacons (or nothing at all) was recorded. */
  empty: ReactNode;
}) {
  const activity = events.filter((event) => event.eventType !== PERFORMANCE_EVENT);
  if (!activity.length) return <>{empty}</>;
  return (
    <ul className="audience-rows audience-rows--events">
      {activity.slice(0, limit).map((event) => {
        const { label, mono } = eventLabel(event);
        const isPageview = event.eventType === 1;
        return (
          <li key={event.id}>
            <Link to={`/websites/${websiteId}/sessions/${event.sessionId}`} className="audience-row">
              <span className={isPageview ? 'audience-event-dot' : 'audience-event-dot is-event'} aria-hidden />
              <span className="audience-row-main audience-row-main--inline">
                <span className={mono ? 'audience-row-title mono' : 'audience-row-title'}>{label}</span>
                {event.urlPath ? (
                  <span className="audience-row-path mono truncate-1" title={event.urlPath}>
                    {event.urlPath}
                  </span>
                ) : null}
              </span>
              <span className="audience-row-meta">
                <RelativeTime value={event.createdAt} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
