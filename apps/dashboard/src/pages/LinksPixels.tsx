import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, INGEST_URL, type Team, type TrackingLink, type TrackingPixel } from '../lib/api';
import { t } from '../lib/i18n';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => void onCopy()}>
      {copied ? t('copied') : t('copyToClipboard')}
    </Button>
  );
}

export default function LinksPixelsPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [pixelName, setPixelName] = useState('');
  const [teamId, setTeamId] = useState(searchParams.get('teamId') ?? '');

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => api<Team[]>('/api/teams'),
  });

  const linksQueryKey = ['links', teamId || 'all'];
  const pixelsQueryKey = ['pixels', teamId || 'all'];

  const linksQuery = useQuery({
    queryKey: linksQueryKey,
    queryFn: () => api<TrackingLink[]>(teamId ? `/api/links?teamId=${teamId}` : '/api/links'),
  });

  const pixelsQuery = useQuery({
    queryKey: pixelsQueryKey,
    queryFn: () => api<TrackingPixel[]>(teamId ? `/api/pixels?teamId=${teamId}` : '/api/pixels'),
  });

  const createLink = useMutation({
    mutationFn: () =>
      api<TrackingLink>('/api/links', {
        method: 'POST',
        body: JSON.stringify({
          name: linkName,
          url: linkUrl,
          ...(teamId ? { teamId } : {}),
        }),
      }),
    onSuccess: () => {
      setLinkName('');
      setLinkUrl('');
      queryClient.invalidateQueries({ queryKey: linksQueryKey });
    },
  });

  const createPixel = useMutation({
    mutationFn: () =>
      api<TrackingPixel>('/api/pixels', {
        method: 'POST',
        body: JSON.stringify({
          name: pixelName,
          ...(teamId ? { teamId } : {}),
        }),
      }),
    onSuccess: () => {
      setPixelName('');
      queryClient.invalidateQueries({ queryKey: pixelsQueryKey });
    },
  });

  return (
    <div className="page page-links">
      <PageHeader
        title={t('linksAndPixels')}
        subtitle={t('linksSubtitle')}
        toolbar={
          <div className="field links-toolbar-field">
            <Label htmlFor="team-scope">{t('scopeTeam')}</Label>
            <select id="team-scope" className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{t('personalNoTeam')}</option>
              {(teamsQuery.data ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <section className="panel section-gap-lg">
        <h2 className="section-title">{t('shortLinks')}</h2>
        <p className="section-lead">{t('shortLinksLead')}</p>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (linkName && linkUrl) createLink.mutate();
          }}
        >
          <div className="form-row">
            <div className="field">
              <Input placeholder={t('name')} value={linkName} onChange={(e) => setLinkName(e.target.value)} />
            </div>
            <div className="field">
              <Input placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
            </div>
            <Button type="submit" variant="primary">{t('createLink')}</Button>
          </div>
        </form>
        <div className="table-scroll section-gap">
          <ul className="list-plain">
            {(linksQuery.data ?? []).map((l) => {
              const ingestUrl = `${INGEST_URL}/l/${l.slug}`;
              return (
                <li key={l.id} className="list-item">
                  <div className="list-item-row">
                    <span>
                      <strong>{l.name}</strong> → {l.url}
                      {l.teamId ? (
                        <span className="badge badge-accent admin-role-badge">{t('teamBadge')}</span>
                      ) : null}
                    </span>
                    <Button asChild variant="secondary" size="sm">
                      <Link to={`/links/analytics?linkId=${encodeURIComponent(l.id)}`}>
                        {t('viewLinkStats')}
                      </Link>
                    </Button>
                  </div>
                  <div className="list-item-row-copy">
                    <code className="code-block" style={{ fontSize: '0.75rem', flex: 1 }}>
                      {ingestUrl}
                    </code>
                    <CopyButton text={ingestUrl} />
                  </div>
                </li>
              );
            })}
            {!linksQuery.isLoading && !(linksQuery.data ?? []).length ? (
              <li className="text-muted list-item">{t('noLinksScope')}</li>
            ) : null}
          </ul>
        </div>
      </section>

      <section className="panel section-gap">
        <h2 className="section-title">{t('trackingPixels')}</h2>
        <p className="section-lead">{t('trackingPixelsLead')}</p>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (pixelName) createPixel.mutate();
          }}
        >
          <div className="form-row">
            <div className="field">
              <Input placeholder={t('name')} value={pixelName} onChange={(e) => setPixelName(e.target.value)} />
            </div>
            <Button type="submit" variant="primary">{t('createPixel')}</Button>
          </div>
        </form>
        <div className="table-scroll section-gap">
          <ul className="list-plain">
            {(pixelsQuery.data ?? []).map((p) => {
              const snippet = `<img src="${INGEST_URL}/p/${p.slug}.gif" width="1" height="1" alt="" />`;
              return (
                <li key={p.id} className="list-item">
                  <strong>{p.name}</strong>
                  {p.teamId ? <span className="badge badge-accent admin-role-badge">{t('teamBadge')}</span> : null}
                  <div className="list-item-row-copy">
                    <code className="code-block" style={{ fontSize: '0.75rem', flex: 1 }}>
                      {snippet}
                    </code>
                    <CopyButton text={snippet} />
                  </div>
                </li>
              );
            })}
            {!pixelsQuery.isLoading && !(pixelsQuery.data ?? []).length ? (
              <li className="text-muted list-item">{t('noPixelsScope')}</li>
            ) : null}
          </ul>
        </div>
      </section>
    </div>
  );
}
