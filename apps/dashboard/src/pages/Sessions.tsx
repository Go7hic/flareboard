import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { api, getToken } from '../lib/api';
import { t } from '../lib/i18n';
import { SessionAvatar } from '../components/SessionAvatar';
import { useWebsiteRange } from '../lib/useWebsiteRange';

interface SessionRow {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
  views: number;
  lastAt: number;
}

const PAGE_SIZE = 50;

export default function SessionsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const { range, setRange, rangeQs } = useWebsiteRange(websiteId, '24h');

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

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
          <WebsiteDateExportControls range={range} onRangeChange={setRange} />
        }
      />

      {sessionsQuery.isLoading ? <div className="skeleton" style={{ height: '4rem' }} /> : null}

      {!sessionsQuery.isLoading && rows.length > 0 ? (
        <section className="panel sessions-panel section-gap">
          <div className="sessions-table-head" aria-hidden>
            <span />
            <span>{t('location')}</span>
            <span>{t('device')}</span>
            <span>{t('when')}</span>
          </div>
          {rows.map((s) => (
            <Link
              key={s.id}
              to={`/websites/${websiteId}/sessions/${s.id}`}
              className="sessions-table-row"
            >
              <SessionAvatar seed={s.id} size={32} className="sessions-table-avatar" />
              <span>
                <strong>{s.country ?? t('unknown')}</strong>
                {s.city ? ` · ${s.city}` : null}
              </span>
              <span className="sessions-table-meta">
                {[s.browser, s.os, s.device].filter(Boolean).join(' / ') || '—'} · {s.views}{' '}
                {t('views')}
              </span>
              <span className="sessions-table-time">{new Date(s.lastAt).toLocaleString()}</span>
            </Link>
          ))}
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
