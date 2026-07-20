import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { SessionAvatar } from '../components/SessionAvatar';
import { SessionTechCell } from '../components/SessionTechCell';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { api } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import {
  countryFlagEmoji,
  formatRelativeTime,
  formatSessionLocation,
} from '../lib/session-display';
import { useWebsiteRange } from '../lib/useWebsiteRange';

interface SessionRow {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
  visits: number;
  pageviews: number;
  events: number;
  lastAt: number;
}

const PAGE_SIZE = 50;

export default function SessionsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
    const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');

  const sessionsQuery = useQuery({
    queryKey: ['sessions', websiteId, range],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{ data: SessionRow[]; count: number }>(
        `/api/websites/${websiteId}/sessions?${rangeQs}&pageSize=${PAGE_SIZE}`,
      ),
  });

  const rows = sessionsQuery.data?.data ?? [];
  const total = sessionsQuery.data?.count ?? rows.length;

  return (
    <div className="page page-sessions">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />
        }
      />

      {sessionsQuery.isLoading ? <div className="skeleton" style={{ height: '4rem' }} /> : null}

      {!sessionsQuery.isLoading && rows.length > 0 ? (
        <section className="panel sessions-panel section-gap">
          <div className="sessions-table-scroll">
            <table className="data-table sessions-data-table">
              <thead>
                <tr>
                  <th className="sessions-col-session">{t('session')}</th>
                  <th className="num">{t('visits')}</th>
                  <th className="num">{t('pageviews')}</th>
                  <th className="num">{t('customEvents')}</th>
                  <th>{t('location')}</th>
                  <th>{t('browser')}</th>
                  <th>{t('os')}</th>
                  <th>{t('device')}</th>
                  <th className="sessions-col-last">{t('lastSeen')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const flag = countryFlagEmoji(s.country);
                  const location = formatSessionLocation(s.country, s.city);
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link
                          to={`/websites/${websiteId}/sessions/${s.id}`}
                          className="sessions-row-link"
                        >
                          <SessionAvatar seed={s.id} size={32} className="sessions-table-avatar" />
                        </Link>
                      </td>
                      <td className="num">{formatNumber(s.visits)}</td>
                      <td className="num">{formatNumber(s.pageviews)}</td>
                      <td className="num">{formatNumber(s.events)}</td>
                      <td>
                        <Link
                          to={`/websites/${websiteId}/sessions/${s.id}`}
                          className="sessions-row-link sessions-location-cell"
                        >
                          {flag ? (
                            <span className="sessions-flag" aria-hidden>
                              {flag}
                            </span>
                          ) : null}
                          <span>{location}</span>
                        </Link>
                      </td>
                      <td>
                        <Link to={`/websites/${websiteId}/sessions/${s.id}`} className="sessions-row-link">
                          <SessionTechCell kind="browser" value={s.browser} />
                        </Link>
                      </td>
                      <td>
                        <Link to={`/websites/${websiteId}/sessions/${s.id}`} className="sessions-row-link">
                          <SessionTechCell kind="os" value={s.os} />
                        </Link>
                      </td>
                      <td>
                        <Link to={`/websites/${websiteId}/sessions/${s.id}`} className="sessions-row-link">
                          <SessionTechCell kind="device" value={s.device} />
                        </Link>
                      </td>
                      <td className="sessions-col-last">
                        <Link
                          to={`/websites/${websiteId}/sessions/${s.id}`}
                          className="sessions-row-link sessions-last-cell"
                          title={formatDateTime(s.lastAt)}
                        >
                          {formatRelativeTime(s.lastAt)}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sessions-footer">
            {t('showingSessionsLimit').replace('{count}', String(Math.min(PAGE_SIZE, total)))}
          </p>
        </section>
      ) : null}

      {!sessionsQuery.isLoading && !rows.length ? (
        <div className="panel empty-state-rich section-gap">
          <EmptyState
            title={t('noSessionsInRange')}
            description={t('noDataInPeriodHint')}
          />
        </div>
      ) : null}
    </div>
  );
}
