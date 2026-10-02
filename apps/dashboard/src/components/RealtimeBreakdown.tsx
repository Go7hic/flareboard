import { Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RealtimeSession, RealtimeWindow30 } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { getCountryLabel } from '../lib/map-format';
import { countryFlagEmoji } from '../lib/session-display';
import { BreakdownList, type BreakdownItem } from './BreakdownList';
import { EmptyState } from './EmptyState';
import { SectionCard } from './SectionCard';
import { SessionAvatar } from './SessionAvatar';
import { RelativeTime } from './traffic/RelativeTime';

const LIST_LIMIT = 8;
const FEED_LIMIT = 8;

export type RankRow = { key: string; label: string; count: number };

function rank(values: string[], limit: number): RankRow[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, label: key, count }));
}

export function topPages(sessions: RealtimeSession[], limit = LIST_LIMIT): RankRow[] {
  return rank(
    sessions.map((session) => session.urlPath?.trim() || '/'),
    limit,
  );
}

function topReferrers(sessions: RealtimeSession[]): RankRow[] {
  return rank(
    sessions.map((session) => session.referrerDomain?.trim() || t('realtimeGlobeDirect')),
    LIST_LIMIT,
  );
}

function topCountries(sessions: RealtimeSession[]): RankRow[] {
  return rank(
    sessions.filter((session) => session.country).map((session) => session.country!.toUpperCase()),
    LIST_LIMIT,
  ).map((row) => ({ ...row, label: getCountryLabel(row.key) }));
}

function items(rows: RankRow[], options: { mono?: boolean; flags?: boolean } = {}): BreakdownItem[] {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return rows.map((row) => {
    const flag = options.flags ? countryFlagEmoji(row.key) : '';
    return {
      id: row.key,
      label: row.label,
      title: row.label,
      mono: options.mono,
      icon: flag ? (
        <span className="traffic-flag" aria-hidden>
          {flag}
        </span>
      ) : undefined,
      share: row.count / max,
      values: [formatNumber(row.count)],
    };
  });
}

/**
 * Where the people online right now are: current page, referrer and country, ranked
 * (console v2 breakdown cards). Counts are sessions active in the last five minutes.
 */
export function RealtimeBreakdown({ sessions }: { sessions: RealtimeSession[] }) {
  const columns = [{ label: t('visitors') }];
  const countries = topCountries(sessions);
  return (
    <>
      <SectionCard className="span-4" title={t('realtimeLivePages')}>
        <BreakdownList labelHeader={t('page')} columns={columns} items={items(topPages(sessions), { mono: true })} />
      </SectionCard>
      <SectionCard className="span-4" title={t('realtimeLiveReferrers')}>
        <BreakdownList
          labelHeader={t('trafficReferrer')}
          columns={columns}
          items={items(topReferrers(sessions))}
        />
      </SectionCard>
      <SectionCard className="span-4" title={t('realtimeLiveCountries')}>
        {countries.length ? (
          <BreakdownList
            labelHeader={t('country')}
            columns={columns}
            items={items(countries, { flags: true })}
          />
        ) : (
          <p className="traffic-section-empty">{t('realtimeGlobeLocationUnknown')}</p>
        )}
      </SectionCard>
    </>
  );
}

/** The most recently active sessions, newest first, each linking to its session page. */
export function RealtimeLiveFeed({
  websiteId,
  sessions,
  visitors,
  window30,
  className,
}: {
  websiteId: string;
  sessions: RealtimeSession[];
  visitors: number;
  window30?: RealtimeWindow30;
  className?: string;
}) {
  const recent = [...sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, FEED_LIMIT);
  const more = Math.max(0, visitors - recent.length);

  return (
    <SectionCard
      flush
      className={className}
      title={t('realtimeRecentSessions')}
      description={t('trafficLast5Min')}
      footer={more ? <span>{t('trafficMoreOnline').replace('{count}', formatNumber(more))}</span> : undefined}
    >
      {recent.length ? (
        <ul className="traffic-live-feed">
          {recent.map((session) => {
            const flag = countryFlagEmoji(session.country);
            const where = session.country ? getCountryLabel(session.country) : t('unknown');
            const source = session.referrerDomain?.trim() || t('realtimeGlobeDirect');
            return (
              <li key={session.sessionId}>
                <Link
                  to={`/websites/${websiteId}/sessions/${session.sessionId}`}
                  className="traffic-live-feed-row"
                  aria-label={t('realtimeOpenSession').replace('{path}', session.urlPath || '/')}
                >
                  <SessionAvatar seed={session.sessionId} size={28} />
                  <span className="traffic-live-feed-main">
                    <span className="traffic-live-feed-path mono" title={session.urlPath || '/'}>
                      {session.urlPath || '/'}
                    </span>
                    <span className="traffic-live-feed-meta">
                      {flag ? <span aria-hidden>{flag}</span> : null}
                      <span>{where}</span>
                      <span>· {source}</span>
                    </span>
                  </span>
                  <RelativeTime value={session.createdAt} className="traffic-live-feed-time" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          className="traffic-live-empty"
          icon={<Radio />}
          title={t('realtimeEmptyTitle')}
          description={
            window30 && window30.pageviews > 0
              ? t('trafficRealtimeEmptyRecent')
                  .replace('{pageviews}', formatNumber(window30.pageviews))
                  .replace('{visitors}', formatNumber(window30.visitors))
              : t('realtimeEmptyHint')
          }
        />
      )}
    </SectionCard>
  );
}
