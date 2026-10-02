import { useQuery } from '@tanstack/react-query';
import { Link2, VideoOff } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { EmptyState } from '../components/EmptyState';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { WebsiteNameLabel } from '../components/WebsiteNameLabel';
import { API_URL } from '../lib/api';
import { formatDateTime, formatDurationMs, formatShortDateTime } from '../lib/format';
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

  return (
    <div className="behavior-shared">
      <header className="behavior-shared-top">
        <a className="behavior-shared-brand" href="/" aria-label="Flareboard">
          <BrandLogo size={22} />
        </a>
        <span className="behavior-shared-tag">{t('behaviorSharedReplayTag')}</span>
      </header>

      <main className="behavior-shared-main">
        {isLoading ? (
          <div className="stack" aria-busy>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="behavior-shared-stage-skeleton w-full" />
          </div>
        ) : error || !data ? (
          <EmptyState
            variant="rich"
            tone="danger"
            icon={<VideoOff strokeWidth={2} />}
            title={t('replayShareUnavailable')}
            description={t('replayShareUnavailableBody')}
          />
        ) : (
          <>
            <div className="behavior-shared-head">
              <h1 className="page-title">
                <WebsiteNameLabel name={data.website.name} domain={data.website.domain ?? undefined} faviconSize={22} />
              </h1>
              <div className="meta-line">
                <span>{t('sessionReplay')}</span>
                <span title={formatDateTime(data.startedAt)}>{formatShortDateTime(data.startedAt)}</span>
                <span>{formatDurationMs(data.durationMs)}</span>
                {data.expiresAt ? (
                  <span title={formatDateTime(data.expiresAt)}>
                    {t('behaviorSharedExpires').replace('{date}', formatShortDateTime(data.expiresAt))}
                  </span>
                ) : null}
              </div>
            </div>
            {data.events.length ? (
              <section className="panel behavior-player-host">
                <ReplayPlayer
                  events={data.events}
                  initialOffsetMs={startMs}
                  actions={(currentMs) => (
                    <Button type="button" variant="outline" size="sm" onClick={() => void copyAt(currentMs)}>
                      <Link2 aria-hidden />
                      {copied ? t('copied') : t('replayCopyLinkAtTime')}
                    </Button>
                  )}
                />
              </section>
            ) : (
              <EmptyState
                variant="rich"
                icon={<VideoOff strokeWidth={2} />}
                title={t('behaviorReplayNoEvents')}
                description={t('noReplayEvents')}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
