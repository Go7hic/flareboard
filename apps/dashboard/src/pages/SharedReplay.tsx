import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { EmptyState } from '../components/EmptyState';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { Button } from '../components/ui/button';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { API_URL } from '../lib/api';
import { formatDateTime, formatDurationMs } from '../lib/format';
import { t } from '../lib/i18n';
import { linkAtTime, parseStartParam } from '../lib/replay-timeline';

type SharedReplayData = {
  website: { name: string; domain?: string | null };
  visitId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  expiresAt: number | null;
  events: unknown[];
};

/** /shared/replay/:token — one replay shared by link, no login. `?t=<seconds>` starts there. */
export default function SharedReplay() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [startMs] = useState(() => parseStartParam(searchParams.get('t')));
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['shared-replay', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/replay-shares/${encodeURIComponent(token ?? '')}`);
      if (!res.ok) throw new Error(t('replayShareUnavailable'));
      return res.json() as Promise<SharedReplayData>;
    },
  });

  async function copyAt(ms: number) {
    const base = `${window.location.origin}/shared/replay/${token}`;
    try {
      await navigator.clipboard.writeText(linkAtTime(base, ms));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (isLoading) {
    return (
      <div className="shared-replay-page">
        <div className="skeleton" style={{ width: '40%', height: '2rem' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="shared-replay-page">
        <EmptyState
          variant="rich"
          tone="danger"
          title={t('replayShareUnavailable')}
          description={t('replayShareUnavailableBody')}
        />
      </div>
    );
  }

  return (
    <div className="shared-replay-page">
      <header className="shared-replay-header">
        <div>
          <div className="shell-brand share-public-brand">
            <BrandLogo />
          </div>
          <h1 className="page-title">
            <WebsiteNameLabel name={data.website.name} domain={data.website.domain ?? undefined} faviconSize={22} />
          </h1>
          <p className="page-subtitle">
            {t('sessionReplay')} · {formatDateTime(data.startedAt)} · {formatDurationMs(data.durationMs)}
            {data.expiresAt ? ` · ${t('replayShareExpiresAt')} ${formatDateTime(data.expiresAt)}` : ''}
          </p>
        </div>
      </header>
      {data.events.length ? (
        <section className="panel">
          <ReplayPlayer
            events={data.events}
            initialOffsetMs={startMs}
            actions={(currentMs) => (
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyAt(currentMs)}>
                {copied ? t('copied') : t('replayCopyLinkAtTime')}
              </Button>
            )}
          />
        </section>
      ) : (
        <p className="text-muted">{t('noReplayEvents')}</p>
      )}
    </div>
  );
}
