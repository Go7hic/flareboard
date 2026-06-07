import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DateRangePicker } from '../components/DateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { api, getToken } from '../lib/api';
import { type DateRangePreset, presetToRange, rangeQueryString } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { defaultRange, loadWebsiteRange, saveWebsiteRange } from '../lib/websiteRangeStorage';

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
  const [range, setRange] = useState(() => {
    if (websiteId) {
      const stored = loadWebsiteRange(websiteId);
      if (stored) return stored;
    }
    return defaultRange('7d');
  });

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  useEffect(() => {
    if (!websiteId) return;
    const stored = loadWebsiteRange(websiteId);
    if (stored) setRange(stored);
    else setRange(defaultRange('7d'));
  }, [websiteId]);

  function onRangeChange(next: { preset: DateRangePreset; startAt: number; endAt: number }) {
    setRange(next);
    if (websiteId) saveWebsiteRange(websiteId, next);
  }

  const qs = rangeQueryString(range.startAt, range.endAt);
  const sessionsQuery = useQuery({
    queryKey: ['sessions', websiteId, range],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{ data: SessionRow[]; count: number }>(
        `/api/websites/${websiteId}/sessions?${qs}&pageSize=${PAGE_SIZE}`,
      ),
  });

  const rows = sessionsQuery.data?.data ?? [];
  const total = sessionsQuery.data?.count ?? rows.length;

  return (
    <div className="page page-sessions">
      <WebsitePageShell
        websiteId={websiteId}
        toolbar={
          <div className="website-toolbar-date">
            <DateRangePicker value={range} onChange={onRangeChange} compact />
          </div>
        }
      />

      <h2 className="section-title website-page-heading">{t('sessions')}</h2>

      {sessionsQuery.isLoading ? <div className="skeleton" style={{ height: '4rem' }} /> : null}

      {!sessionsQuery.isLoading && rows.length > 0 ? (
        <section className="panel sessions-panel section-gap">
          <div className="sessions-table-head" aria-hidden>
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
