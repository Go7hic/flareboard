import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
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

interface SessionContextItem {
  id: string;
  kind:
    | 'pageview'
    | 'event'
    | 'feature_flag'
    | 'error'
    | 'log'
    | 'ai'
    | 'survey_response'
    | 'workflow_execution';
  title: string;
  detail: string | null;
  urlPath: string | null;
  createdAt: number;
  source?: {
    module: 'feature_flags' | 'errors' | 'logs' | 'ai_observability' | 'surveys' | 'workflows';
    id?: string | null;
  };
  properties?: Array<{ key: string; value: string | null }>;
}

const contextKindLabels: Record<SessionContextItem['kind'], string> = {
  pageview: 'contextKindPageview',
  event: 'contextKindEvent',
  feature_flag: 'contextKindFeatureFlag',
  error: 'contextKindError',
  log: 'contextKindLog',
  ai: 'contextKindAi',
  survey_response: 'contextKindSurvey',
  workflow_execution: 'contextKindWorkflow',
};

function formatContextProperties(properties: SessionContextItem['properties']) {
  const values = (properties ?? [])
    .filter((item) => item.value)
    .map((item) => `${item.key}: ${item.value}`);
  return values.length ? values.join(' · ') : null;
}

function sourcePath(websiteId: string | undefined, source: SessionContextItem['source']) {
  if (!websiteId || !source) return null;
  if (source.module === 'feature_flags') {
    return `/websites/${websiteId}/feature-flags${
      source.id ? `?flag=${encodeURIComponent(source.id)}` : ''
    }`;
  }
  if (source.module === 'errors') return `/websites/${websiteId}/errors`;
  if (source.module === 'logs') return `/websites/${websiteId}/logs`;
  if (source.module === 'ai_observability') return `/websites/${websiteId}/ai-observability`;
  if (source.module === 'surveys') {
    return `/websites/${websiteId}/surveys${source.id ? `?survey=${encodeURIComponent(source.id)}` : ''}`;
  }
  if (source.module === 'workflows') {
    return `/websites/${websiteId}/workflows${source.id ? `?workflow=${encodeURIComponent(source.id)}` : ''}`;
  }
  return null;
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

  const contextQuery = useQuery({
    queryKey: ['session-context', websiteId, sessionId],
    enabled: Boolean(websiteId && sessionId),
    queryFn: () =>
      api<SessionContextItem[]>(`/api/websites/${websiteId}/sessions/${sessionId}/context`),
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
        <h2 className="section-title">{t('sessionContext')}</h2>
        {(contextQuery.data ?? []).length ? (
          <ul className="activity-timeline session-context-timeline">
            {(contextQuery.data ?? []).map((item) => (
              <li key={`${item.kind}-${item.id}`} className={`activity-timeline-item context-${item.kind}`}>
                <div>
                  <div className="activity-timeline-path">
                    <span className="badge session-context-kind">{t(contextKindLabels[item.kind])}</span>
                    <strong>{item.title}</strong>
                    {item.detail ? <span className="text-muted"> · {item.detail}</span> : null}
                  </div>
                  <div className="activity-timeline-time">
                    {item.urlPath ? <span>{item.urlPath}</span> : null}
                    {formatContextProperties(item.properties) ? (
                      <span>{formatContextProperties(item.properties)}</span>
                    ) : null}
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                {sourcePath(websiteId, item.source) ? (
                  <Link to={sourcePath(websiteId, item.source)!} className="inline-link session-context-source">
                    {t('viewSource')}
                    <ExternalLink size={12} strokeWidth={2} aria-hidden />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            {contextQuery.isLoading ? t('loading') : t('sessionContextEmpty')}
          </p>
        )}
      </section>

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
