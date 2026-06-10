import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { api, getToken } from '../lib/api';
import { t } from '../lib/i18n';

interface SessionDetail {
  id: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  city: string | null;
  language: string | null;
  distinctId: string | null;
  createdAt: number;
}

interface ActivityRow {
  urlPath: string;
  eventName: string | null;
  createdAt: number;
}

export default function SessionDetailPage() {
  const { websiteId, sessionId } = useParams<{ websiteId: string; sessionId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const sessionQuery = useQuery({
    queryKey: ['session', websiteId, sessionId],
    enabled: Boolean(websiteId && sessionId),
    queryFn: () => api<SessionDetail>(`/api/websites/${websiteId}/sessions/${sessionId}`),
  });

  const activityQuery = useQuery({
    queryKey: ['session-activity', websiteId, sessionId],
    enabled: Boolean(websiteId && sessionId),
    queryFn: () => api<ActivityRow[]>(`/api/websites/${websiteId}/sessions/${sessionId}/activity`),
  });

  const propsQuery = useQuery({
    queryKey: ['session-props', websiteId, sessionId],
    enabled: Boolean(websiteId && sessionId),
    queryFn: () =>
      api<Array<{ key: string; value: string }>>(
        `/api/websites/${websiteId}/sessions/${sessionId}/properties`,
      ),
  });

  const s = sessionQuery.data;
  const location =
    s?.country || s?.city
      ? `${s.country ?? '—'}${s.city ? `, ${s.city}` : ''}`
      : '—';
  const device =
    s?.browser || s?.os || s?.device
      ? [s.browser, s.os, s.device].filter(Boolean).join(' / ')
      : '—';

  return (
    <div className="page page-session-detail">
      <PageHeader title={t('session')} subtitle={sessionId?.slice(0, 12)} />

      {s ? (
        <section className="panel panel-accent-rail section-gap">
          <h2 className="section-title">{t('session')}</h2>
          <dl className="kv-grid">
            <dt>{t('location')}</dt>
            <dd>{location}</dd>
            <dt>{t('device')}</dt>
            <dd>{device}</dd>
            <dt>{t('languageLabel')}</dt>
            <dd>{s.language ?? '—'}</dd>
            <dt>{t('distinctId')}</dt>
            <dd>{s.distinctId ?? '—'}</dd>
            <dt>{t('started')}</dt>
            <dd>{new Date(s.createdAt).toLocaleString()}</dd>
          </dl>
          {websiteId && sessionId ? (
            <Button asChild variant="secondary" className="mt-4">
              <Link to={`/websites/${websiteId}/replays`}>{t('viewReplays')}</Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="panel section-gap">
        <h2 className="section-title">{t('activity')}</h2>
        {(activityQuery.data ?? []).length ? (
          <ul className="activity-timeline">
            {(activityQuery.data ?? []).map((a, i) => (
              <li key={i} className="activity-timeline-item">
                <div className="activity-timeline-path">
                  {a.eventName ? `[${a.eventName}] ` : ''}
                  {a.urlPath}
                </div>
                <div className="activity-timeline-time">
                  {new Date(a.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('noDataInPeriod')}</p>
        )}
      </section>

      {(propsQuery.data ?? []).length ? (
        <section className="panel section-gap">
          <h2 className="section-title">{t('properties')}</h2>
          <dl className="kv-grid">
            {propsQuery.data!.map((p) => (
              <Fragment key={p.key}>
                <dt>{p.key}</dt>
                <dd>{p.value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
